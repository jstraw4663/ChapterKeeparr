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
