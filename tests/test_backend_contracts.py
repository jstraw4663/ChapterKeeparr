"""Exercise the actions exposed by the redesigned UI through API and worker."""
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient
from app import engine, recovery, worker, acceptance
from app.api import create_app
from app.db import Store
import test_acceptance as acceptance_fixtures


class ReviewContractTests(unittest.TestCase):
    setUp = acceptance_fixtures.AcceptedPublicationTests.setUp

    def client(self):
        self.store.finish(self.job_id, 'awaiting_review', {'report': self.report}, worker='w')
        return TestClient(create_app(self.store))

    def test_accept_and_reverify_use_distinct_worker_paths(self):
        with patch.dict(os.environ, {'CHAPTERKEEPER_API_TOKEN': '', 'ENABLE_WORKERS': '0'}):
            client = self.client()
            preview = client.get(f'/api/jobs/{self.job_id}').json()['recovery_acceptance_preview']
            answer = {**acceptance_fixtures.approval(self.report), 'draft_token': preview['token']}
            self.assertEqual(client.post(f'/api/jobs/{self.job_id}/accept-recovery', json=answer).status_code, 200)
            worker.execute(self.store, self.store.claim('w'), 'w')
            self.assertEqual(self.store.get_job(self.job_id)['status'], 'complete')
            self.assertEqual(client.post(f'/api/jobs/{self.job_id}/retry').status_code, 200)
            job = self.store.claim('w')
            args = worker.arguments(job)
            self.assertTrue(args.force)
            self.assertEqual(args.recovery, 'verify')
            self.assertIsNone(args.finalization)
            with patch.object(engine, 'workflow', return_value=2) as workflow, patch.object(engine, 'completed_receipt') as receipt, patch.object(acceptance, 'finalize') as finalize:
                worker.execute(self.store, job, 'w')
                workflow.assert_called_once()
                receipt.assert_not_called()
                finalize.assert_not_called()

    def test_redraft_keeps_gap_evidence_and_does_not_save(self):
        with patch.dict(os.environ, {'CHAPTERKEEPER_API_TOKEN': '', 'ENABLE_WORKERS': '0'}):
            client = self.client()
            body = {'recovery': 'local_markers', 'asin': 'B000000001', 'title': 'Book', 'author': 'Author', 'narrator': 'Reader', 'region': 'us'}
            self.assertEqual(client.post(f'/api/jobs/{self.job_id}/review', json=body).status_code, 200)
            book = {'asin': 'B000000001', 'title': 'Book', 'authors': [{'name': 'Author'}], 'narrators': [{'name': 'Reader'}], 'language': 'english', 'formatType': 'unabridged', 'runtimeLengthMin': 4/60}
            published = {'asin': book['asin'], 'isAccurate': True, 'chapters': [{'startOffsetMs': i*1000, 'lengthMs': 1000 if i<3 else 4000, 'title': f'Chapter {i+1}'} for i in range(4)]}
            def transcript(text):
                return {'text': text, 'segments': [{'text': text, 'start': 2, 'avg_logprob': -.2, 'no_speech_prob': .01}]}
            speech = Mock()
            speech.transcribe.side_effect = [transcript(f'Chapter {i}.') for i in range(1,4)] + [transcript('Unclear.')] * 2
            with patch.object(engine, 'get_json', side_effect=[book, published]), patch.object(engine, 'LocalSpeech', return_value=speech), patch('importlib.metadata.version', return_value='test'), patch.object(engine, 'retag') as retag:
                worker.execute(self.store, self.store.claim('w'), 'w')
                retag.assert_not_called()
            result = self.store.get_job(self.job_id)
            self.assertEqual(result['status'], 'awaiting_review', result.get('error'))
            self.assertTrue(result['result']['report']['recovery_draft']['complete'])
            self.assertTrue(result['result']['report']['coverage_warnings'])
            self.assertEqual(self.source.read_bytes(), self.original)
            response = client.post(f'/api/jobs/{self.job_id}/review', json={'action': 'resume'})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(worker.arguments(self.store.claim('w')).recovery, 'verify')

    def test_changed_edition_clears_prior_approval(self):
        with patch.dict(os.environ, {'CHAPTERKEEPER_API_TOKEN': '', 'ENABLE_WORKERS': '0'}):
            client = self.client()
            response = client.post(f'/api/jobs/{self.job_id}/review', json={'asin':'B000000002','region':'uk','title':'Other book','author':'Other author','recovery':'verify'})
            self.assertEqual(response.status_code, 200)
            args = worker.arguments(self.store.claim('w'))
            self.assertEqual((args.asin,args.region,args.title), ('B000000002','uk','Other book'))
            self.assertIsNone(args.finalization)

    def test_redraft_identity_failure_reports_matching_gate(self):
        with patch.dict(os.environ, {'CHAPTERKEEPER_API_TOKEN': '', 'ENABLE_WORKERS': '0'}):
            client = self.client()
            client.post(f'/api/jobs/{self.job_id}/review', json={'recovery': 'local_markers', 'asin': 'B000000001'})
            with patch.object(engine, 'get_json', return_value={'asin': 'B000000002'}):
                worker.execute(self.store, self.store.claim('w'), 'w')
            job = self.store.get_job(self.job_id)
            self.assertEqual(job['status'], 'awaiting_review')
            self.assertEqual(job['result']['report']['review_reason']['category'], 'identity')
            self.assertEqual(self.source.read_bytes(), self.original)


