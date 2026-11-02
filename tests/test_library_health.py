import json
import os
import subprocess
import tempfile
import time
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from app.db import Store
from app.inventory import scan_library, with_reviews, ScanCancelled
from app.library_scans import LibraryScanner


def epub(path, *, missing_spine=False):
    with zipfile.ZipFile(path, 'w') as archive:
        archive.writestr('mimetype', 'application/epub+zip')
        archive.writestr('META-INF/container.xml', '<container><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>')
        archive.writestr('content.opf', '<package><metadata><title>Fixture book</title><creator>Fixture author</creator></metadata><manifest><item id="chapter" href="chapter.xhtml"/></manifest><spine><itemref idref="chapter"/></spine></package>')
        if not missing_spine:
            archive.writestr('chapter.xhtml', '<html><body>Fixture text.</body></html>')


class LibraryHealthTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.root = self.base / 'library'
        self.root.mkdir()
        self.store = Store(self.base / 'state.sqlite3')
        self.store.initialize()

    def wait_task(self, scan_id):
        for _ in range(200):
            report = self.store.library_scan(scan_id)
            if report['status'] not in ('queued', 'running'):
                return report
            time.sleep(0.01)
        self.fail('Scan did not finish')

    def test_structural_epub_validation_and_stale_reviews(self):
        folder = self.root / 'Author' / 'Book'
        folder.mkdir(parents=True)
        path = folder / 'Book.epub'
        epub(path)
        first = scan_library(self.root, inspect_files=True)
        self.assertEqual(first['files'][0]['integrity'], 'structurally_valid')
        self.assertEqual(first['files'][0]['title'], 'Fixture book')
        book = first['books'][0]
        finding = next(f for f in book['findings'] if f['code'] == 'missing_m4b')
        self.store.review_library_finding(str(self.root), book['path'], finding['key'], book['fingerprint'], 'Ebook only')
        reviewed = with_reviews(first, self.store.library_finding_reviews(str(self.root)))
        self.assertEqual(reviewed['books'][0]['findings'][0]['review_note'], 'Ebook only')
        epub(path, missing_spine=True)
        changed = with_reviews(scan_library(self.root, inspect_files=True), self.store.library_finding_reviews(str(self.root)))
        self.assertEqual(changed['files'][0]['integrity'], 'invalid')
        self.assertTrue(all(f['review_note'] is None for f in changed['books'][0]['findings']))

    def test_audio_probe_does_not_mutate_external_hardlink(self):
        import shutil
        if not shutil.which('ffmpeg') or not shutil.which('ffprobe'):
            self.skipTest('FFmpeg tools required')
        seed = self.base / 'seed.m4b'
        subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=8000:cl=mono',
                        '-t', '0.2', '-c:a', 'aac', '-metadata', 'title=Fixture audio', str(seed)], check=True)
        linked = self.root / 'Book.m4b'
        os.link(seed, linked)
        original, info = seed.read_bytes(), seed.stat()
        report = scan_library(self.root, inspect_files=True)
        self.assertEqual(report['files'][0]['integrity'], 'probe_readable')
        self.assertEqual(report['files'][0]['chapter_count'], 0)
        self.assertIn('missing_audio_chapters', [f['code'] for f in report['books'][0]['findings']])
        self.assertEqual(seed.read_bytes(), original)
        self.assertEqual(seed.stat().st_mtime_ns, info.st_mtime_ns)
        self.assertEqual(seed.stat().st_ino, linked.stat().st_ino)

    def test_worker_persistence_concurrency_recovery_and_cancellation(self):
        epub(self.root / 'Book.epub')
        task = self.store.queue_library_scan(str(self.root))
        with self.assertRaises(ValueError):
            self.store.queue_library_scan(str(self.root))
        worker = LibraryScanner(self.store, [self.root])
        self.addCleanup(worker.stop)
        worker.start()
        report = self.wait_task(task['id'])
        self.assertEqual(report['status'], 'completed')
        self.assertEqual(report['processed_files'], 1)
        history = self.store.list_library_scans()
        self.assertNotIn('files', history[0])
        self.assertEqual(history[0]['summary']['file_count'], 1)
        worker.stop()
        queued = self.store.queue_library_scan(str(self.root))
        self.store.cancel_library_scan(queued['id'])
        self.assertEqual(self.store.library_scan(queued['id'])['status'], 'cancelled')
        interrupted = self.store.queue_library_scan(str(self.root))
        self.store.claim_library_scan()
        self.store.recover_library_scans()
        self.assertEqual(self.store.library_scan(interrupted['id'])['status'], 'failed')

    def test_running_scan_cancel_and_failures(self):
        from threading import Event
        entered, release = Event(), Event()
        def slow_scan(root, **kwargs):
            entered.set()
            release.wait(2)
            if kwargs['cancelled']():
                raise ScanCancelled()
            raise OSError('fixture read error')
        worker = LibraryScanner(self.store, [self.root])
        self.addCleanup(worker.stop)
        with patch('app.library_scans.scan_library', side_effect=slow_scan):
            worker.start()
            task = self.store.queue_library_scan(str(self.root))
            worker.wake.set()
            self.assertTrue(entered.wait(2))
            self.store.cancel_library_scan(task['id'])
            release.set()
            self.assertEqual(self.wait_task(task['id'])['status'], 'cancelled')
            entered.clear()
            task = self.store.queue_library_scan(str(self.root))
            worker.wake.set()
            self.assertEqual(self.wait_task(task['id'])['status'], 'failed')

    def test_scan_reports_unreadable_traversal_and_special_files(self):
        (self.root / 'outside').symlink_to(self.base, target_is_directory=True)
        os.mkfifo(self.root / 'pipe.m4b')
        report = scan_library(self.root, inspect_files=True)
        self.assertFalse(report['complete'])
        self.assertEqual(report['summary']['file_count'], 0)
        self.assertEqual({i['code'] for i in report['issues']}, {'symlink_skipped', 'non_regular_file_skipped'})
        with self.assertRaises(ScanCancelled):
            scan_library(self.root, cancelled=lambda: True)

    def test_legacy_scan_table_migrates_without_losing_reports(self):
        import sqlite3
        legacy = self.base / 'legacy.sqlite3'
        with sqlite3.connect(legacy) as db:
            db.execute('CREATE TABLE library_scans (id TEXT PRIMARY KEY, created_at REAL NOT NULL, root TEXT NOT NULL, report TEXT NOT NULL)')
            db.execute('INSERT INTO library_scans VALUES (?,?,?,?)', ('legacy', 1, str(self.root), json.dumps({'complete': True})))
        store = Store(legacy)
        store.initialize()
        self.assertEqual(store.library_scan('legacy')['status'], 'completed')
        self.assertTrue(store.library_scan('legacy')['complete'])
        report = {'root': str(self.root), 'books': [{'path': str(self.root / 'Book'), 'files': [],
                                                   'findings': [{'code': 'missing_epub'}]}]}
        normalized = with_reviews(report, [])
        self.assertEqual(normalized['books'][0]['title'], 'Book')
        self.assertEqual(normalized['books'][0]['relative_path'], 'Book')
        self.assertTrue(normalized['books'][0]['fingerprint'])
        self.assertTrue(normalized['books'][0]['findings'][0]['key'])
