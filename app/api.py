"""HTTP API and local web entry point for ChapterKeeper."""

from __future__ import annotations

import os
import re
import secrets
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from .db import Store
from .media import MediaService, MediaError
from .version import build_info, UpdateChecker


class JobSubmission(BaseModel):
    path: str
    keep_mp3s: bool = False
    verify_all: bool = False
    force: bool = False
    selected_paths: list[str] | None = Field(default=None, max_length=1000)


class ReviewAnswer(BaseModel):
    action: str | None = None
    asin: str | None = None
    title: str | None = None
    author: str | None = None
    narrator: str | None = None
    region: str | None = None
    recovery: str | None = None


class RecoverySettings(BaseModel):
    recovery_minimum_percent: float = Field(ge=1, le=100, allow_inf_nan=False)

class RecoveryAcceptance(BaseModel):
    draft_token: str
    minimum_percent: float | None = Field(default=None, ge=1, le=100, allow_inf_nan=False)
    optional_sections: list[str] = Field(default_factory=list, max_length=1000)
    preserve_unresolved: bool = False
    accept_possible_gap: bool = False


def _settings() -> dict[str, Any]:
    roots = [str(Path(s).expanduser().resolve()) for s in os.getenv("LIBRARY_ROOTS", "/library").split(":") if s]
    return {
        "library_roots": list(dict.fromkeys(roots)),
        "config_dir": os.getenv("CONFIG_DIR", "/config"),
        "work_dir": os.getenv("WORK_DIR", "/work"),
        "workers": max(1, min(8, int(os.getenv("WORKERS", "1")))),
        "cpu_threads": max(1, int(os.getenv("CPU_THREADS", "4"))),
        "work_cache_budget_gb": max(1, int(os.getenv("CACHE_MAX_GB", "10"))),
        "bookorbit_enabled": False,
        "auth_required": bool(os.getenv("CHAPTERKEEPER_API_TOKEN")),
    }


def _within(path: Path, roots: list[Path]) -> bool:
    return any(path == root or root in path.parents for root in roots)


def _allowed_path(raw: str, roots: list[Path], *, must_exist: bool = True) -> Path:
    if not raw or not Path(raw).is_absolute():
        raise HTTPException(400, "Choose an absolute path under a configured library root")
    try:
        path = Path(raw).expanduser().resolve(strict=must_exist)
    except (OSError, RuntimeError):
        raise HTTPException(404, "Path is unavailable") from None
    if not _within(path, roots):
        raise HTTPException(403, "Path is outside configured library roots")
    if must_exist and not path.exists():
        raise HTTPException(404, "Path is unavailable")
    return path