class RetainedDraftTests(unittest.TestCase):
    def test_retry_force_override_and_approval_reset(self):
        with tempfile.TemporaryDirectory() as td:
            store = Store(Path(td) / 'db'); store.initialize()
            job, _ = store.enqueue(Path(td) / 'Book.m4b', {'recovery': 'finalize_recovery', 'finalization': {'token': 'old'}})
            store.claim('w')
            store.finish(job['id'], 'complete', {}, worker='w')
            with patch.dict(os.environ, {'CHAPTERKEEPER_API_TOKEN': '', 'ENABLE_WORKERS': '0'}):
                client = TestClient(create_app(store))
                response = client.post(f"/api/jobs/{job['id']}/retry", json={'force': False})
                self.assertEqual(response.status_code, 200)
                args = worker.arguments(store.get_job(job['id']))
                self.assertFalse(args.force)
                self.assertEqual(args.recovery, 'verify')
                self.assertIsNone(args.finalization)
                self.assertEqual(client.post(f"/api/jobs/{job['id']}/retry").status_code, 409)

    def test_retained_mp3_redraft_and_mutation_guard(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td); book=root/'Book';book.mkdir()
            track=book/'01.mp3';track.write_bytes(b'original track')
            cache=root/'cache';cache.mkdir();source=cache/'prepared.m4b';source.write_bytes(b'audio')
            inventory={'files':[{'path':'01.mp3','sha256':engine.file_hash(track)}]}
            args=SimpleNamespace(target=book,prepared_cache=cache,check_cancel=lambda:None,
                                 prior_report={'source_manifest':inventory,'audio_source_sha256':engine.file_hash(source)})
            report={}
            with patch.object(recovery,'_run_local_review',return_value=2) as scan:
                self.assertEqual(recovery.run_local_review(args,report,root),2)
                self.assertEqual(scan.call_args.args[3:5],(source,book))
                track.write_bytes(b'changed track')
                with self.assertRaisesRegex(engine.NeedsReview,'changed'):
                    recovery.run_local_review(args,{},root)
                self.assertEqual(scan.call_count,1)

    def test_reverify_converted_folder_resolves_its_m4b(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td).resolve();book=root/'Book';book.mkdir();source=book/'Book.m4b';source.write_bytes(b'audio')
            store=Store(root/'config'/'db');store.initialize();job,_=store.enqueue(book,{'force':True})
            with patch.dict(os.environ,{'LIBRARY_ROOTS':str(root)}),patch.object(engine,'workflow',return_value=2) as workflow:
                worker.execute(store,store.claim('w'),'w')
                self.assertEqual(workflow.call_args.args[0].target,source)

    def test_storage_failure_keeps_reviewed_draft_and_artifact_path(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td).resolve();store=Store(root/'config'/'db');store.initialize()
            job,_=store.enqueue(root/'missing.m4b');store.claim('w')
            evidence={'report':{'recovery_draft':{'markers':[]}},'report_path':str(root/'evidence'/'report.json')}
            store.finish(job['id'],'awaiting_review',evidence,worker='w')
            store.answer_review(job['id'],{'recovery':'verify'})
            with patch.dict(os.environ,{'LIBRARY_ROOTS':str(root)}):worker.execute(store,store.claim('w'),'w')
            result=store.get_job(job['id'])['result']
            self.assertEqual(result['report']['recovery_draft'],evidence['report']['recovery_draft'])
            self.assertEqual(result['report_path'],evidence['report_path'])
