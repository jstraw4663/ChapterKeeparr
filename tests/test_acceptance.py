import copy
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from app import acceptance, engine, recovery, flow, worker
from app.db import Store


def report_fixture():
    remote=[{'start':float(i),'end':float(i+1),'title':f'Chapter {i+1}' if i<3 else 'Chapter Sydney'} for i in range(4)]
    markers=[{'old_seconds':float(i),'new_seconds':float(i),'old_title':f'Old {i+1}',
              'title':remote[i]['title'] if i<3 else None,'reference_start':float(i) if i<3 else None,
              'status':'supported' if i<3 else 'unresolved','confidence':'spoken heading' if i<3 else 'unconfirmed',
              'transcript':f'Chapter {i+1}','audio_excerpt':f'marker-{i}.wav'} for i in range(4)]
    draft={'complete':True,'source_sha256':'a'*64,'reference_chapters':remote,'timeline_hash':recovery.digest(remote),
           'total_markers':4,'duration_seconds':4,'markers':markers}
    recovery.finalize_draft(draft,remote)
    r={'status':'needs_review','edition':{'asin':'B000000001','title':'Book','narrators':'Reader'},
       'recovery_draft':draft,'checks':[],'coverage_warnings':['Possible missing content']}
    flow.initialize(r)
    return r


def approval(r):
    p=acceptance.preview(r)
    return {'draft_token':p['token'],'minimum_percent':75,'optional_sections':[s['id'] for s in p['sections']],
            'preserve_unresolved':True,'accept_possible_gap':True}


class AcceptanceTests(unittest.TestCase):
    def test_marker_edits_are_explicit_and_do_not_raise_coverage(self):
        r=report_fixture();a=approval(r)
        ds=[{'index':i,'action':'keep'} for i in range(1,5)]
        ds[1]={'index':2,'action':'rename','title':'My chapter'}
        ds[3]={'index':4,'action':'remove','confirmed':True}
        a.update(marker_decisions=ds,preserve_unresolved=False)
        self.assertEqual(acceptance.validate(r,a)['supported_percent'],75)
        self.assertEqual(acceptance.marker_plan(r,a),[{'start_seconds':0.,'title':'Old 1'},{'start_seconds':1.,'title':'My chapter'},{'start_seconds':2.,'title':'Old 3'}])
        for edits in ([{'index':1,'action':'remove','confirmed':True}]+ds[1:], ds[:-1], ds[:-1]+[ds[0]], ds[:-1]+[{'index':4,'action':'remove'}], ds[:-1]+[{'index':4,'action':'suggested'}], ds[:-1]+[{'index':4,'action':'rename','title':'\n'}]):
            with self.subTest(edits=edits),self.assertRaises(engine.NeedsReview):
                acceptance.validate(r,{**a,'marker_decisions':edits})
        with self.assertRaises(engine.NeedsReview): acceptance.validate(r,{**a,'minimum_percent':80})

    def test_all_exceptions_and_threshold_are_explicit(self):
        r=report_fixture();a=approval(r)
        self.assertEqual(acceptance.validate(r,a)['supported_percent'],75)
        for change in ({'minimum_percent':0},{'minimum_percent':95},{'minimum_percent':float('nan')},{'minimum_percent':-1},
                       {'optional_sections':[]},{'preserve_unresolved':False},{'accept_possible_gap':False},
                       {'draft_token':'stale'}):
            with self.subTest(change=change),self.assertRaises(engine.NeedsReview):acceptance.validate(r,{**a,**change})
        self.assertEqual(acceptance.preview(r)['sections'][0]['title'],'Chapter Sydney')
    def test_incomplete_changed_duplicate_and_moved_drafts_block(self):
        for change in ('partial','invalidated','moved','duplicate','changed_reference','out_of_order'):
            r=report_fixture()
            if change=='partial':r['recovery_draft']['complete']=False
            if change=='invalidated':r['recovery_draft']['invalidated']=True
            if change=='moved':r['recovery_draft']['markers'][0]['new_seconds']=.1
            if change=='duplicate':r['recovery_draft']['markers'][1].update(reference_start=0.,title='Chapter 1')
            if change=='out_of_order':
                r['recovery_draft']['markers'][0].update(reference_start=1.,title='Chapter 2')
                r['recovery_draft']['markers'][1].update(reference_start=0.,title='Chapter 1')
            if change=='changed_reference':r['recovery_draft']['reference_chapters'][0]['title']='Changed'
            with self.subTest(change=change),self.assertRaises(engine.NeedsReview):acceptance.validate(r,approval(r))
    def test_acceptance_does_not_bypass_integrity_or_other_gates(self):
        r=report_fixture();r['recovery_acceptance']=approval(r)
        flow.assess(r,'coverage','accepted_exceptions','accepted')
        for k in ('inspect','match','align','verify'):flow.gate(r,k,'passed','checked')
        with self.assertRaises(engine.NeedsReview):flow.assert_publishable(r)
        flow.assess(r,'integrity','passed','checked');flow.assert_publishable(r)
        flow.gate(r,'inspect','review','source changed')
        with self.assertRaises(engine.NeedsReview):flow.assert_publishable(r)
    def test_persisted_default_and_transactional_draft_approval(self):
        with tempfile.TemporaryDirectory() as td:
            store=Store(Path(td)/'db');store.initialize()
            self.assertEqual(store.recovery_minimum(),95)
            store.set_recovery_minimum(97);self.assertEqual(Store(store.path).recovery_minimum(),97)
            job,_=store.enqueue(Path(td)/'Book.m4b');store.claim('w');r=report_fixture()
            store.finish(job['id'],'awaiting_review',{'report':r},worker='w')
            with self.assertRaises(engine.NeedsReview):store.answer_review(job['id'],{'recovery':'finalize_recovery','finalization':{**approval(r),'draft_token':'old'}})
            self.assertEqual(store.get_job(job['id'])['status'],'awaiting_review')
            saved=store.answer_review(job['id'],{'recovery':'finalize_recovery','finalization':approval(r)})
            self.assertEqual(saved['status'],'queued')


