import tempfile
import threading
import time
import unittest
from pathlib import Path

from app.db import Store


class StoreTests(unittest.TestCase):
    def test_progress_never_regresses_until_explicit_retry(self):
        job, _ = self.store.enqueue(self.book)
        self.store.claim('owner')
        for value, expected in ((.67,.67),(.5,.67),(.74,.74),(.35,.74),(.9,.9)):
            updated = self.store.update_job(job['id'], progress=value, worker='owner')
            self.assertEqual(updated['progress'], expected)
        self.store.finish(job['id'], 'failed', worker='owner')
        self.store.retry(job['id'])
        self.assertEqual(self.store.claim('new')['progress'], 0)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = Store(Path(self.temp.name) / "queue.sqlite3", lease_seconds=1)
        self.store.initialize()
        self.book = Path(self.temp.name) / "book.m4b"
        self.book.touch()

    def test_active_path_is_deduplicated_and_claimed_once(self):
        jobs = []
        barrier = threading.Barrier(4)

        def submit():
            barrier.wait()
            jobs.append(self.store.enqueue(self.book, {"force": True}))

        workers = [threading.Thread(target=submit) for _ in range(4)]
        for worker in workers:
            worker.start()
        for worker in workers:
            worker.join()
        self.assertEqual(len({job[0]["id"] for job in jobs}), 1)
        self.assertEqual(sum(created for _, created in jobs), 1)
        claimed = self.store.claim("worker-a")
        self.assertEqual(claimed["status"], "running")
        self.assertIsNone(self.store.claim("worker-b"))
        self.assertFalse(self.store.heartbeat(claimed["id"], "worker-b"))
        self.assertTrue(self.store.heartbeat(claimed["id"], "worker-a"))

    def test_expired_lease_requires_explicit_retry(self):
        job, _ = self.store.enqueue(self.book)
        self.store.claim("worker-a")
        with self.store._connect() as db:
            db.execute("UPDATE jobs SET lease_expires_at=? WHERE id=?", (time.time() - 1, job["id"]))
        self.assertIsNone(self.store.claim("worker-b"))
        failed = self.store.get_job(job["id"])
        self.assertEqual(failed["status"], "failed")
        self.assertIn("inspect", failed["error"])
        self.store.retry(job["id"])
        self.assertEqual(self.store.claim("worker-b")["id"], job["id"])

    def test_review_answer_survives_retry_and_late_cancel_does_not_erase_completion(self):
        job, _ = self.store.enqueue(self.book)
        self.store.claim("worker-a")
        self.store.finish(job["id"], "awaiting_review", review={"reason": "identity unclear"}, worker="worker-a")
        answered = self.store.answer_review(job["id"], {"asin": "B123456789"})
        self.assertEqual(answered["review_answer"]["asin"], "B123456789")
        self.store.claim("worker-b")
        self.store.cancel(job["id"])
        complete = self.store.finish(job["id"], "complete", {"report_path": "report.json"}, worker="worker-b")
        self.assertEqual(complete["status"], "complete")
        retried = self.store.retry(job["id"])
        self.assertEqual(retried["review_answer"]["asin"], "B123456789")
        self.store.claim("worker-c")
        self.store.finish(job["id"], "awaiting_review", review={"reason": "Wrong edition"}, worker="worker-c")
        corrected = self.store.answer_review(job["id"], {"title": "Corrected Title"})
        self.assertEqual(corrected["review_answer"]["title"], "Corrected Title")
        self.assertNotIn("asin", corrected["review_answer"])


if __name__ == "__main__":
    unittest.main()
