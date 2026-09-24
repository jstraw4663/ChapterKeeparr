"""Read-only, bounded media inspection and short-lived playback tickets."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import math
import os
import selectors
import subprocess
import threading
import time
import uuid
from collections import OrderedDict
from pathlib import Path
from typing import Any


class MediaError(Exception):
    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


class MediaService:
    TICKET_TTL = 300
    PROBE_TIMEOUT = 15
    PROBE_MAX_BYTES = 2 * 1024 * 1024
    PROBE_CACHE_SIZE = 128

    def __init__(self, store, roots, cache_dir: str | Path, secret: bytes | None = None):
        self.store = store
        self.roots = [Path(root).expanduser().resolve() for root in roots]
        self.cache_dir = Path(cache_dir)
        self.secret = secret or os.urandom(32)
        self._probes: OrderedDict[tuple, dict[str, Any]] = OrderedDict()
        self._lock = threading.Lock()

    def _job(self, job_id: str) -> dict[str, Any]:
        job = self.store.get_job(job_id)
        if job is None:
            raise MediaError(404, "Job not found")
        return job

    def _resolve(self, raw: str) -> Path:
        if not isinstance(raw, str) or not Path(raw).is_absolute():
            raise MediaError(403, "Media path is not allowed")
        try:
            path = Path(raw).resolve(strict=True)
        except (OSError, RuntimeError):
            raise MediaError(404, "Media file is unavailable") from None
        if not any(path == root or root in path.parents for root in self.roots):
            raise MediaError(403, "Media path is outside configured library roots")
        return path

    def _source(self, job: dict[str, Any]) -> Path:
        result = job.get("result") or {}
        report = result.get("report") if isinstance(result, dict) else None
        output = report.get("output") if isinstance(report, dict) else None
        return self._resolve(output or job["path"])

    def _audio(self, job_id: str) -> tuple[dict[str, Any], Path]:
        job = self._job(job_id)
        if job["status"] not in ("complete", "skipped"):
            raise MediaError(409, "Audio is available after processing completes")
        path = self._source(job)
        if not path.is_file() or path.suffix.casefold() != ".m4b":
            raise MediaError(404, "Completed M4B file is unavailable")
        return job, path

    @staticmethod
    def _signature(path: Path) -> str:
        stat = path.stat()
        raw = f"{path}\0{stat.st_dev}\0{stat.st_ino}\0{stat.st_size}\0{stat.st_mtime_ns}"
        return hashlib.sha256(raw.encode()).hexdigest()

    @staticmethod
    def _encode(data: bytes) -> str:
        return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")

    @staticmethod
    def _decode(data: str) -> bytes:
        return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))

    def issue_ticket(self, job_id: str) -> dict[str, Any]:
        _, path = self._audio(job_id)
        expiry = int(time.time()) + self.TICKET_TTL
        payload = self._encode(json.dumps({"job": job_id, "sig": self._signature(path), "exp": expiry},
                                          separators=(",", ":")).encode())
        mac = self._encode(hmac.new(self.secret, payload.encode(), hashlib.sha256).digest())
        return {"token": payload + "." + mac, "expires_in": self.TICKET_TTL, "expires_at": expiry}

    def verify_ticket(self, job_id: str, token: str) -> Path:
        try:
            payload, mac = token.split(".", 1)
            if len(token) > 1024 or not hmac.compare_digest(
                self._encode(hmac.new(self.secret, payload.encode(), hashlib.sha256).digest()), mac
            ):
                raise ValueError("bad signature")
            values = json.loads(self._decode(payload))
            if values["job"] != job_id or not isinstance(values["exp"], int) or values["exp"] < time.time():
                raise ValueError("expired or wrong job")
            _, path = self._audio(job_id)
            if not hmac.compare_digest(values["sig"], self._signature(path)):
                raise ValueError("file changed")
            return path
        except (KeyError, TypeError, ValueError, UnicodeError):
            raise MediaError(403, "Playback ticket is invalid or expired") from None

    def _probe(self, path: Path) -> dict[str, Any]:
        cmd = ["ffprobe", "-v", "error", "-print_format", "json", "-show_format",
               "-show_chapters", str(path)]
        deadline = time.monotonic() + self.PROBE_TIMEOUT
        chunks: list[bytes] = []
        length = 0
        try:
            process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        except OSError as exc:
            raise MediaError(503, f"ffprobe is unavailable: {exc}") from exc
        try:
            assert process.stdout is not None
            with selectors.DefaultSelector() as selector:
                selector.register(process.stdout, selectors.EVENT_READ)
                while True:
                    left = deadline - time.monotonic()
                    if left <= 0:
                        raise MediaError(504, "Media probe timed out")
                    if not selector.select(left):
                        raise MediaError(504, "Media probe timed out")
                    chunk = os.read(process.stdout.fileno(), min(65536, self.PROBE_MAX_BYTES + 1 - length))
                    if not chunk:
                        break
                    chunks.append(chunk)
                    length += len(chunk)
                    if length > self.PROBE_MAX_BYTES:
                        raise MediaError(422, "Media probe output is too large")
            if process.wait(timeout=max(.1, deadline - time.monotonic())):
                raise MediaError(422, "Could not read M4B chapters")
            try:
                payload = json.loads(b"".join(chunks))
                duration = float(payload.get("format", {}).get("duration", 0))
                if not math.isfinite(duration) or duration < 0:
                    raise ValueError("invalid duration")
                chapters = []
                for item in payload.get("chapters", []):
                    start, end = float(item["start_time"]), float(item["end_time"])
                    if not all(math.isfinite(n) for n in (start, end)) or start < 0 or end <= start:
                        raise ValueError("invalid chapter timing")
                    chapters.append({"title": str(item.get("tags", {}).get("title") or "")[:500],
                                     "start_seconds": start, "end_seconds": end})
                return {"chapters": chapters, "duration_seconds": duration}
            except (TypeError, KeyError, ValueError, AttributeError) as exc:
                raise MediaError(422, "Invalid M4B chapter data") from exc
        finally:
            if process.poll() is None:
                process.kill()
            process.wait()
            if process.stdout is not None:
                process.stdout.close()

    def chapters(self, job_id: str) -> dict[str, Any]:
        _, path = self._audio(job_id)
        return self._cached_probe(path)

    def source_info(self, job_id: str) -> dict[str, Any]:
        job = self._job(job_id)
        path = self._resolve(job['path'])
        if path.is_dir():
            candidates = list(path.glob('*.m4b'))
            if len(candidates) != 1:
                raise MediaError(409, 'Current file duration is unavailable until conversion finishes')
            path = self._resolve(str(candidates[0]))
        if not path.is_file() or path.suffix.casefold() not in ('.m4b', '.m4a', '.mp3'):
            raise MediaError(404, 'Source audio file is unavailable')
        value = self._cached_probe(path)
        return {'duration_seconds': value['duration_seconds']}

    def _cached_probe(self, path: Path) -> dict[str, Any]:
        stat = path.stat()
        key = (str(path), stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns)
        with self._lock:
            cached = self._probes.get(key)
            if cached is not None:
                self._probes.move_to_end(key)
                return cached
        value = self._probe(path)
        with self._lock:
            self._probes[key] = value
            self._probes.move_to_end(key)
            while len(self._probes) > self.PROBE_CACHE_SIZE:
                self._probes.popitem(last=False)
        return value

    def cover(self, job_id: str) -> Path | None:
        job = self._job(job_id)
        source = self._source(job)
        folder = source if source.is_dir() else source.parent
        cover = None
        for name in ("cover.jpg", "cover.jpeg", "cover.png", "folder.jpg", "folder.jpeg", "folder.png"):
            candidate = folder / name
            if candidate.is_symlink():
                continue
            if candidate.is_file():
                cover = self._resolve(str(candidate))
                break
        if cover is None and not source.is_file():
            return None
        if cover is None and source.suffix.casefold() not in (".m4b", ".m4a", ".mp3"):
            return None
        input_path = cover or source
        signature = self._signature(input_path)
        key = hashlib.sha256((str(input_path) + signature).encode()).hexdigest()
        output_dir = self.cache_dir / "covers"
        output_dir.mkdir(parents=True, exist_ok=True)
        output = output_dir / (key + ".jpg")
        if output.is_file():
            return output
        temporary = output_dir / (key + "." + uuid.uuid4().hex + ".jpg")
        cmd = ["ffmpeg", "-nostdin", "-v", "error", "-i", str(input_path)]
        if cover is None:
            cmd += ["-map", "0:v:0"]
        cmd += ["-frames:v", "1", "-vf", "scale=512:512:force_original_aspect_ratio=decrease",
                "-q:v", "3", "-y", str(temporary)]
        try:
            completed = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                       timeout=self.PROBE_TIMEOUT, check=False)
            if completed.returncode != 0 or not temporary.is_file():
                return None
            os.replace(temporary, output)
            return output
        except (OSError, subprocess.TimeoutExpired):
            return None
        finally:
            temporary.unlink(missing_ok=True)
