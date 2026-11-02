"""Disposable media for the real library-scan UI checks; never points at a real library."""
import subprocess
import sys
import zipfile
from pathlib import Path


def write_epub(path, title, art=None):
    with zipfile.ZipFile(path, 'w') as z:
        z.writestr('mimetype', 'application/epub+zip')
        z.writestr('META-INF/container.xml', '<container><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>')
        cover = '<item id="cover" properties="cover-image" media-type="image/png" href="cover.png"/>' if art else ''
        z.writestr('content.opf', f'<package><metadata><title>{title}</title><creator>Fixture author</creator></metadata><manifest>{cover}<item id="c" href="chapter.xhtml"/></manifest><spine><itemref idref="c"/></spine></package>')
        if art:
            z.writestr('cover.png', art.read_bytes())
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
    for index, (folder, ebooks, audiobook) in enumerate(samples):
        book = root / folder
        book.mkdir(parents=True, exist_ok=True)
        art = base / f'fixture-cover-{index}.png'
        colors = ['0x5A3A36', '0x3D4F3A', '0x6B5238', '0x4A405D', '0x3E4B57', '0x6A493E']
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-f', 'lavfi', '-i', f'color=c={colors[index]}:s=128x192',
                        '-vf', 'drawbox=x=14:y=24:w=100:h=8:color=white@0.8:t=fill,drawbox=x=14:y=44:w=72:h=6:color=white@0.5:t=fill,drawbox=x=14:y=154:w=80:h=4:color=white@0.5:t=fill',
                        '-frames:v', '1', '-threads', '1', str(art)], check=True)
        for ebook in ebooks:
            write_epub(book / ebook, book.name, art)
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