@unittest.skipUnless(shutil.which('ffmpeg'),'ffmpeg required')
class AcceptedPublicationTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name).resolve();self.library=self.root/'library';self.library.mkdir()
        self.source=self.library/'Book.m4b'
        meta=self.root/'chapters.txt'
        meta.write_text(';FFMETADATA1\n'+''.join(f'[CHAPTER]\nTIMEBASE=1/1000\nSTART={i*1000}\nEND={(i+1)*1000}\ntitle=Old {i+1}\n' for i in range(4)))
        subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','sine=frequency=440:duration=4','-f','ffmetadata','-i',str(meta),'-map','0:a','-map_chapters','1','-c:a','aac',str(self.source)],check=True)
        self.original=self.source.read_bytes()
        self.report=report_fixture();self.report['recovery_draft']['source_sha256']=engine.file_hash(self.source)
        self.store=Store(self.root/'config'/'db');self.store.initialize()
        job,_=self.store.enqueue(self.source);self.store.claim('w')
        self.store.finish(job['id'],'awaiting_review',{'report':self.report},worker='w')
        self.job_id=job['id']
        self.store.answer_review(job['id'],{'recovery':'finalize_recovery','finalization':approval(self.report)})
        self.job=self.store.claim('w')
        self.env=patch.dict(os.environ,{'LIBRARY_ROOTS':str(self.library)});self.env.start();self.addCleanup(self.env.stop)
    def test_real_metadata_save_retains_unresolved_and_backup(self):
        worker.execute(self.store,self.job,'w')
        saved=self.store.get_job(self.job_id);self.assertEqual(saved['status'],'complete',saved.get('error'))
        report=saved['result']['report']
        self.assertEqual(report['completion_label'],'Finalized with accepted exceptions')
        self.assertEqual(Path(report['backup']).read_bytes(),self.original)
        chapters=engine.probe('ffprobe',self.source)['chapters']
        self.assertEqual([c['tags']['title'] for c in chapters],['Chapter 1','Chapter 2','Chapter 3','Old 4'])
        self.assertEqual([float(c['start_time']) for c in chapters],[0,1,2,3])
        self.assertIn('exceptions',flow.present(saved)['overall'])
    def test_real_save_with_rename_and_navigation_removal(self):
        answer=approval(self.report)
        answer['marker_decisions']=[{'index':1,'action':'keep'},{'index':2,'action':'rename','title':'Custom name'},
                                    {'index':3,'action':'remove','confirmed':True},{'index':4,'action':'keep'}]
        self.job['review_answer']['finalization']=answer
        worker.execute(self.store,self.job,'w')
        saved=self.store.get_job(self.job_id)
        self.assertEqual(saved['status'],'complete',saved.get('error'))
        data=engine.probe('ffprobe',self.source)
        self.assertEqual([c['tags']['title'] for c in data['chapters']],['Old 1','Custom name','Old 4'])
        self.assertEqual([float(c['start_time']) for c in data['chapters']],[0,1,3])
        self.assertAlmostEqual(engine.duration(data),4,delta=.1)
        self.assertEqual(Path(saved['result']['report']['backup']).read_bytes(),self.original)
    def test_real_save_with_published_assignment_keeps_audio_and_provenance(self):
        answer=approval(self.report)
        answer['marker_decisions']=[dict(index=i,action='suggested') for i in range(1,4)]+[dict(index=4,action='published',section_id='3.0')]
        answer['optional_sections']=[]
        self.job['review_answer']['finalization']=answer
        worker.execute(self.store,self.job,'w')
        saved=self.store.get_job(self.job_id)
        self.assertEqual(saved['status'],'complete',saved.get('error'))
        result=saved['result']['report']
        self.assertEqual(result['recovery_acceptance']['supported_percent'],75)
        self.assertEqual(result['recovery_acceptance']['manual_assignments']['3.0']['index'],4)
        self.assertEqual(result['recovery_acceptance']['sections'],[])
        self.assertEqual(Path(result['backup']).read_bytes(),self.original)
        chapters=engine.probe('ffprobe',self.source)['chapters']
        self.assertEqual(chapters[-1]['tags']['title'],'Chapter Sydney')
        self.assertEqual([float(c['start_time']) for c in chapters],[0,1,2,3])
    def test_changed_audio_blocks_before_retag(self):
        self.source.write_bytes(self.original+b'changed')
        with patch.object(engine,'retag') as retag:
            worker.execute(self.store,self.job,'w');retag.assert_not_called()
        self.assertEqual(self.store.get_job(self.job_id)['status'],'awaiting_review')
        self.assertEqual(self.source.read_bytes(),self.original+b'changed')
    def test_validation_failure_keeps_original(self):
        with patch.object(engine,'retag',side_effect=engine.ConversionError('payload mismatch')):
            worker.execute(self.store,self.job,'w')
        self.assertEqual(self.store.get_job(self.job_id)['status'],'failed')
        self.assertEqual(self.source.read_bytes(),self.original)

    def test_changed_audio_during_validation_never_commits(self):
        def mutate(*args,**kwargs):
            args[1].write_bytes(b'staged output')
            self.source.write_bytes(self.original+b'changed')
        with patch.object(engine,'retag',side_effect=mutate),patch.object(engine,'commit_result') as commit:
            worker.execute(self.store,self.job,'w');commit.assert_not_called()
        self.assertEqual(self.store.get_job(self.job_id)['status'],'awaiting_review')
    def test_cancelled_acceptance_never_retags(self):
        self.store.cancel(self.job_id)
        with patch.object(engine,'retag') as retag:
            worker.execute(self.store,self.job,'w');retag.assert_not_called()
        self.assertEqual(self.store.get_job(self.job_id)['status'],'cancelled')
        self.assertEqual(self.source.read_bytes(),self.original)
    def test_mp3_acceptance_uses_exact_retained_audio_and_keeps_sources(self):
        book=self.library/'Tracks';book.mkdir()
        for i in (1,2):
            subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','sine=frequency=440:duration=2',str(book/f'{i:02}.mp3')],check=True)
        from app import inspection
        r=report_fixture();r['recovery_draft']['source_sha256']=engine.file_hash(self.source)
        r['source_manifest']=inspection.manifest(engine.media_files(book,'.mp3'),book)
        job,_=self.store.enqueue(book,{'keep_mp3s':False});self.store.claim('m')
        self.store.finish(job['id'],'awaiting_review',{'report':r},worker='m')
        cache=self.store.path.parent/'jobs'/job['id']/'prepared';cache.mkdir(parents=True)
        shutil.copy2(self.source,cache/'prepared.m4b')
        self.store.answer_review(job['id'],{'recovery':'finalize_recovery','finalization':approval(r)})
        job=self.store.claim('m');worker.execute(self.store,job,'m')
        saved=self.store.get_job(job['id'])
        self.assertEqual(saved['status'],'complete',saved.get('error'))
        self.assertTrue((book/'Tracks.m4b').is_file())
        self.assertEqual(len(list(book.glob('*.mp3'))),2)

