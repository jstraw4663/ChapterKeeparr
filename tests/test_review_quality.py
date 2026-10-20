import copy
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import os
import unittest
from unittest.mock import patch
from app import acceptance, engine, recovery, review_quality
from app import worker
from app.db import Store


from fixtures.quality_review import fixture


def choices(p):
    return [dict(index=m['index'],action='suggested') if m['supported'] else
            dict(index=m['index'],action='published',section_id=p['published_sections'][m['index']-1]['id']) for m in p['markers']]


class ReviewQualityTests(unittest.TestCase):
    def test_validated_choices_raise_combined_coverage_without_claiming_more_audio(self):
        r=fixture();p=acceptance.preview(r);ds=choices(p)
        q=review_quality.assess(p,ds)
        self.assertEqual((p['supported_percent'],q['validated_percent'],q['selected_count']),(80,100,2))
        answer=dict(draft_token=p['token'],minimum_percent=95,marker_decisions=ds,optional_sections=[],accept_possible_gap=True)
        accepted=acceptance.validate(r,answer)
        self.assertEqual(accepted['supported_percent'],80)
        self.assertEqual(accepted['match_quality']['validated_count'],10)
        ds[-1]=dict(index=10,action='rename',title='End Credits')
        answer['match_quality']={'validated_percent':100}  # Client claims are ignored.
        answer['optional_sections']=[p['published_sections'][-1]['id']]
        with self.assertRaisesRegex(engine.NeedsReview,'Evidence-backed'):
            acceptance.validate(r,answer)

    def test_random_rename_keep_remove_and_order_overrides_do_not_earn_credit(self):
        p=acceptance.preview(fixture())
        for action in ['keep','rename','remove']:
            ds=choices(p);ds[0]=dict(index=1,action=action,title='Opening Credits',confirmed=True)
            q=review_quality.assess(p,ds)
            self.assertEqual(q['validated_percent'],90)
        ds=choices(p);ds[0]['override_order']=True
        self.assertEqual(review_quality.assess(p,ds)['selected_count'],1)
        ds=choices(p);ds[4]=dict(index=5,action='remove',confirmed=True)
        self.assertEqual(review_quality.assess(p,ds)['validated_percent'],100,'original audio evidence remains factual; removal itself adds no credit')
        self.assertTrue(any(w['kind']=='unassigned_chapter' for w in review_quality.assess(p,ds)['warnings']))

    def test_insufficient_or_unstable_timing_evidence_cannot_qualify(self):
        for kind in ['few','duration','spread','concentrated','competing_section','competing_marker']:
            r=fixture(20 if kind=='concentrated' else 10);d=r['recovery_draft'];remote=d['reference_chapters']
            if kind in ['few','concentrated']:
                for i,m in enumerate(d['markers']):
                    if i not in range(1,6 if kind=='few' else 7):m.update(status='unresolved',title=None,reference_start=None)
            if kind=='duration':d['duration_seconds']+=10
            if kind=='spread':d['markers'][2]['old_seconds']+=1
            if kind=='competing_section':remote.insert(1,dict(title='Alternate',start=1.,end=100.))
            if kind=='competing_marker':d['markers'].insert(1,dict(old_title='Extra',old_seconds=1.,status='unresolved'))
            eligible,_=review_quality.eligibility(d,remote)
            with self.subTest(kind=kind):self.assertEqual(eligible[0],[])

    def test_sequence_flags_and_frontend_server_parity(self):
        cases=[];p=acceptance.preview(fixture());ds=choices(p)
        cases.append((p,ds))
        for mode in ['inversion','duplicate','rename','missing']:
            pp=copy.deepcopy(p);dd=copy.deepcopy(ds)
            if mode=='inversion':
                dd[3]['action']='published';dd[3]['section_id']=pp['published_sections'][5]['id'];dd[3]['override_order']=True
                dd[5]['action']='published';dd[5]['section_id']=pp['published_sections'][3]['id'];dd[5]['override_order']=True
            if mode=='duplicate':dd[-1]['section_id']=dd[0]['section_id']
            if mode=='rename':dd[3]=dict(index=4,action='rename',title='Chapter 1')
            if mode=='missing':dd[4]=dict(index=5,action='remove',confirmed=True)
            q=review_quality.assess(pp,dd)
            self.assertTrue(q['warnings'],mode);cases.append((pp,dd))
        r=fixture();remote=r['recovery_draft']['reference_chapters']
        for i,t in enumerate(['I. North - Chapter 1','Chapter 2','II. South - Chapter 1','Chapter 2'],1):
            remote[i]['title']=t;r['recovery_draft']['markers'][i]['title']=t
        r['recovery_draft']['timeline_hash']=recovery.digest(remote)
        pp=acceptance.preview(r);dd=choices(pp)
        # Limit to the two parts so unrelated later fixture chapter numbers do
        # not invent a continuity claim about the synthetic catalog.
        pp['markers']=pp['markers'][:5];pp['published_sections']=pp['published_sections'][:5];dd=dd[:5]
        pp.update(supported=4,supported_percent=80,total=5)
        self.assertFalse(review_quality.assess(pp,dd)['warnings']);cases.append((pp,dd))
        pp=copy.deepcopy(p);pp['markers']=pp['markers'][:3]
        for m in pp['markers']:m.update(supported=False,reference_id=None,suggested_title=None)
        pp.update(supported=0,supported_percent=0,total=3)
        dd=[dict(index=i+1,action='rename',title=f'Chapter {n}') for i,n in enumerate([1,2,4])]
        self.assertTrue(any(w['kind']=='unassigned_chapter' and w['message'].startswith('Chapter 3 ') for w in review_quality.assess(pp,dd)['warnings']))
        cases.append((pp,dd))
        if not shutil.which('node'):return
        script="import {assessMatches} from './app/static/js/review-quality.js';let raw='';for await(const s of process.stdin)raw+=s;process.stdout.write(JSON.stringify(JSON.parse(raw).map(([p,ds])=>assessMatches(p,{decisions:Object.fromEntries(ds.map(d=>[d.index,d]))}))));"
        actual=json.loads(subprocess.check_output(['node','--input-type=module','-e',script],input=json.dumps(cases).encode(),cwd=Path(__file__).resolve().parents[1]))
        self.assertEqual(actual,[review_quality.assess(pp,dd) for pp,dd in cases])

    def test_policy_version_changes_the_approval_token(self):
        r=fixture();before=acceptance.token(r)
        with patch.object(review_quality,'VERSION','future-policy'):self.assertNotEqual(before,acceptance.token(r))

    def test_normalization_keeps_approval_bound_to_the_same_evidence(self):
        r=fixture();raw=copy.deepcopy(r);normalized=copy.deepcopy(r)
        normalized['recovery_draft']=acceptance.reviewed_draft(r)
        self.assertEqual(acceptance.token(r),acceptance.token(normalized))
        self.assertEqual(r,raw)
        normalized['recovery_draft']['source_sha256']='b'*64
        self.assertNotEqual(acceptance.token(r),acceptance.token(normalized))

    @unittest.skipUnless(shutil.which('ffmpeg'), 'ffmpeg required')
    def test_generated_finalization_uses_combined_threshold_and_preserves_audio_backup(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);library=root/'library';library.mkdir();source=library/'Book.m4b'
            r=fixture();d=r['recovery_draft']
            for m in d['markers']:m['old_seconds']/=5;m['new_seconds']/=5;m['reference_start']=m['reference_start']/5 if m['reference_start'] is not None else None
            for c in d['reference_chapters']:c['start']/=5;c['end']/=5
            d['duration_seconds']=200;d['timeline_hash']=recovery.digest(d['reference_chapters'])
            meta=root/'chapters.txt';meta.write_text(';FFMETADATA1\n'+''.join(f"[CHAPTER]\nTIMEBASE=1/1000\nSTART={i*20000}\nEND={(i+1)*20000}\ntitle=Track {i+1}\n" for i in range(10)))
            subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','sine=frequency=440:duration=200','-f','ffmetadata','-i',str(meta),'-map','0:a','-map_chapters','1','-c:a','aac','-b:a','32k',str(source)],check=True)
            original=source.read_bytes();d['source_sha256']=engine.file_hash(source)
            p=acceptance.preview(r);answer=dict(draft_token=p['token'],minimum_percent=95,marker_decisions=choices(p),optional_sections=[],accept_possible_gap=True)
            store=Store(root/'config'/'db');store.initialize();job,_=store.enqueue(source);store.claim('w');store.finish(job['id'],'awaiting_review',{'report':r},worker='w')
            store.answer_review(job['id'],{'recovery':'finalize_recovery','finalization':answer});job=store.claim('w')
            with patch.dict(os.environ,{'LIBRARY_ROOTS':str(library)}):worker.execute(store,job,'w')
            saved=store.get_job(job['id']);self.assertEqual(saved['status'],'complete',saved.get('error'))
            result=saved['result']['report'];receipt=result['recovery_acceptance']
            self.assertEqual(receipt['supported_percent'],80)
            self.assertEqual(receipt['match_quality']['validated_percent'],100)
            self.assertEqual(receipt['minimum_metric'],'evidence_backed_markers')
            self.assertEqual(Path(result['backup']).read_bytes(),original)
            chapters=engine.probe('ffprobe',source)['chapters']
            self.assertEqual([float(c['start_time']) for c in chapters],[i*20 for i in range(10)])


if __name__=='__main__':unittest.main()
