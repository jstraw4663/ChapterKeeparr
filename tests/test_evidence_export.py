import importlib.util
import json
from pathlib import Path
import sqlite3
import tarfile
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('evidence_export',Path(__file__).resolve().parents[1]/'scripts/export_review_evidence.py')
export=importlib.util.module_from_spec(spec);spec.loader.exec_module(export)

class EvidenceExportTests(unittest.TestCase):
    def fixture(self,root):
        config=root/'config';config.mkdir();actual=root/'library'/'reports'/'attempt-001';clips=actual/'recovery-clips';clips.mkdir(parents=True)
        markers=[]
        for n in range(5):
            name=f'recovery-clips/marker-{n:04d}.wav';(actual/name).write_bytes(b'synthetic clip');(actual/name).with_suffix('.json').write_text('{}')
            markers.append({'audio_excerpt':name})
        result={'report_path':str(actual/'report.json'),'report':{'recovery_draft':{'markers':markers}}}
        with sqlite3.connect(config/'chapterkeeper.sqlite3') as db:
            db.execute('CREATE TABLE jobs(id TEXT,result TEXT)');db.execute('INSERT INTO jobs VALUES (?,?)',('a'*32,json.dumps(result)))
        return config,result,actual
    def test_export_uses_actual_recorded_report_path_and_verifies_contents(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);config,_,_=self.fixture(root)
            names=export.build_archive(config,'a'*32,root/'bundle.tar.gz')
            self.assertEqual(len(names),11)
            with tarfile.open(root/'bundle.tar.gz') as archive:self.assertEqual(set(archive.getnames()),set(names))
    def test_missing_clip_or_invalid_job_does_not_leave_an_empty_archive(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);config,_,actual=self.fixture(root);out=root/'bundle.tar.gz'
            (actual/'recovery-clips/marker-0002.wav').unlink()
            with self.assertRaisesRegex(ValueError,'Saved clips'):export.build_archive(config,'a'*32,out)
            self.assertFalse(out.exists());self.assertFalse(out.with_name(out.name+'.partial').exists())
            with self.assertRaisesRegex(ValueError,'Job not found'):export.build_archive(config,'b'*32,out)
            with self.assertRaisesRegex(ValueError,'32-character'):export.build_archive(config,'../bad',out)
