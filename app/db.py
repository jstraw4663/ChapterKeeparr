"""Durable, single-host job queue for ChapterKeeper.

Every operation uses its own SQLite connection. Mutations that select a job use an
IMMEDIATE transaction so multiple local workers cannot claim the same book.
"""

from __future__ import annotations

import json
import sqlite3
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any


ACTIVE = ("queued", "running", "awaiting_review")
FINAL = ("complete", "skipped", "failed", "cancelled")
STATUSES = ACTIVE + FINAL


class Store:
    def __init__(self, path: str | Path, lease_seconds: int = 120):
        self.path = Path(path)
        self.lease_seconds = lease_seconds

    @contextmanager
    def _connect(self):
        connection = sqlite3.connect(self.path, timeout=30, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA busy_timeout=30000")
        connection.execute("PRAGMA foreign_keys=ON")
        try:
            yield connection
            connection.commit()
        except BaseException:
            connection.rollback()
            raise
        finally:
            connection.close()

    def initialize(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript(
                """
                CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY,
                    path TEXT NOT NULL,
                    status TEXT NOT NULL,
                    stage TEXT NOT NULL DEFAULT 'queued',
                    progress REAL NOT NULL DEFAULT 0,
                    options TEXT NOT NULL DEFAULT '{}',
                    result TEXT,
                    review TEXT,
                    review_answer TEXT,
                    error TEXT,
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL,
                    started_at REAL,
                    finished_at REAL,
                    attempts INTEGER NOT NULL DEFAULT 0,
                    lease_owner TEXT,
                    lease_expires_at REAL,
                    cancel_requested INTEGER NOT NULL DEFAULT 0,
                    CHECK (status IN ('queued','running','awaiting_review',
                                      'complete','skipped','failed','cancelled')),
                    CHECK (progress >= 0 AND progress <= 1)
                );
                CREATE UNIQUE INDEX IF NOT EXISTS one_active_job_per_path
                    ON jobs(path) WHERE status IN ('queued','running','awaiting_review');
                CREATE INDEX IF NOT EXISTS jobs_status_created
                    ON jobs(status, created_at);
                """
            )

    @staticmethod
    def _dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
        if row is None:
            return None
        result = dict(row)
        for key in ("options", "result", "review", "review_answer"):
            if result[key] is not None:
                result[key] = json.loads(result[key])
        result["cancel_requested"] = bool(result["cancel_requested"])
        return result

    @staticmethod
    def _canonical(path: str | Path) -> str:
        return str(Path(path).expanduser().resolve())

    def enqueue(self, path: str | Path, options: dict[str, Any] | None = None) -> tuple[dict[str, Any], bool]:
        """Insert a job, or return the active job for this canonical source path."""
        canonical = self._canonical(path)
        now = time.time()
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT * FROM jobs WHERE path=? AND status IN ('queued','running','awaiting_review')",
                (canonical,),
            ).fetchone()
            if row:
                return self._dict(row), False
            job_id = uuid.uuid4().hex
            db.execute(
                "INSERT INTO jobs(id,path,status,stage,options,created_at,updated_at) "
                "VALUES (?,?,'queued','queued',?,?,?)",
                (job_id, canonical, json.dumps(options or {}), now, now),
            )
            return self._dict(db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()), True

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        with self._connect() as db:
            return self._dict(db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone())

    def list_jobs(self, limit: int = 100) -> list[dict[str, Any]]:
        with self._connect() as db:
            rows = db.execute(
                "SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?", (max(1, min(limit, 1000)),)
            ).fetchall()
            return [self._dict(row) for row in rows]

    def claim(self, worker: str) -> dict[str, Any] | None:
        """Claim one queued job; expired work is failed for explicit reconciliation."""
        if not worker:
            raise ValueError("worker is required")
        now = time.time()
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute(
                "UPDATE jobs SET status='failed',stage='interrupted',"
                "error='Worker lease expired; inspect source and publication state before retry',"
                "lease_owner=NULL,lease_expires_at=NULL,updated_at=?,finished_at=? "
                "WHERE status='running' AND lease_expires_at IS NOT NULL AND lease_expires_at<?",
                (now, now, now),
            )
            row = db.execute(
                "SELECT id FROM jobs WHERE status='queued' ORDER BY created_at,id LIMIT 1"
            ).fetchone()
            if not row:
                return None
            db.execute(
                "UPDATE jobs SET status='running',stage='starting',progress=0,"
                "started_at=?,finished_at=NULL,updated_at=?,attempts=attempts+1,"
                "lease_owner=?,lease_expires_at=? WHERE id=?",
                (now, now, worker, now + self.lease_seconds, row["id"]),
            )
            return self._dict(db.execute("SELECT * FROM jobs WHERE id=?", (row["id"],)).fetchone())

    def heartbeat(self, job_id: str, worker: str) -> bool:
        now = time.time()
        with self._connect() as db:
            changed = db.execute(
                "UPDATE jobs SET lease_expires_at=?,updated_at=? "
                "WHERE id=? AND status='running' AND lease_owner=?",
                (now + self.lease_seconds, now, job_id, worker),
            ).rowcount
            return bool(changed)

    def update_job(
        self,
        job_id: str,
        *,
        stage: str | None = None,
        progress: float | None = None,
        result: dict[str, Any] | None = None,
        review: dict[str, Any] | None = None,
        error: str | None = None,
        worker: str | None = None,
    ) -> dict[str, Any] | None:
        """Record worker progress, optionally setting review evidence and partial results."""
        updates: list[str] = ["updated_at=?"]
        values: list[Any] = [time.time()]
        for key, value in (("stage", stage), ("progress", progress), ("result", result),
                           ("review", review), ("error", error)):
            if value is not None:
                if key == "progress" and not 0 <= value <= 1:
                    raise ValueError("progress must be between 0 and 1")
                # Stage checkpoints must not undo finer-grained work progress.
                # Claim/retry explicitly reset progress for a new execution.
                updates.append("progress=MAX(progress,?)" if key == "progress" else f"{key}=?")
                values.append(json.dumps(value) if key in ("result", "review") else value)
        where = "id=? AND status='running'"
        values.append(job_id)
        if worker is not None:
            where += " AND lease_owner=?"
            values.append(worker)
        with self._connect() as db:
            db.execute(f"UPDATE jobs SET {','.join(updates)} WHERE {where}", values)
            return self._dict(db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone())

    def finish(
        self,
        job_id: str,
        status: str,
        result: dict[str, Any] | None = None,
        *,
        error: str | None = None,
        review: dict[str, Any] | None = None,
        worker: str | None = None,
    ) -> dict[str, Any] | None:
        if status not in FINAL + ("awaiting_review",):
            raise ValueError(f"invalid finish status: {status}")
        now = time.time()
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            if not row:
                return None
            if row["status"] != "running" or (worker is not None and row["lease_owner"] != worker):
                raise ValueError("job is not owned by this running worker")
            db.execute(
                "UPDATE jobs SET status=?,stage=?,progress=?,result=COALESCE(?,result),"
                "review=?,error=?,updated_at=?,finished_at=?,lease_owner=NULL,"
                "lease_expires_at=NULL WHERE id=?",
                (status, status, 1 if status in ("complete", "skipped") else row["progress"],
                 json.dumps(result) if result is not None else None,
                 json.dumps(review) if review is not None else None, error, now,
                 None if status == "awaiting_review" else now, job_id),
            )
            return self._dict(db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone())

    def cancel(self, job_id: str) -> dict[str, Any] | None:
        now = time.time()
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            if not row:
                return None
            if row["status"] in ("queued", "awaiting_review"):
                db.execute(
                    "UPDATE jobs SET status='cancelled',stage='cancelled',updated_at=?,"
                    "finished_at=?,cancel_requested=1 WHERE id=?", (now, now, job_id)
                )
            elif row["status"] == "running":
                db.execute("UPDATE jobs SET cancel_requested=1,updated_at=? WHERE id=?", (now, job_id))
            return self._dict(db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone())

    def retry(self, job_id: str, force: bool | None = None) -> dict[str, Any] | None:
        now = time.time()
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            if not row:
                return None
            if row["status"] not in FINAL:
                raise ValueError("only finished jobs can be retried")
            conflict = db.execute(
                "SELECT id FROM jobs WHERE path=? AND status IN ('queued','running','awaiting_review')",
                (row["path"],),
            ).fetchone()
            if conflict:
                raise ValueError("another active job already uses this path")
            options = json.loads(row['options'] or '{}')
            answer = json.loads(row['review_answer'] or '{}')
            # Re-verify a finished book, rather than immediately skipping its receipt.
            if force is not None or row['status'] in ('complete', 'skipped'):
                options['force'] = force if force is not None else True
            for values in (options, answer):
                values.pop('finalization', None)
                if values.get('recovery') == 'finalize_recovery' or row['status'] in ('complete', 'skipped'):
                    values['recovery'] = 'verify'
            db.execute(
                "UPDATE jobs SET status='queued',stage='queued',progress=0,error=NULL,"
                "review=NULL,cancel_requested=0,updated_at=?,options=?,review_answer=?,"
                "started_at=NULL,finished_at=NULL,lease_owner=NULL,lease_expires_at=NULL WHERE id=?",
                (now, json.dumps(options), json.dumps(answer), job_id),
            )
            return self._dict(db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone())

    def answer_review(self, job_id: str, answer: dict[str, Any]) -> dict[str, Any] | None:
        now = time.time()
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            if not row:
                return None
            if row["status"] != "awaiting_review":
                raise ValueError("job is not awaiting review")
            merged = json.loads(row["review_answer"]) if row["review_answer"] else {}
            if "asin" not in answer and any(key in answer for key in ("title", "author", "narrator")):
                merged.pop("asin", None)
            if answer.get('recovery') == 'finalize_recovery':
                from .acceptance import validate
                validate((json.loads(row['result'] or '{}')).get('report') or {}, answer.get('finalization') or {})
            else:
                merged.pop('finalization',None)
                if merged.get('recovery') == 'finalize_recovery': merged['recovery']='verify'
            merged.update(answer)
            db.execute(
                "UPDATE jobs SET status='queued',stage='queued',review_answer=?,"
                "updated_at=?,cancel_requested=0 WHERE id=?",
                (json.dumps(merged), now, job_id),
            )
            return self._dict(db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone())

    def recovery_minimum(self):
        with self._connect() as db:
            row=db.execute("SELECT value FROM preferences WHERE key='recovery_minimum_percent'").fetchone()
            return float(row['value']) if row else 95.0

    def set_recovery_minimum(self, value):
        import math
        if not math.isfinite(value) or not 1 <= value <= 100: raise ValueError('Percentage must be between 1 and 100')
        with self._connect() as db:
            db.execute("INSERT OR REPLACE INTO preferences(key,value) VALUES('recovery_minimum_percent',?)",(str(value),))
