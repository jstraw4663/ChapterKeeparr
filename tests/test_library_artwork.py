import shutil
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path

from app.inventory import scan_library
from app.library_artwork import library_cover


@unittest.skipUnless(shutil.which('ffmpeg'), 'FFmpeg required')
class LibraryArtworkTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.root = self.base / 'library'
        self.root.mkdir()
        self.png = self.base / 'generated.png'
        subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x96',
                        '-frames:v', '1', '-threads', '1', str(self.png)], check=True)

    def test_local_cover_and_epub_cover_are_read_only_and_cached(self):
        (self.root / 'Book.mobi').write_bytes(b'fixture ebook')
        cover = self.root / 'cover.png'
        cover.hardlink_to(self.png)
        before = self.png.stat(), self.png.read_bytes()
        book = scan_library(self.root)['books'][0]
        result = library_cover(self.root, book, self.base / 'cache')
        self.assertTrue(result.read_bytes().startswith(b'\xff\xd8\xff'))
        self.assertEqual(library_cover(self.root, book, self.base / 'cache'), result)
        self.assertEqual(self.png.read_bytes(), before[1])
        self.assertEqual(self.png.stat().st_mtime_ns, before[0].st_mtime_ns)
        cover.unlink()
        with zipfile.ZipFile(self.root / 'Book.epub', 'w') as archive:
            archive.writestr('META-INF/container.xml', '<container><rootfile full-path="OEBPS/book.opf"/></container>')
            archive.writestr('OEBPS/book.opf', '<package><manifest><item id="cover" properties="cover-image" media-type="image/png" href="cover.png"/></manifest></package>')
            archive.writestr('OEBPS/cover.png', self.png.read_bytes())
        book = scan_library(self.root)['books'][0]
        embedded = library_cover(self.root, book, self.base / 'cache')
        self.assertTrue(embedded.read_bytes().startswith(b'\xff\xd8\xff'))

    def test_changed_files_and_symlink_escapes_are_rejected(self):
        (self.root / 'Book.mobi').write_bytes(b'fixture ebook')
        cover = self.root / 'cover.png'
        cover.write_bytes(self.png.read_bytes())
        book = scan_library(self.root)['books'][0]
        cover.unlink()
        cover.symlink_to(self.png)
        self.assertIsNone(library_cover(self.root, book, self.base / 'cache'))
        folder = self.root / 'Folder'
        folder.mkdir()
        (folder / 'Book.mobi').write_bytes(b'fixture ebook')
        (folder / 'cover.png').write_bytes(self.png.read_bytes())
        book = next(b for b in scan_library(self.root)['books'] if b['path'] == str(folder))
        folder.rename(self.base / 'moved')
        folder.symlink_to(self.base / 'moved', target_is_directory=True)
        self.assertIsNone(library_cover(self.root, book, self.base / 'cache'))
