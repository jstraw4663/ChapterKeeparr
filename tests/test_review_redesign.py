"""Additive Review metadata must not change publication evidence."""
import unittest
from types import SimpleNamespace
from pathlib import Path
from unittest.mock import patch, Mock
from app import acceptance, engine

class ReviewMetadataTests(unittest.TestCase):
    def test_preview_duration_and_section_seconds(self):
        report={'recovery_draft':{'markers':[{'old_title':'A','old_seconds':0,'status':'unresolved'}],
            'duration_seconds':123.5,'reference_chapters':[{'start':0,'title':'Opening'}]}}
        with patch('app.recovery.finalize_draft'):
            p=acceptance.preview(report)
            self.assertEqual(p['duration_seconds'],123.5)
            self.assertEqual(p['published_sections'][0],{'id':'0','seconds':0,'title':'Opening'})
            report['recovery_draft'].pop('duration_seconds')
            self.assertIsNone(acceptance.preview(report)['duration_seconds'])

    def test_embedded_tags_do_not_copy_user_overrides(self):
        args=SimpleNamespace(ffprobe='ffprobe',title='User title',author='User author',narrator='User reader',asin='B000000002',no_epub=True)
        data={'format':{'duration':'100','tags':{'album':'Tagged title','artist':'Tagged author','narrator':'Tagged reader','asin':'B000000001'}}}
        report={}
        with patch.object(engine,'probe',return_value=data):
            engine.inspect_identity(Path('/synthetic.m4b'),Path('/'),args,Mock(),report)
        self.assertEqual(report['embedded_tags'],{'title':'Tagged title','author':'Tagged author','narrator':'Tagged reader','asin':'B000000001'})
        self.assertEqual(report['identity']['title'],'User title')
        self.assertEqual(report['identity']['asin'],'B000000002')
