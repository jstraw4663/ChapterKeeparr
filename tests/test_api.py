import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

try:
    from fastapi.testclient import TestClient
    from app.api import create_app
    from app.db import Store
except ImportError:
    TestClient = None


@unittest.skipIf(TestClient is None, "FastAPI test dependencies are unavailable")
class ApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "library"
        self.root.mkdir()
        self.book = self.root / "Book.m4b"
        self.book.touch()
        self.outside = Path(self.temp.name) / "outside.m4b"
        self.outside.touch()
        self.env = patch.dict(os.environ, {
            "LIBRARY_ROOTS": str(self.root),
            "CHAPTERKEEPER_API_TOKEN": "test-token",
            "ENABLE_WORKERS": "0",
        })
        self.env.start()
        self.addCleanup(self.env.stop)
        self.app = create_app(Store(Path(self.temp.name) / "queue.sqlite3"))
        self.client = TestClient(self.app)
        self.headers = {"Authorization": "Bearer test-token"}

    def test_auth_browse_and_path_restriction(self):
        self.assertEqual(self.client.get("/api/health").status_code, 200)
        self.assertEqual(self.client.get("/api/jobs").status_code, 401)
        browse = self.client.get("/api/browse", params={"path": str(self.root)}, headers=self.headers)
        self.assertEqual(browse.status_code, 200)
        self.assertEqual(browse.json()["entries"][0]["name"], "Book.m4b")
        outside = self.client.get("/api/browse", params={"path": str(self.root / "..")}, headers=self.headers)
        self.assertEqual(outside.status_code, 403)
        submitted = self.client.post("/api/jobs", json={"path": str(self.outside)}, headers=self.headers)
        self.assertEqual(submitted.status_code, 403)

    def test_submission_dedup_and_job_actions(self):
        with patch("app.engine.discover_jobs", return_value=([self.book], [])):
            first = self.client.post("/api/jobs", json={"path": str(self.book)}, headers=self.headers)
            second = self.client.post("/api/jobs", json={"path": str(self.book)}, headers=self.headers)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(len(first.json()["jobs"]), 1)
        self.assertTrue(first.json()["jobs"][0]["created"])
        self.assertFalse(second.json()["jobs"][0]["created"])
        job_id = first.json()["jobs"][0]["id"]
        self.assertEqual(self.client.post(f"/api/jobs/{job_id}/cancel", headers=self.headers).json()["status"], "cancelled")
        self.assertEqual(self.client.post(f"/api/jobs/{job_id}/retry", headers=self.headers).json()["status"], "queued")

    def test_review_validation_and_nested_artifact_boundary(self):
        job, _ = self.app.state.store.enqueue(self.book)
        self.app.state.store.claim("test-worker")
        report_dir = Path(self.temp.name) / "reports"
        nested = report_dir / "attempt-001"
        nested.mkdir(parents=True)
        (report_dir / "report.json").write_text("{}")
        (nested / "check-001.wav").write_bytes(b"RIFF")
        self.app.state.store.finish(
            job["id"], "awaiting_review",
            {"report_path": str(report_dir / "report.json")},
            review={"question": "Select edition"}, worker="test-worker",
        )
        artifact = self.client.get(
            f"/api/jobs/{job['id']}/artifacts/attempt-001/check-001.wav", headers=self.headers
        )
        self.assertEqual(artifact.status_code, 200)
        denied = self.client.get(
            f"/api/jobs/{job['id']}/artifacts/../outside.m4b", headers=self.headers
        )
        self.assertNotEqual(denied.status_code, 200)
        invalid = self.client.post(
            f"/api/jobs/{job['id']}/review", json={"asin": "bad", "region": "xx"}, headers=self.headers
        )
        self.assertEqual(invalid.status_code, 422)
        for answer in ({'recovery':'unknown'},{'recovery':'local_markers'}):
            invalid=self.client.post(f"/api/jobs/{job['id']}/review",json=answer,headers=self.headers)
            self.assertEqual(invalid.status_code,422)
        answered = self.client.post(
            f"/api/jobs/{job['id']}/review", json={"asin": "b123456789", "region": "US"}, headers=self.headers
        )
        self.assertEqual(answered.status_code, 200)
        self.assertEqual(answered.json()["review_answer"]["asin"], "B123456789")

    def test_discovery_and_selective_batch_submission(self):
        books = [self.root / f"Book-{i}.m4b" for i in range(4)]
        for book in books:
            book.touch()
        with patch("app.engine.discover_jobs", return_value=(books, [])):
            scan = self.client.post("/api/discover", json={"path": str(self.root)}, headers=self.headers)
            self.assertEqual(scan.status_code, 200)
            self.assertEqual(len(scan.json()["books"]), 4)
            self.assertEqual(self.app.state.store.list_jobs(), [])
            bad = self.client.post("/api/jobs", json={"path": str(self.root), "selected_paths": [str(self.book)]}, headers=self.headers)
            self.assertEqual(bad.status_code, 409)
            self.assertEqual(self.app.state.store.list_jobs(), [])
            empty = self.client.post("/api/jobs", json={"path": str(self.root), "selected_paths": []}, headers=self.headers)
            self.assertEqual(empty.status_code, 422)
            selected = [str(book) for book in books[:3]]
            result = self.client.post("/api/jobs", json={"path": str(self.root), "selected_paths": selected}, headers=self.headers)
            self.assertEqual(result.status_code, 200)
            self.assertEqual({job["path"] for job in result.json()["jobs"]}, {str(Path(item).resolve()) for item in selected})
            self.assertEqual(len(self.app.state.store.list_jobs()), 3)


if __name__ == "__main__":
    unittest.main()
