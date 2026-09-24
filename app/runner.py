"""Single-host coordinator with isolated worker subprocesses."""
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time
import uuid

class Coordinator:
    def __init__(self, store):
        self.store = store
        self.limit = max(1, min(8, int(os.getenv('WORKERS', '1'))))
        self.stop_event = threading.Event()
        self.thread = None
        self.children = {}
        self.owner = 'coordinator-' + uuid.uuid4().hex
    def start(self):
        self.thread = threading.Thread(target=self.loop, daemon=True)
        self.thread.start()
    def loop(self):
        while not self.stop_event.is_set():
            try:
                for job_id, (process, stream) in list(self.children.items()):
                    if process.poll() is not None:
                        stream.close(); del self.children[job_id]
                        row = self.store.get_job(job_id)
                        if row and row['status'] == 'running':
                            self.store.finish(job_id, 'failed', error='Worker exited unexpectedly; inspect publication state before retry', worker=self.owner)
                while len(self.children) < self.limit and not self.stop_event.is_set():
                    job = self.store.claim(self.owner)
                    if not job: break
                    path = self.store.path.parent / 'jobs' / job['id'] / ('attempt-%03d' % job['attempts'])
                    path.mkdir(parents=True, exist_ok=True)
                    stream = (path / 'worker.log').open('ab')
                    try:
                        child = subprocess.Popen([sys.executable, '-u', '-m', 'app.worker', job['id'], str(self.store.path), self.owner],
                                                 cwd=Path(__file__).resolve().parent.parent,
                                                 stdout=stream, stderr=subprocess.STDOUT, start_new_session=True)
                    except Exception:
                        stream.close()
                        self.store.finish(job['id'], 'failed', error='Could not start worker', worker=self.owner)
                        raise
                    self.children[job['id']] = child, stream
            except Exception as ex:
                print('Coordinator error:', ex, flush=True)
            self.stop_event.wait(1)
    def stop(self):
        self.stop_event.set()
        if self.thread: self.thread.join(timeout=5)
        for process, _ in self.children.values():
            if process.poll() is None: process.send_signal(signal.SIGTERM)
        deadline = time.monotonic() + 20
        for process, stream in self.children.values():
            try: process.wait(timeout=max(.1, deadline-time.monotonic()))
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
            stream.close()
        self.children.clear()
