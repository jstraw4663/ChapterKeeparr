import os
import tempfile
import unittest
from pathlib import Path

from app.inventory import scan_library
from app.db import Store


class InventoryTests(unittest.TestCase):
    def test_candidates_hardlinks_and_read_only_scan(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            root = base / 'library'
            book = root / 'Max Brooks' / 'World War Z' / 'World War Z (2006)'
            book.mkdir(parents=True)
            seed = base / 'seed.m4b'
            seed.write_bytes(b'original audio')
            audio = book / 'World War Z - Oral History.m4b'
            os.link(seed, audio)
            (book / 'World War Z (2006).epub').write_bytes(b'ebook one')
            (book / 'World War Z.epub').write_bytes(b'ebook two')
            (book / 'release.nfo').write_text('release information')
            (root / 'outside').symlink_to(base, target_is_directory=True)
            before = audio.stat()
            report = scan_library(root)
            codes = {f['code'] for f in report['books'][0]['findings']}
            self.assertIn('multiple_format_candidates', codes)
            self.assertIn('sidecars_present', codes)
            self.assertFalse(report['complete'])
            self.assertEqual(report['summary']['hardlinked_files'], 1)
            self.assertIsNone(report['summary']['reclaimable_bytes'])
            self.assertEqual(seed.read_bytes(), b'original audio')
            self.assertEqual(audio.stat().st_ino, before.st_ino)
            self.assertEqual(audio.stat().st_mtime_ns, before.st_mtime_ns)
            store = Store(base / 'config.sqlite3')
            store.initialize()
            saved = store.save_library_scan(report)
            reopened = Store(base / 'config.sqlite3')
            self.assertEqual(reopened.library_scan(saved['id']), saved)

    def test_pair_naming_empty_files_and_limits(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'Book.epub').touch()
            (root / 'Different.m4b').touch()
            report = scan_library(root)
            codes = {f['code'] for f in report['books'][0]['findings']}
            self.assertEqual(codes, {'pair_filename_mismatch', 'empty_media_file'})
            self.assertEqual(report['files'][0]['integrity'], 'not_checked')
            with self.assertRaises(ValueError):
                scan_library(root, max_files=1)
