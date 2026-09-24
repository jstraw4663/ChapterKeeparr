import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch
from app import flow, engine, inspection, recovery


def inventory(*tracks):
    return {'files':[{'path':f'{n:02d}.mp3','sha256':'x','tags':{'track':str(n)}} for n in tracks]}

class GateTests(unittest.TestCase):
    def approved(self):
        r={'checks':[{'passed':True}]}
        for k in ('inspect','match','align','verify'):flow.gate(r,k,'passed','tested')
        flow.assess(r,'coverage','no_known_gaps','tested')
        flow.assess(r,'integrity','passed','tested')
        return r
    def test_publication_requires_every_gate_and_no_draft(self):
        flow.assert_publishable(self.approved())
        for key in ('inspect','match','align','verify'):
            r=self.approved();flow.gate(r,key,'review','unresolved')
            with self.assertRaises(engine.NeedsReview):flow.assert_publishable(r)
        for change in ({'recovery_draft':{}},{'checks':[]},{'checks':[{'passed':False}]}):
            r=self.approved();r.update(change)
            with self.assertRaises(engine.NeedsReview):flow.assert_publishable(r)
        r=self.approved();flow.assess(r,'coverage','suspected_gap','short')
        with self.assertRaises(engine.NeedsReview):flow.assert_publishable(r)
    def test_missing_diagnostics_shortfall_and_internal_change_block(self):
        for d in ({},{'reference_duration_seconds':100,'local_duration_seconds':96},
                  {'reference_duration_seconds':100,'local_duration_seconds':100,'nearest_candidates':[{'difference':x} for x in [0,0,0,4,4,4]]}):
            r={};self.assertTrue(flow.check_coverage(r,d));self.assertNotEqual(r['assessment']['coverage']['level'],'no_known_gaps')
    def test_legacy_receipt_and_retry_do_not_claim_new_verification(self):
        w=flow.present({'status':'complete','result':{'report':{}}})
        self.assertFalse(w['current_evidence']);self.assertIn('earlier',w['overall'])
        w=flow.present({'status':'queued','result':{'report':self.approved()}})
        self.assertTrue(all(g['state']=='waiting' for g in w['gates']))
    def test_missing_middle_last_duplicates_and_disc(self):
        self.assertFalse(inspection.sequence_warnings(inventory(1,2,3)))
        for item in (inventory(1,3),inventory(1,1),inventory(2,3),inventory(2,1)):
            self.assertTrue(inspection.sequence_warnings(item))
        item=inventory(1,2)
        for e in item['files']:e['tags']['track']+='/3'
        self.assertTrue(inspection.sequence_warnings(item))
        item=inventory(1,2);item['files'][0]['tags']['disc']='1/3';item['files'][1]['tags']['disc']='3/3'
        self.assertTrue(inspection.sequence_warnings(item))
    def test_automatic_candidate_requires_real_unique_timeline(self):
        a={'asin':'B000000001','region':'us','edition':{},'identity_compatible':True,'timing_passed':False,'timeline_hash':'one','diagnostics':{'reference_chapters':[{}]}}
        self.assertIs(recovery.automatic_candidate({'alignment_attempts':[a]}),a)
        b={**a,'asin':'B000000002','timeline_hash':'two'}
        self.assertIsNone(recovery.automatic_candidate({'alignment_attempts':[a,b]}))
        self.assertIsNone(recovery.automatic_candidate({'alignment_attempts':[{**a,'diagnostics':{}}]}))
    def test_automatic_recovery_is_draft_only(self):
        with tempfile.TemporaryDirectory() as td:
            folder=Path(td);source=folder/'test.m4b';source.write_bytes(b'original')
            a={'asin':'B000000001','region':'us','edition':{},'identity_compatible':True,'timing_passed':False,'timeline_hash':'one','diagnostics':{'reference_chapters':[{}],'local_duration_seconds':100,'reference_duration_seconds':100}}
            report={'status':'researching','audio_source_sha256':engine.file_hash(source),'alignment_attempts':[a]}
            def scan(*args):
                args[5]['recovery_draft']={'supported_count':1,'unresolved_count':0,'total_markers':1,'missing_sections':[]}
            with patch.object(engine,'LocalSpeech'),patch.object(recovery,'scan_markers',side_effect=scan),patch.object(engine,'retag') as retag,patch.object(engine,'commit_result') as commit:
                self.assertTrue(recovery.automatic_review(source,{},None,SimpleNamespace(backend='mlx',model=None,model_cache=folder),report,folder))
                retag.assert_not_called();commit.assert_not_called()
            self.assertEqual(report['gates']['align']['state'],'review')
            self.assertEqual(source.read_bytes(),b'original')
            with self.assertRaises(engine.NeedsReview):flow.assert_publishable(report)
    def test_service_failure_has_separate_type(self):
        with patch.object(engine,'raw_get_json',side_effect=TimeoutError('offline')):
            with self.assertRaises(engine.MetadataServiceError):engine.get_json('https://example.test')

class ConversionCacheTests(unittest.TestCase):
    def test_cache_reuses_and_invalidates_content_and_corruption(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);source=root/'01.mp3';source.write_bytes(b'a')
            cache=root/'jobs'/'id'/'prepared';output=root/'out.m4b'
            args=SimpleNamespace(bitrate='112k',ffmpeg='ffmpeg',ffprobe='ffprobe')
            def inv():return {'files':[{'path':'01.mp3','sha256':engine.file_hash(source)}],'fingerprint':engine.file_hash(source)}
            def convert(*a,**kw):kw['output_path'].write_bytes(b'converted'+source.read_bytes());return True
            convert=Mock(side_effect=convert)
            with patch.object(engine,'run',return_value=b'ffmpeg fixture\n'):
                inspection.prepared_conversion(root,output,inv(),args,cache,convert)
                inspection.prepared_conversion(root,output,inv(),args,cache,convert)
                self.assertEqual(convert.call_count,1)
                source.write_bytes(b'b')
                inspection.prepared_conversion(root,output,inv(),args,cache,convert)
                self.assertEqual(convert.call_count,2)
                (cache/'prepared.m4b').write_bytes(b'corrupt')
                inspection.prepared_conversion(root,output,inv(),args,cache,convert)
                self.assertEqual(convert.call_count,3)
    def test_mutation_during_conversion_never_cached(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);source=root/'01.mp3';source.write_bytes(b'a')
            inv={'files':[{'path':'01.mp3','sha256':engine.file_hash(source)}],'fingerprint':'original'}
            def convert(*a,**kw):source.write_bytes(b'changed');kw['output_path'].write_bytes(b'out');return True
            with patch.object(engine,'run',return_value=b'ffmpeg fixture\n'),self.assertRaises(engine.NeedsReview):
                inspection.prepared_conversion(root,root/'out.m4b',inv,SimpleNamespace(bitrate='112k',ffmpeg='ffmpeg',ffprobe='ffprobe'),root/'jobs'/'id'/'prepared',convert)
            self.assertFalse((root/'jobs'/'id'/'prepared'/'prepared.json').exists())
