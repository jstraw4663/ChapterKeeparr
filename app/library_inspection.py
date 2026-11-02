"""Bounded structural checks. Successful probing is not a full content check."""
from __future__ import annotations

import json
import math
import os
import posixpath
import shutil
import subprocess
import time
import zipfile
from urllib.parse import unquote
from xml.etree import ElementTree as ET


MAX_ZIP_BYTES = 128 * 1024 * 1024
MAX_XML_BYTES = 2 * 1024 * 1024


def _xml(archive, name):
    if archive.getinfo(name).file_size > MAX_XML_BYTES:
        raise ValueError('EPUB XML exceeds the inspection limit')
    return ET.fromstring(archive.read(name))


def inspect_epub(file):
    with zipfile.ZipFile(file) as archive:
        entries = archive.infolist()
        if len(entries) > 20000 or sum(i.file_size for i in entries) > MAX_ZIP_BYTES:
            return {'integrity': 'not_checked', 'inspection_detail': 'EPUB exceeds structural inspection limits'}
        if any(i.flag_bits & 1 for i in entries):
            return {'integrity': 'unsupported', 'inspection_detail': 'Encrypted ZIP entries require manual review'}
        if archive.read('mimetype').strip() != b'application/epub+zip':
            raise ValueError('EPUB mimetype is missing or invalid')
        container = _xml(archive, 'META-INF/container.xml')
        rootfile = container.find('.//{*}rootfile')
        if rootfile is None or not rootfile.get('full-path'):
            raise ValueError('EPUB package document is missing')
        package_path = rootfile.get('full-path')
        package = _xml(archive, package_path)
        manifest = {item.get('id'): item for item in package.findall('.//{*}manifest/{*}item')}
        spine = package.findall('.//{*}spine/{*}itemref')
        if not spine:
            raise ValueError('EPUB reading order is empty')
        for item in spine:
            source = manifest.get(item.get('idref'))
            if source is None or not source.get('href'):
                raise ValueError('EPUB reading order references an absent manifest item')
            target = posixpath.normpath(posixpath.join(posixpath.dirname(package_path), unquote(source.get('href').split('#')[0])))
            if target not in archive.namelist():
                raise ValueError('EPUB reading order references a missing file')
        # CRC checks are bounded by total declared uncompressed size above.
        if archive.testzip():
            raise ValueError('EPUB archive CRC check failed')
        title = package.find('.//{*}metadata/{*}title')
        creator = package.find('.//{*}metadata/{*}creator')
        protected = False
        if 'META-INF/encryption.xml' in archive.namelist():
            encryption = _xml(archive, 'META-INF/encryption.xml')
            allowed = {'http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC'}
            protected = any(m.get('Algorithm') not in allowed for m in encryption.findall('.//{*}EncryptionMethod'))
        return {'integrity': 'unsupported' if protected else 'structurally_valid',
                'inspection_detail': 'Encrypted content requires manual review' if protected else 'ZIP CRC and EPUB reading-order references checked; text completeness not verified',
                'title': title.text if title is not None else None,
                'author': creator.text if creator is not None else None,
                'spine_items': len(spine)}


def inspect_media(name, directory_fd, expected, suffix, cancelled=None):
    from .inventory import ScanCancelled
    descriptor = None
    try:
        descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory_fd)
        current = os.fstat(descriptor)
        if (current.st_dev, current.st_ino, current.st_size, current.st_mtime_ns) != (expected.st_dev, expected.st_ino, expected.st_size, expected.st_mtime_ns):
            return {'integrity': 'changed', 'inspection_detail': 'File changed during scan; scan again'}
        if suffix == '.epub':
            with os.fdopen(os.dup(descriptor), 'rb') as file:
                result = inspect_epub(file)
        elif suffix in {'.m4b', '.m4a', '.mp3', '.flac', '.ogg', '.opus'}:
            if not shutil.which('ffprobe'):
                return {'integrity': 'not_checked', 'inspection_detail': 'FFprobe is unavailable on this server'}
            # The inherited descriptor prevents a symlink swap from redirecting inspection.
            # Disable network protocols and demuxer file references; only the already-open fd is readable.
            command = ['ffprobe', '-v', 'error', '-protocol_whitelist', 'file,pipe',
                       '-format_whitelist', 'mov,mp3,flac,ogg', '-show_entries',
                       'format=duration:format_tags=title,artist,album:stream=codec_type,codec_name:chapter=id,start_time,end_time',
                       '-of', 'json', f'/proc/self/fd/{descriptor}']
            import tempfile
            with tempfile.TemporaryFile() as output, tempfile.TemporaryFile() as errors:
                process = subprocess.Popen(command, stdout=output, stderr=errors, pass_fds=(descriptor,))
                try:
                    deadline = time.monotonic() + 20
                    while process.poll() is None:
                        if cancelled and cancelled():
                            raise ScanCancelled()
                        if time.monotonic() >= deadline:
                            return {'integrity': 'inspection_failed', 'inspection_detail': 'Audio inspection timed out'}
                        if output.tell() > 2 * 1024 * 1024 or errors.tell() > 1024 * 1024:
                            return {'integrity': 'inspection_failed', 'inspection_detail': 'Audio inspection output exceeded limit'}
                        time.sleep(0.05)
                finally:
                    if process.poll() is None:
                        process.kill()
                    process.wait()
                if process.returncode:
                    return {'integrity': 'invalid', 'inspection_detail': 'FFprobe could not read this audio container'}
                output.seek(0)
                data = json.loads(output.read(2 * 1024 * 1024))
            streams = data.get('streams', [])
            audio = [s for s in streams if s.get('codec_type') == 'audio']
            if not audio:
                raise ValueError('No audio stream found')
            tags = data.get('format', {}).get('tags', {})
            tags = {key.lower(): value for key, value in tags.items()}
            duration = float(data.get('format', {}).get('duration', 0))
            if not math.isfinite(duration) or duration < 0:
                raise ValueError('Audio duration is invalid')
            result = {'integrity': 'probe_readable', 'inspection_detail': 'Audio container inspected; full audio decoding and chapter accuracy not checked',
                      'duration_seconds': duration or None,
                      'codec': audio[0].get('codec_name'), 'chapter_count': len(data.get('chapters', [])),
                      'title': tags.get('title') or tags.get('album'), 'author': tags.get('artist')}
        else:
            result = {'integrity': 'not_checked', 'inspection_detail': 'Deep inspection for this format is not available yet'}
        after = os.fstat(descriptor)
        if (after.st_size, after.st_mtime_ns) != (expected.st_size, expected.st_mtime_ns):
            return {'integrity': 'changed', 'inspection_detail': 'File changed during inspection; scan again'}
        return result
    except (zipfile.BadZipFile, KeyError, ET.ParseError, ValueError, RuntimeError) as error:
        return {'integrity': 'invalid', 'inspection_detail': str(error)[:240]}
    except OSError:
        return {'integrity': 'unreadable', 'inspection_detail': 'File could not be inspected'}
    finally:
        if descriptor is not None:
            os.close(descriptor)
