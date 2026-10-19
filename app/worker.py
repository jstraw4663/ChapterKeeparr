"""One isolated book execution. Called by the coordinator, never by a shell hook."""
from __future__ import annotations
import argparse
import contextlib
import fcntl
import hashlib
import json
import os
import re
from pathlib import Path
import signal
import shutil
import sys
import threading
from . import engine, flow
from .db import Store

STAGES = {'starting': .02, 'converting': .15, 'researching': .35,
          'checking_speech': .5, 'validating_output': .75, 'committing': .9,
          'saved': .96, 'complete': 1}


def prune_transcripts(folder):
    """Bound reconstructible transcript cache only; never delete job evidence."""
    limit = max(1, float(os.getenv('CACHE_MAX_GB', '10'))) * 1024 ** 3
    items = []
    for path in folder.glob('*.json'):
        try:
            stat = path.stat()
            items.append((stat.st_mtime_ns, stat.st_size, path))
        except FileNotFoundError: pass
    total = sum(size for _, size, _ in items)
    total += sum(p.stat().st_size for p in (folder.parent/'jobs').glob('*/prepared/prepared.m4b'))
    for _, size, path in sorted(items):
        if total <= limit: break
        try:
            path.unlink()
            total -= size
        except FileNotFoundError: pass


def arguments(job):
    options = dict(job.get('options') or {})
    options.update(job.get('review_answer') or {})
    return argparse.Namespace(
        target=Path(job['path']), ffmpeg='ffmpeg', ffprobe='ffprobe',
        backend=os.getenv('SPEECH_BACKEND', 'faster-whisper'),
        model=os.getenv('MODEL', '/opt/models/small.en'),
        model_cache=Path(os.getenv('MODEL_CACHE', '/models')),
        bitrate='112k', keep_mp3s=options.get('keep_mp3s', True),
        verify_all=options.get('verify_all', False),
        force=options.get('force', False), epub=None, no_epub=False,
        asin=options.get('asin') or None, title=options.get('title') or None,
        author=options.get('author') or None, narrator=options.get('narrator') or None,
        region=options.get('region', 'us'), _report_path=None,
        recovery=options.get('recovery', 'verify'),
        finalization=options.get('finalization'),
    )


