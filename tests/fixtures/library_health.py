"""Disposable media for the real library-scan UI checks; never points at a real library."""
import subprocess
import sys
import zipfile
from pathlib import Path


def write_epub(path, title):
    with zipfile.ZipFile(path, 'w') as z:
        z.writestr('mimetype', 'application/epub+zip')
        z.writestr('META-INF/container.xml', '<container><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>')
        z.writestr('content.opf', f'<package><metadata><title>{title}</title><creator>Fixture author</creator></metadata><manifest><item id="c" href="chapter.xhtml"/></manifest><spine><itemref idref="c"/></spine></package>')
        z.writestr('chapter.xhtml', '<html><body>Generated fixture text.</body></html>')


def seed(base):
    base.mkdir(parents=True, exist_ok=True)
    root = base / 'library'
    root.mkdir(exist_ok=True)
    chapters = base / 'chapters.txt'
    chapters.write_text(';FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=1000\ntitle=Chapter 1\n')
    audio = base / 'seed.m4b'
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=8000:cl=mono', '-f', 'ffmetadata', '-i', str(chapters), '-map_metadata', '1', '-t', '1', '-c:a', 'aac', '-metadata', 'title=Fixture audiobook', '-metadata', 'artist=Fixture author', str(audio)], check=True)
    samples = [
        ('Matt Dinniman/Dungeon Crawler Carl/01. Dungeon Crawler Carl (2020)', ['01. Dungeon Crawler Carl (2020).epub'], '01. Dungeon Crawler Carl (2020).m4b'),
        ("Matt Dinniman/Dungeon Crawler Carl/05. The Butcher’s Masquerade (2022)", ['05. Dungeon Crawler Carl 5 - The Butcher’s Masquerade.epub'], 'The Butcher’s Masquerade - Matt Dinniman (2022).m4b'),
        ('Max Brooks/World War Z/World War Z (2006)', ['World War Z (2006).epub', 'World War Z - An Oral History of the Zombie War.epub'], 'World War Z - An Oral History of the Zombie War.m4b'),
        ('Octavia Butler/Kindred (1979)', ['Kindred.epub'], None),
        ('Ursula Le Guin/A Wizard of Earthsea (1968)', [], None),
        ('Unknown/Incomplete book', [], None),
    ]
    for folder, ebooks, audiobook in samples:
        book = root / folder
        book.mkdir(parents=True, exist_ok=True)
        for ebook in ebooks:
            write_epub(book / ebook, book.name)
        if audiobook:
            target = book / audiobook
            if not target.exists():
                target.hardlink_to(audio)
    (root / samples[2][0] / 'release.nfo').write_text('Generated release information')
    (root / samples[4][0] / 'Earthsea.mobi').write_bytes(b'Fixture format candidate')
    (root / samples[5][0] / 'Incomplete.epub').write_bytes(b'Broken fixture EPUB')
    (root / 'library-notes.txt').write_text('Root sidecar fixture')
    return root


if __name__ == '__main__':
    print(seed(Path(sys.argv[1])))