def create_app(store: Store | None = None) -> FastAPI:
    settings = _settings()
    roots = [Path(s) for s in settings["library_roots"]]
    store = store or Store(Path(settings["config_dir"]) / "chapterkeeper.sqlite3")
    store.initialize()
    security = HTTPBearer(auto_error=False)
    media = MediaService(store, roots, Path(settings["config_dir"]) / "media-cache")

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        coordinator = None
        if os.getenv("ENABLE_WORKERS", "1") != "0":
            from .runner import Coordinator

            coordinator = Coordinator(store)
            coordinator.start()
        try:
            yield
        finally:
            if coordinator is not None:
                coordinator.stop()

    app = FastAPI(title="ChapterKeeparr", lifespan=lifespan)
    app.state.store = store
    app.state.settings = settings
    installed = build_info()
    update_checker = UpdateChecker(installed)

    def auth(credentials: HTTPAuthorizationCredentials | None = Depends(security)) -> None:
        token = os.getenv("CHAPTERKEEPER_API_TOKEN")
        if token and (credentials is None or credentials.scheme.lower() != "bearer" or
                      not secrets.compare_digest(credentials.credentials, token)):
            raise HTTPException(401, "Bearer token required", headers={"WWW-Authenticate": "Bearer"})

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/settings", dependencies=[Depends(auth)])
    def get_settings() -> dict[str, Any]:
        return {**settings, "build": installed, "recovery_minimum_percent":store.recovery_minimum()}

    @app.get("/api/updates", dependencies=[Depends(auth)])
    def check_updates() -> dict[str, Any]:
        return update_checker.check()

    @app.put("/api/settings/recovery", dependencies=[Depends(auth)])
    def recovery_settings(payload: RecoverySettings):
        store.set_recovery_minimum(payload.recovery_minimum_percent)
        return get_settings()

    @app.post("/api/jobs/{job_id}/accept-recovery", dependencies=[Depends(auth)])
    def accept_recovery(job_id: str, payload: RecoveryAcceptance):
        from .engine import NeedsReview
        answer=payload.model_dump()
        if answer['minimum_percent'] is None: answer['minimum_percent']=store.recovery_minimum()
        try:
            job=store.answer_review(job_id,{'recovery':'finalize_recovery','finalization':answer})
        except (ValueError,NeedsReview) as ex:
            raise HTTPException(409,str(ex)) from ex
        if job is None: raise HTTPException(404,'Job not found')
        return job

    @app.get("/api/editions", dependencies=[Depends(auth)])
    def editions(query: str, region: str = "us"):
        from .editions import search
        from .engine import NeedsReview
        try:
            return {"editions": search(query, region), "region": region.lower()}
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        except (NeedsReview, OSError) as exc:
            raise HTTPException(503, str(exc)) from exc

    @app.get("/api/jobs", dependencies=[Depends(auth)])
    def list_jobs(limit: int = 100) -> dict[str, Any]:
        from .flow import present
        jobs = store.list_jobs(limit)
        return {"jobs": [{**job, "workflow": present(job)} for job in jobs]}

    @app.post("/api/discover", dependencies=[Depends(auth)])
    def discover(payload: JobSubmission):
        target = _allowed_path(payload.path, roots)
        from .engine import discover_jobs, NeedsReview
        try:
            found, issues = discover_jobs(target)
        except NeedsReview as exc:
            raise HTTPException(422, str(exc)) from exc
        except OSError as exc:
            raise HTTPException(503, "Library storage is unavailable") from exc
        books = []
        for item in found:
            path = _allowed_path(str(item), roots)
            books.append({"path": str(path), "name": path.name,
                          "kind": "m4b" if path.is_file() else "mp3_folder"})
        return {"books": books, "issues": issues}

    @app.post("/api/jobs", dependencies=[Depends(auth)])
    def submit_jobs(payload: JobSubmission) -> dict[str, Any]:
        target = _allowed_path(payload.path, roots)
        if not target.is_file() and not target.is_dir():
            raise HTTPException(400, "Choose a file or directory")
        from .engine import discover_jobs

        from .engine import NeedsReview
        try:
            discovered, issues = discover_jobs(target)
        except NeedsReview as exc:
            raise HTTPException(422, str(exc)) from exc
        except OSError as exc:
            raise HTTPException(503, f"Library storage is unavailable: {exc}") from exc
        if payload.selected_paths is not None:
            if not payload.selected_paths:
                raise HTTPException(422, "Select at least one audiobook")
            allowed = {str(Path(item).resolve()) for item in discovered}
            selected = {str(_allowed_path(item, roots)) for item in payload.selected_paths}
            if not selected.issubset(allowed):
                raise HTTPException(409, "The folder contents changed or a selected book is outside this scan. Scan again.")
            discovered = [item for item in discovered if str(Path(item).resolve()) in selected]
        options = payload.model_dump(exclude={"path", "selected_paths"})
        jobs = []
        for item in discovered:
            path = _allowed_path(str(item), roots)
            job, created = store.enqueue(path, options)
            jobs.append({**job, "created": created})
        return {"jobs": jobs, "issues": issues}

    @app.get("/api/jobs/{job_id}", dependencies=[Depends(auth)])
    def get_job(job_id: str) -> dict[str, Any]:
        job = store.get_job(job_id)
        if job is None:
            raise HTTPException(404, "Job not found")
        from .flow import present
        from .acceptance import preview
        return {**job, "workflow": present(job), "recovery_acceptance_preview": preview((job.get("result") or {}).get("report") or {},store.recovery_minimum())}

    @app.post("/api/jobs/{job_id}/cancel", dependencies=[Depends(auth)])
    def cancel_job(job_id: str) -> dict[str, Any]:
        job = store.cancel(job_id)
        if job is None:
            raise HTTPException(404, "Job not found")
        return job

    @app.post("/api/jobs/{job_id}/retry", dependencies=[Depends(auth)])
    def retry_job(job_id: str) -> dict[str, Any]:
        try:
            job = store.retry(job_id)
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc
        if job is None:
            raise HTTPException(404, "Job not found")
        return job

    @app.post("/api/jobs/{job_id}/review", dependencies=[Depends(auth)])
    def review_job(job_id: str, payload: ReviewAnswer) -> dict[str, Any]:
        answer = payload.model_dump(exclude_none=True) if hasattr(payload, "model_dump") else payload.dict(exclude_none=True)
        answer = {key: value.strip() for key, value in answer.items() if value.strip()}
        if not answer:
            raise HTTPException(422, "Supply at least one review field")
        if answer.pop('action', 'resume') != 'resume':
            raise HTTPException(422, 'Unsupported review action')
        if answer.get('recovery', 'verify') not in ('verify', 'local_markers'):
            raise HTTPException(422, 'Unsupported recovery method')
        if answer.get('recovery') == 'local_markers' and not answer.get('asin'):
            raise HTTPException(422, 'Select an audiobook ASIN before reviewing markers')
        answer.setdefault('recovery', 'verify')
        if "asin" in answer:
            answer["asin"] = answer["asin"].upper()
            if not re.fullmatch(r"[A-Z0-9]{10}", answer["asin"]):
                raise HTTPException(422, "ASIN must contain 10 letters or digits")
        if "region" in answer:
            answer["region"] = answer["region"].lower()
            if answer["region"] not in ("us", "uk", "ca", "au", "de", "es", "fr", "in", "it", "jp"):
                raise HTTPException(422, "Unsupported region")
        try:
            job = store.answer_review(job_id, answer)
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from exc
        if job is None:
            raise HTTPException(404, "Job not found")
        return job

    @app.get("/api/browse", dependencies=[Depends(auth)])
    def browse(path: str | None = None) -> dict[str, Any]:
        available = [root for root in roots if root.is_dir()]
        if path is None:
            entries = [{"name": root.name or str(root), "path": str(root), "type": "directory"} for root in available]
            return {"path": None, "roots": settings["library_roots"], "entries": entries}
        folder = _allowed_path(path, roots)
        if not folder.is_dir():
            raise HTTPException(400, "Path is not a directory")
        entries = []
        try:
            children = sorted(folder.iterdir(), key=lambda child: (not child.is_dir(), child.name.casefold()))
            for child in children:
                if child.is_symlink() or child.name.startswith("."):
                    continue
                resolved = child.resolve()
                if not _within(resolved, roots):
                    continue
                if child.is_dir():
                    kind = "directory"
                elif child.is_file() and child.suffix.casefold() in (".mp3", ".m4b", ".m4a"):
                    kind = "file"
                else:
                    continue
                entries.append({"name": child.name, "path": str(resolved), "type": kind})
        except OSError as exc:
            raise HTTPException(403, f"Cannot browse directory: {exc}") from exc
        return {"path": str(folder), "roots": settings["library_roots"], "entries": entries}

    def media_call(method, *args):
        try:
            return method(*args)
        except MediaError as exc:
            raise HTTPException(exc.status_code, exc.detail) from exc
        except OSError as exc:
            raise HTTPException(503, "Library storage is unavailable") from exc

    @app.get("/api/jobs/{job_id}/chapters", dependencies=[Depends(auth)])
    def chapters(job_id: str):
        return media_call(media.chapters, job_id)

    @app.get("/api/jobs/{job_id}/source-info", dependencies=[Depends(auth)])
    def source_info(job_id: str):
        return media_call(media.source_info, job_id)

    @app.get("/api/jobs/{job_id}/report", dependencies=[Depends(auth)])
    def report_download(job_id: str):
        job = store.get_job(job_id)
        if job is None:
            raise HTTPException(404, 'Job not found')
        report = (job.get('result') or {}).get('report')
        if not isinstance(report, dict):
            raise HTTPException(404, 'No report available')
        from fastapi.responses import JSONResponse
        return JSONResponse(report, headers={'Content-Disposition': 'attachment; filename="chapterkeeparr-report.json"'})

    @app.post("/api/jobs/{job_id}/media-token", dependencies=[Depends(auth)])
    def media_token(job_id: str):
        return media_call(media.issue_ticket, job_id)

    @app.get("/api/jobs/{job_id}/audio")
    def audio(job_id: str, ticket: str):
        path = media_call(media.verify_ticket, job_id, ticket)
        return FileResponse(path, media_type="audio/mp4")

    @app.get("/api/jobs/{job_id}/cover", dependencies=[Depends(auth)])
    def cover(job_id: str):
        path = media_call(media.cover, job_id)
        if path is None:
            raise HTTPException(404, "No cover available")
        return FileResponse(path, media_type="image/jpeg")

    @app.get("/api/jobs/{job_id}/artifacts/{name:path}", dependencies=[Depends(auth)])
    def artifact(job_id: str, name: str):
        job = store.get_job(job_id)
        if job is None:
            raise HTTPException(404, "Job not found")
        result = job.get("result") or {}
        report = result.get("report_path")
        if not isinstance(report, str):
            raise HTTPException(404, "No report available")
        evidence=(result.get('report') or {}).get('recovery_evidence_report_path')
        if name.startswith('recovery-clips/') and isinstance(evidence,str):
            report=evidence
        base = Path(report).resolve().parent
        requested = (base / name).resolve()
        if base not in requested.parents or requested.suffix.casefold() not in (".json", ".md", ".wav"):
            raise HTTPException(403, "Artifact path is not allowed")
        if not requested.is_file():
            raise HTTPException(404, "Artifact not found")
        return FileResponse(requested)

    @app.middleware("http")
    async def cache_policy(request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    static = Path(__file__).with_name("static")
    if static.is_dir():
        @app.get("/sw.js")
        def service_worker():
            return FileResponse(static / "sw.js", media_type="application/javascript",
                                headers={"Cache-Control": "no-cache", "Service-Worker-Allowed": "/"})

        @app.get("/manifest.webmanifest")
        def manifest():
            return FileResponse(static / "manifest.webmanifest", media_type="application/manifest+json")

        @app.get("/")
        def index():
            return FileResponse(static / "index.html")

        static_root = static.resolve()
        static_types = {".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2",
                        ".png": "image/png", ".svg": "image/svg+xml"}

        @app.get("/static/{name:path}")
        def static_file(name: str):
            # Frontend assets only: known types, no dotfiles, never outside app/static.
            target = (static_root / name).resolve()
            media_type = static_types.get(target.suffix.casefold())
            if (media_type is None or static_root not in target.parents or
                    any(part.startswith(".") for part in Path(name).parts) or not target.is_file()):
                raise HTTPException(404, "File not found")
            return FileResponse(target, media_type=media_type, headers={"Cache-Control": "no-cache"})

    return app
