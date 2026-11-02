"""One lightweight inventory worker, independent of the speech/repair queue."""
from pathlib import Path
from threading import Event, Lock, Thread

from .inventory import scan_library, ScanCancelled


class LibraryScanner:
    def __init__(self, store, roots):
        self.store, self.roots = store, roots
        self.stopping = Event()
        self.wake = Event()
        self.lock = Lock()
        self.thread = None

    def start(self):
        with self.lock:
            if self.thread is not None and self.thread.is_alive():
                return
            self.stopping.clear()
            self.store.recover_library_scans()
            self.thread = Thread(target=self.run, name='library-inventory', daemon=True)
            self.thread.start()

    def stop(self):
        self.stopping.set()
        self.wake.set()
        if self.thread:
            self.thread.join(timeout=25)

    def run(self):
        while not self.stopping.is_set():
            task = self.store.claim_library_scan()
            if task is None:
                self.wake.wait(1)
                self.wake.clear()
                continue
            scan_id = task['id']
            try:
                root = Path(task['root']).resolve(strict=True)
                if not any(root == r or r in root.parents for r in self.roots):
                    raise ValueError('Scan folder is outside configured library roots')
                report = scan_library(root, inspect_files=True,
                    progress=lambda n: self.store.update_library_scan(scan_id, processed=n),
                    cancelled=lambda: self.stopping.is_set() or self.store.library_scan_cancelled(scan_id))
                if self.stopping.is_set() or self.store.library_scan_cancelled(scan_id):
                    raise ScanCancelled()
                self.store.update_library_scan(scan_id, report=report, status='completed')
            except ScanCancelled:
                self.store.update_library_scan(scan_id, status='cancelled')
            except Exception as error:
                self.store.update_library_scan(scan_id, status='failed', error=str(error)[:300])
