"""Local inventory covers, confined to fingerprinted files in a saved scan."""
import hashlib
import os
import posixpath
import stat
import subprocess
import tempfile
import zipfile
from pathlib import Path
from urllib.parse import unquote
from xml.etree import ElementTree as ET

MAX_ART_BYTES = 6 * 1024 * 1024


def _epub_art(file):
    with zipfile.ZipFile(file) as archive:
        if len(archive.infolist()) > 20000:
            return None
        def read(name, limit=2 * 1024 * 1024):
            info = archive.getinfo(name)
            if info.file_size > limit:
                raise ValueError('Artwork inspection limit exceeded')
            return archive.read(name)
        container = ET.fromstring(read('META-INF/container.xml'))
        rootfile = container.find('.//{*}rootfile')
        if rootfile is None:
            return None
        package_path = rootfile.get('full-path', '')
        package = ET.fromstring(read(package_path))
        legacy = next((m.get('content') for m in package.findall('.//{*}metadata/{*}meta') if m.get('name') == 'cover'), None)
        manifest = package.findall('.//{*}manifest/{*}item')
        item = next((i for i in manifest if 'cover-image' in i.get('properties', '').split()), None)
        if item is None and legacy:
            item = next((i for i in manifest if i.get('id') == legacy), None)
        if item is None or item.get('media-type') not in ('image/jpeg', 'image/png'):
            return None
        target = posixpath.normpath(posixpath.join(posixpath.dirname(package_path), unquote(item.get('href', '').split('#')[0])))
        data = read(target, MAX_ART_BYTES)
        return data if data.startswith((b'\xff\xd8\xff', b'\x89PNG\r\n\x1a\n')) else None


def _open_scanned(root, item):
    """Open every directory without symlinks; return a bound regular-file fd."""
    relative = Path(item['path']).relative_to(root)
    if not relative.parts or '..' in relative.parts:
        raise ValueError('Artwork source is outside the library')
    directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for component in relative.parts[:-1]:
            child = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
            os.close(directory)
            directory = child
        fd = os.open(relative.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
    finally:
        os.close(directory)
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode) or (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns) != tuple(item[k] for k in ('device', 'inode', 'size_bytes', 'mtime_ns')):
        os.close(fd)
        raise ValueError('Source changed since scan')
    return fd


def library_cover(root, book, cache_dir):
    cache_dir = Path(cache_dir)
    try:
        cache_dir.mkdir(parents=True, exist_ok=True)
    except OSError:
        return None
    key = hashlib.sha256((book['path'] + book['fingerprint']).encode()).hexdigest()
    output = cache_dir / (key + '.jpg')
    if output.is_file():
        return output
    known = {'cover.jpg', 'cover.jpeg', 'cover.png', 'folder.jpg', 'folder.jpeg', 'folder.png'}
    candidates = sorted(book['files'], key=lambda f: 0 if Path(f['path']).name.lower() in known else 1 if f['format'] == 'epub' else 2)
    for item in candidates:
        local_art = Path(item['path']).name.lower() in known
        if not local_art and item['format'] not in ('epub', 'm4b', 'm4a', 'mp3'):
            continue
        descriptor = None
        temporary = None
        try:
            descriptor = _open_scanned(Path(root), item)
            data = None
            if local_art:
                if item['size_bytes'] > MAX_ART_BYTES:
                    continue
                data = os.read(descriptor, MAX_ART_BYTES + 1)
                if not data.startswith((b'\xff\xd8\xff', b'\x89PNG\r\n\x1a\n')):
                    continue
            elif item['format'] == 'epub':
                with os.fdopen(os.dup(descriptor), 'rb') as file:
                    data = _epub_art(file)
                if not data:
                    continue
            command = ['ffmpeg', '-nostdin', '-v', 'error', '-max_alloc', '67108864', '-protocol_whitelist', 'file,pipe']
            if data is not None:
                command += ['-f', 'image2pipe', '-i', 'pipe:0']
            else:
                command += ['-format_whitelist', 'mov,mp3', '-i', f'/proc/self/fd/{descriptor}', '-map', '0:v:0']
            with tempfile.NamedTemporaryFile(dir=cache_dir, suffix='.jpg', delete=False) as file:
                temporary = Path(file.name)
            command += ['-frames:v', '1', '-vf', 'scale=192:192:force_original_aspect_ratio=decrease', '-q:v', '3', '-y', str(temporary)]
            result = subprocess.run(command, input=data, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                    pass_fds=(descriptor,), timeout=10, check=False)
            if result.returncode == 0 and temporary.stat().st_size:
                os.replace(temporary, output)
                return output
        except (OSError, ValueError, KeyError, zipfile.BadZipFile, ET.ParseError, RuntimeError, subprocess.TimeoutExpired):
            continue
        finally:
            if descriptor is not None:
                os.close(descriptor)
            if temporary is not None:
                temporary.unlink(missing_ok=True)
    return None
