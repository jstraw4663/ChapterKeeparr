import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from app import engine, worker
from app.db import Store

class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve(); self.library = self.root/'library'; self.library.mkdir()
        self.store = Store(self.root/'config'/'jobs.sqlite'); self.store.initialize()
        self.env = patch.dict(os.environ, {'LIBRARY_ROOTS': str(self.library)}); self.env.start(); self.addCleanup(self.env.stop)
    def claim(self, path, options=None):
        job, _ = self.store.enqueue(path, options); return self.store.claim('test')
    def test_skip_verified_existing_without_running_engine(self):
        source=self.library/'Book.m4b';source.write_bytes(b'validated media')
        report=self.library/engine.REPORTS_DIR/'20260923'/'report.json';report.parent.mkdir(parents=True)
        report.write_text(json.dumps({'status':'complete','output_sha256':engine.file_hash(source)}))
        job=self.claim(source)
        with patch.object(engine,'workflow') as workflow:worker.execute(self.store,job,'test');workflow.assert_not_called()
        self.assertEqual(self.store.get_job(job['id'])['status'],'skipped')
    def test_disconnect_retains_report_locally_and_fails(self):
        source=self.library/'Book.m4b';source.write_bytes(b'media');job=self.claim(source)
        with patch.object(engine,'completed_receipt',side_effect=OSError(57,'Socket is not connected')),patch.object(engine,'workflow') as workflow:
            worker.execute(self.store,job,'test');workflow.assert_not_called()
        self.assertEqual(self.store.get_job(job['id'])['status'],'failed')
    def test_review_reports_and_resume_options(self):
        source=self.library/'Book.m4b';source.write_bytes(b'media');job=self.claim(source)
        def flow(args, interactive):
            folder=self.library/engine.REPORTS_DIR/'review';folder.mkdir(parents=True)
            engine.write_report(folder,{'status':'needs_review','reason':'Edition ambiguous','input':str(source),'checks':[]})
            return 2
        with patch.object(engine,'workflow',side_effect=flow):worker.execute(self.store,job,'test')
        result=self.store.get_job(job['id']);self.assertEqual(result['status'],'awaiting_review')
        self.assertTrue(list((self.root/'config'/'jobs'/job['id']).rglob('report.json')))
        self.store.answer_review(job['id'],{'asin':'123456789X'})
        self.assertEqual(worker.arguments(self.store.claim('test')).asin,'123456789X')
    def test_cancel_before_engine(self):
        source=self.library/'Book.m4b';source.write_bytes(b'media');job=self.claim(source);self.store.cancel(job['id'])
        with patch.object(engine,'workflow') as workflow:worker.execute(self.store,job,'test');workflow.assert_not_called()
        self.assertEqual(self.store.get_job(job['id'])['status'],'cancelled')
    def test_local_recovery_is_draft_only_and_uses_local_reports(self):
        source=self.library/'Book.m4b';source.write_bytes(b'original audio')
        job=self.claim(source, {'asin':'B000000001','recovery':'local_markers'})
        def recover(args, report, folder):
            self.assertEqual(folder.parents[2],self.root/'config')
            report.update(status='needs_review',reason='Draft only',recovery_draft={'publication_allowed':False})
            engine.write_report(folder,report)
            return 2
        with patch('app.recovery.run_local_review',side_effect=recover),patch.object(engine,'workflow') as workflow,patch.object(engine,'completed_receipt') as receipt:
            worker.execute(self.store,job,'test')
            workflow.assert_not_called();receipt.assert_not_called()
        saved=self.store.get_job(job['id'])
        self.assertEqual(saved['status'],'awaiting_review')
        self.assertFalse(saved['result']['report']['recovery_draft']['publication_allowed'])
        self.assertEqual(source.read_bytes(),b'original audio')
    def test_automatic_recovery_pipeline_never_publishes(self):
        source=self.library/'Book.m4b';source.write_bytes(b'original audio')
        job=self.claim(source,{'force':True,'asin':'B000000001'})
        data={'format':{'duration':'100'},'streams':[{'codec_type':'audio','codec_name':'aac'}]}
        def research(*a,**kw):
            report=a[8]
            report['alignment_attempts']=[{'asin':'B000000001','region':'us','edition':{'asin':'B000000001','title':'Book','narrators':'Reader'},'identity_compatible':True,'timing_passed':False,'timeline_hash':'one','diagnostics':{'reference_chapters':[{'start':0,'end':100,'title':'Chapter 1'}],'local_duration_seconds':100,'reference_duration_seconds':100}}]
            raise engine.NeedsReview('Timing cannot be aligned')
        def scan(*a):
            a[5]['recovery_draft']={'supported_count':1,'unresolved_count':0,'total_markers':1,'missing_sections':[]}
        with patch.object(engine,'probe',return_value=data),patch.object(engine.importlib.util,'find_spec',return_value=object()),patch.object(engine,'inspect_identity',return_value=(data,'Book','Author','Reader','B000000001',None)),patch.object(engine,'research_edition',side_effect=research),patch('app.recovery.scan_markers',side_effect=scan),patch.object(engine,'retag') as retag,patch.object(engine,'commit_result') as commit:
            worker.execute(self.store,job,'test')
            retag.assert_not_called();commit.assert_not_called()
        saved=self.store.get_job(job['id'])
        self.assertEqual(saved['status'],'awaiting_review',saved.get('error'))
        self.assertTrue(saved['result']['report']['automatic_recovery_attempted'])
        self.assertEqual(saved['result']['report']['review_reason']['category'],'chapters')
        self.assertEqual(source.read_bytes(),b'original audio')
    def test_missing_track_stops_before_conversion(self):
        book=self.library/'Book';book.mkdir()
        for name in ('01.mp3','03.mp3'):(book/name).write_bytes(b'audio')
        job=self.claim(book)
        with patch.object(engine,'probe',return_value={'format':{'duration':'100'}}),patch.object(engine,'convert') as convert:
            worker.execute(self.store,job,'test');convert.assert_not_called()
        saved=self.store.get_job(job['id'])
        self.assertEqual(saved['status'],'awaiting_review')
        self.assertEqual(saved['result']['report']['review_reason']['category'],'source_inventory')
        self.assertEqual(len(list(book.glob('*.mp3'))),2)
    @unittest.skipUnless(shutil.which('ffmpeg'),'ffmpeg required')
    def test_real_conversion_and_repair_via_worker(self):
        book=self.library/'Book';book.mkdir()
        for index in range(1, 9):
            subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i',
                            'sine=frequency=440:duration=0.5', '-metadata', 'title=Chapter '+str(index),
                            '-metadata', 'album=Book', '-metadata', 'artist=Test Author', str(book/('%02d.mp3' % index))], check=True)
        sidecar=book/'book.nfo';sidecar.write_bytes(b'unchanged')
        job=self.claim(book,{'keep_mp3s':False})
        def research(title,author,narrator,seconds,region,asin,data,questions,report,folder,**kwargs):
            report['alignment_attempts']=[{'asin':'123456789X','timing_passed':True,'diagnostics':{'local_duration_seconds':seconds,'reference_duration_seconds':seconds}}]
            plan=[{'start_seconds':float(c['start_time']),'title':'Chapter '+str(i)} for i,c in enumerate(data['chapters'],1)]
            return {'asin':'123456789X','title':'Book','narrators':'Reader','publisher':'Test'}, {}, plan, {'matching_boundaries':7,'offset_seconds':0}
        def speech(source,plan,evidence,args,report,folder,model,attempt):
            report['checks']=[{'title':'Chapter 1','passed':True,'transcript':'Chapter one','audio_excerpt':'test.wav'}];return True
        with patch.object(engine.importlib.util,'find_spec',return_value=object()),patch.object(engine,'research_edition',side_effect=research),patch.object(engine,'speech_review',side_effect=speech):
            worker.execute(self.store,job,'test')
        result=self.store.get_job(job['id']);self.assertEqual(result['status'],'complete',result.get('error'))
        self.assertTrue((book/'Book.m4b').is_file());self.assertFalse(list(book.glob('*.mp3')))
        self.assertEqual(sidecar.read_bytes(),b'unchanged')

if __name__=='__main__':unittest.main()