class PublishedAssignmentTests(unittest.TestCase):
    def test_assignment_resolves_section_with_canonical_title_and_original_time(self):
        r=report_fixture();a=approval(r)
        a['marker_decisions']=[dict(index=i,action='suggested') for i in range(1,4)]+[dict(index=4,action='published',section_id='3.0',title='Untrusted title')]
        a['optional_sections']=[]
        info=acceptance.validate(r,a)
        self.assertEqual(info['sections'],[])
        self.assertEqual(info['supported_percent'],75)
        self.assertEqual(info['manual_assignments']['3.0']['index'],4)
        self.assertEqual(acceptance.marker_plan(r,a)[-1],dict(start_seconds=3.,title='Chapter Sydney'))
        for bad in ('missing','0.0',None):
            a['marker_decisions'][-1]['section_id']=bad
            with self.assertRaises(engine.NeedsReview):acceptance.validate(r,a)

    def test_removing_or_custom_renaming_assignment_returns_unlocated_section(self):
        for action in ('keep','rename','remove'):
            r=report_fixture();a=approval(r)
            a['marker_decisions']=[dict(index=i,action='suggested') for i in range(1,4)]+[dict(index=4,action=action,title='Chapter Sydney',confirmed=True)]
            a['optional_sections']=[]
            with self.assertRaises(engine.NeedsReview):acceptance.validate(r,a)
            a['optional_sections']=['3.0']
            self.assertEqual(acceptance.validate(r,a)['manual_assignments'],{})

    def test_duplicate_manual_assignment_and_out_of_order_are_rejected(self):
        r=report_fixture();a=approval(r)
        a['marker_decisions']=[dict(index=i,action='keep') for i in range(1,5)]
        a['marker_decisions'][2]=dict(index=3,action='published',section_id='3.0')
        a['marker_decisions'][3]=dict(index=4,action='published',section_id='3.0')
        with self.assertRaises(engine.NeedsReview):acceptance.marker_plan(r,a)
        a['marker_decisions'][3]=dict(index=4,action='published',section_id='2.0')
        with self.assertRaises(engine.NeedsReview):acceptance.marker_plan(r,a)

class OrderOverrideTests(unittest.TestCase):
    def test_order_override_is_explicit_and_never_permits_duplicate_id(self):
        r=report_fixture()
        ds=[dict(index=1,action='published',section_id='3.0'),dict(index=2,action='suggested'),dict(index=3,action='suggested'),dict(index=4,action='keep')]
        a={'marker_decisions':ds}
        with self.assertRaises(engine.NeedsReview):acceptance.marker_plan(r,a)
        ds[0]['override_order']='true'
        with self.assertRaises(engine.NeedsReview):acceptance.marker_plan(r,a)
        ds[0]['override_order']=True
        self.assertEqual(acceptance.marker_plan(r,a)[0]['title'],'Chapter Sydney')
        self.assertTrue(acceptance.manual_assignments(r,a)['3.0']['override_order'])
        ds[3]=dict(index=4,action='published',section_id='3.0',override_order=True)
        with self.assertRaises(engine.NeedsReview):acceptance.marker_plan(r,a)