def execute(store: Store, job: dict, owner: str):
    """Keep results on local appdata even when the library is unavailable."""
    config = store.path.parent
    folder = config / 'jobs' / job['id'] / ('attempt-%03d' % job['attempts'])
    folder.mkdir(parents=True, exist_ok=True)
    args = arguments(job)
    args.prepared_cache = config / 'jobs' / job['id'] / 'prepared'
    args.recovery_cache = config / 'alignment-cache'
    args.recovery_force = job['attempts'] > 1
    prior = job.get('result') or {}
    args.prior_report = prior.get('report') or {}
    # Keep the last usable evidence if a retry fails before it can make a new report.
    current = {**prior, 'report': json.loads(json.dumps(args.prior_report)),
               'log_path': str(folder / 'worker.log')}
    committing = False
    cancelled = False
    original_write = engine.write_report
    original_log = engine.log
    original_speech = engine.LocalSpeech
    original_convert = engine.convert
    original_retag = engine.retag

    def check_cancel():
        nonlocal cancelled
        if committing or cancelled:
            return
        fresh = store.get_job(job['id'])
        if not fresh or fresh['lease_owner'] != owner:
            cancelled = True
            raise KeyboardInterrupt('Worker no longer owns the job')
        if fresh['cancel_requested']:
            cancelled = True
            raise KeyboardInterrupt('Cancelled before publication')

    def report_update(path, report):
        nonlocal committing
        # Local evidence first, so an unavailable library cannot erase diagnostics.
        current['report'] = json.loads(json.dumps(report))
        current['report_path'] = str(path / 'report.json')
        current['local_report_path'] = str(folder / 'report.json')
        engine.write_json(folder / 'report.json', report)
        stage = report.get('status', 'running')
        if stage == 'committing':
            check_cancel()
            committing = True
        store.update_job(job['id'], stage=stage, progress=STAGES.get(stage, .5),
                         result=current, worker=owner)
        original_write(path, report)
        check_cancel()

    def log(message, level='INFO'):
        original_log(message, level)
        check_cancel()
        current['activity'] = str(message)[:1000]
        match = re.search(r'Listening locally (\d+)/(\d+)', str(message))
        progress = None
        if match and int(match[2]):
            current['speech_check'] = {'current': int(match[1]), 'total': int(match[2])}
            progress = .5 + .18 * (int(match[1])-1) / int(match[2])
        retry = re.search(r'Retrying unresolved marker (\d+)/(\d+)', str(message))
        if retry and int(retry[2]):
            current['speech_check'] = {'current': int(retry[1]), 'total': int(retry[2]), 'retry': True}
            progress = .68 + .06 * (int(retry[1])-1) / int(retry[2])
        store.update_job(job['id'], result=current, progress=progress, worker=owner)

    heavy_depth = 0
    @contextlib.contextmanager
    def heavy_slot():
        nonlocal heavy_depth
        if heavy_depth:
            yield
            return
        with (config / 'media.lock').open('a+b') as handle:
            while True:
                check_cancel()
                try:
                    fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    threading.Event().wait(.5)
            heavy_depth += 1
            try: yield
            finally:
                heavy_depth -= 1
                fcntl.flock(handle, fcntl.LOCK_UN)

    args.check_cancel = check_cancel
    args.recovery_slot = heavy_slot

    def convert(*a, **kw):
        with heavy_slot(): return original_convert(*a, **kw)

    def retag(*a, **kw):
        with heavy_slot(): return original_retag(*a, **kw)

    class CachedSpeech:
        def __init__(self, backend, model, cache):
            self.backend, self.model, self.cache = backend, model, cache
            self.actual = None
            self.identity = None
        def transcribe(self, wav):
            check_cancel()
            # PCM WAV identity, model and implementation version define evidence.
            if self.identity is None:
                import importlib.metadata
                version = importlib.metadata.version('faster-whisper' if self.backend == 'faster-whisper' else 'mlx-whisper')
                model_file = Path(self.model) / 'model.bin'
                model_id = engine.file_hash(model_file) if model_file.is_file() else str(self.model)
                self.identity = self.backend + model_id + version
            key = hashlib.sha256((engine.file_hash(wav) + self.identity
                                  + 'chapterkeeper-speech-v2-word-timestamps').encode()).hexdigest()
            cached = config / 'transcripts' / (key + '.json')
            cached.parent.mkdir(exist_ok=True)
            if cached.exists():
                try:
                    result = json.loads(cached.read_text())
                    if isinstance(result.get('segments'), list):
                        log('Using cached speech excerpt')
                        return result
                except (ValueError, AttributeError): pass
            if self.actual is None:
                self.actual = original_speech(self.backend, self.model, self.cache)
            result = self.actual.transcribe(wav)
            temp = cached.with_suffix('.' + str(os.getpid()) + '.tmp')
            engine.write_json(temp, result)
            os.replace(temp, cached)
            prune_transcripts(cached.parent)
            check_cancel()
            return result

    def stop(signum, frame):
        nonlocal cancelled
        if not committing:
            cancelled = True
            raise KeyboardInterrupt('Worker interrupted; check report before retry')

    engine.write_report, engine.log, engine.LocalSpeech = report_update, log, CachedSpeech
    engine.convert, engine.retag = convert, retag
    old_signals = {}
    if threading.current_thread() is threading.main_thread():
        for sig in (signal.SIGTERM, signal.SIGINT):
            old_signals[sig] = signal.signal(sig, stop)
    try:
        check_cancel()
        roots = [Path(p).resolve(strict=True) for p in os.getenv('LIBRARY_ROOTS', '/library').split(':') if p]
        target = args.target.resolve(strict=True)
        if not any(target == root or root in target.parents for root in roots):
            raise ValueError('Job target is outside the configured library roots')
        args.target = target
        # Recheck discovered layouts immediately before invoking recursive conversion.
        if target.is_dir():
            jobs, issues = engine.discover_jobs(target)
            if not issues and len(jobs) == 1 and jobs[0].is_file() and jobs[0].parent == target:
                # A successfully converted folder now contains its single M4B.
                args.target = target = jobs[0]
            elif issues or jobs != [target]:
                raise engine.NeedsReview('Folder layout changed or is ambiguous. Rescan this folder before processing.')
        if target.is_file() and not args.force and args.recovery == 'verify':
            store.update_job(job['id'], stage='checking_completion', result=current, worker=owner)
            receipt = engine.completed_receipt(target, args.verify_all)
            if receipt:
                current.update(report=json.loads(receipt.read_text()), report_path=str(receipt))
                store.finish(job['id'], 'skipped', current, worker=owner)
                return
        if args.recovery == 'finalize_recovery':
            from .acceptance import finalize
            current['report'] = json.loads(json.dumps((job.get('result') or {}).get('report') or {}))
            args.evidence_report_path = current['report'].get('recovery_evidence_report_path') or (job.get('result') or {}).get('report_path')
            with heavy_slot():
                code = finalize(args,(job.get('result') or {}).get('report') or {},args.finalization or {},folder)
        elif args.recovery == 'local_markers':
            from .recovery import run_local_review
            report = {'status': 'starting', 'identity': {k: getattr(args,k) for k in ('title','author','narrator','asin')}, 'checks': []}
            engine.write_report(folder, report)
            with heavy_slot():
                code = run_local_review(args, report, folder)
        else:
            with heavy_slot():
                code = engine.workflow(args, interactive=False)
        report = current['report']
        state = ('complete' if code == 0 else 'awaiting_review' if code == 2 else 'failed')
        if report.get('status') == 'skipped': state = 'skipped'
        review = {'question': report.get('pending_question') or report.get('reason'),
                  'identity': report.get('identity'), 'choices': report.get('choices', [])}
        if state == 'complete':
            try: shutil.rmtree(args.prepared_cache)
            except FileNotFoundError: pass
            except OSError: pass  # Reconstructible cache cleanup cannot invalidate a committed book.
        store.finish(job['id'], state, current, error=report.get('reason'),
                     review=review if state == 'awaiting_review' else None, worker=owner)
    except KeyboardInterrupt as ex:
        if args.recovery == 'local_markers' and current['report']:
            current['report'].update(status='cancelled', reason=str(ex), publication_allowed=False)
            engine.write_json(folder / 'report.json', current['report'])
        store.finish(job['id'], 'cancelled' if cancelled else 'failed', current, error=str(ex), worker=owner)
    except Exception as ex:
        state = 'awaiting_review' if isinstance(ex, engine.NeedsReview) else 'failed'
        if not current['report'].get('review_reason'):
            category = 'operational'
            if isinstance(ex, engine.MetadataServiceError):
                category = 'service'
            elif isinstance(ex, engine.NeedsReview) and current['report'].get('active_gate') == 'match':
                category = 'identity'
            elif current['report'].get('recovery_draft', {}).get('invalidated'):
                category = 'source_changed'
            flow.require_review(current['report'], category, str(ex))
        if current['report']:
            current['report'].update(status='needs_review' if state == 'awaiting_review' else 'error', reason=str(ex))
            engine.write_json(folder / 'report.json', current['report'])
        store.finish(job['id'], state, current, error=str(ex),
                     review={'question': str(ex)} if state == 'awaiting_review' else None, worker=owner)
    finally:
        engine.write_report, engine.log, engine.LocalSpeech = original_write, original_log, original_speech
        engine.convert, engine.retag = original_convert, original_retag
        for sig, handler in old_signals.items(): signal.signal(sig, handler)


def main():
    job_id, dbpath, owner = sys.argv[1:4]
    store = Store(dbpath)
    job = store.get_job(job_id)
    if not job or job['status'] != 'running' or job['lease_owner'] != owner:
        raise SystemExit('Job is not assigned to this worker')
    stop = threading.Event()
    def heartbeat():
        while not stop.wait(10):
            if not store.heartbeat(job_id, owner): break
    thread = threading.Thread(target=heartbeat, daemon=True); thread.start()
    try: execute(store, job, owner)
    finally: stop.set(); thread.join(timeout=1)

if __name__ == '__main__': main()
