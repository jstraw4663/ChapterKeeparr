"""Read-only filesystem inventory. Findings are candidates, not edition decisions."""
from __future__ import annotations

import os
import stat
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path


EBOOKS = {".epub", ".mobi", ".azw", ".azw3", ".pdf", ".fb2"}
AUDIO = {".m4b", ".mp3", ".m4a", ".flac", ".ogg", ".opus"}


def scan_library(root: Path, max_files: int = 100000, *, progress=None, cancelled=None,
                 inspect_files: bool = False) -> dict:
    """Never follow symlinks or open media for writing; preserve partial-scan errors."""
    files, issues = [], []
    folders = defaultdict(list)
    identities = {}

    def walk_error(error):
        issues.append({"path": str(error.filename), "code": "unreadable_directory"})

    for directory, dirs, names, directory_fd in os.fwalk(root, follow_symlinks=False, onerror=walk_error):
        if cancelled and cancelled():
            raise ScanCancelled()
        dirs.sort()
        for name in list(dirs):
            path = Path(directory) / name
            try:
                mode = os.stat(name, dir_fd=directory_fd, follow_symlinks=False).st_mode
            except OSError:
                dirs.remove(name)
                issues.append({'path': str(path), 'code': 'unreadable_directory'})
                continue
            if stat.S_ISLNK(mode):
                dirs.remove(name)
                issues.append({"path": str(path), "code": "symlink_skipped"})
        for name in sorted(names):
            if cancelled and cancelled():
                raise ScanCancelled()
            path = Path(directory) / name
            try:
                info = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
            except OSError:
                issues.append({"path": str(path), "code": "unreadable_file"})
                continue
            if not stat.S_ISREG(info.st_mode):
                issues.append({"path": str(path), "code": "non_regular_file_skipped"})
                continue
            if len(files) >= max_files:
                raise ValueError(f"Scan exceeds the {max_files} file limit; choose a smaller folder")
            suffix = path.suffix.lower()
            kind = "ebook" if suffix in EBOOKS else "audio" if suffix in AUDIO else "sidecar"
            identity = (info.st_dev, info.st_ino)
            identities[identity] = info.st_size
            item = {"path": str(path), "relative_path": str(path.relative_to(root)),
                    "format": suffix.lstrip("."), "kind": kind, "size_bytes": info.st_size,
                    "mtime_ns": info.st_mtime_ns, "device": info.st_dev, "inode": info.st_ino,
                    "link_count": info.st_nlink, "integrity": "not_checked"}
            if inspect_files and kind != 'sidecar':
                from .library_inspection import inspect_media
                item.update(inspect_media(name, directory_fd, info, suffix, cancelled))
            files.append(item)
            folders[str(path.parent)].append(item)
            if progress and (len(files) % 10 == 0):
                progress(len(files))

    books = []
    for folder, entries in sorted(folders.items()):
        media = [f for f in entries if f["kind"] != "sidecar"]
        if not media:
            continue
        counts = Counter(f["format"] for f in media)
        findings = []
        for fmt in ("epub", "m4b"):
            if not counts[fmt]:
                findings.append({"code": f"missing_{fmt}"})
            if counts[fmt] > 1:
                findings.append({"code": "multiple_format_candidates", "format": fmt, "count": counts[fmt]})
        if counts["mp3"] and not counts["m4b"]:
            findings.append({"code": "audio_conversion_candidate"})
        if any(counts[f] for f in ("mobi", "azw3", "azw", "pdf")) and not counts["epub"]:
            findings.append({"code": "ebook_conversion_candidate"})
        pair = [Path(f["path"]).stem for f in media if f["format"] in ("epub", "m4b")]
        if counts["epub"] == counts["m4b"] == 1 and len(set(pair)) > 1:
            findings.append({"code": "pair_filename_mismatch"})
        if any(f["size_bytes"] == 0 for f in media):
            findings.append({"code": "empty_media_file"})
        if any(f["kind"] == "sidecar" for f in entries):
            findings.append({"code": "sidecars_present"})
        for item in media:
            if item['integrity'] in ('invalid', 'unreadable', 'changed', 'inspection_failed'):
                findings.append({'code': 'file_inspection_problem', 'file': item['path'], 'detail': item.get('inspection_detail', '')})
            if item['format'] == 'm4b' and item.get('chapter_count') == 0:
                findings.append({'code': 'missing_audio_chapters', 'file': item['path']})
            if item['integrity'] in ('structurally_valid', 'probe_readable') and not item.get('title'):
                findings.append({'code': 'missing_embedded_title', 'file': item['path']})
            if item['integrity'] in ('structurally_valid', 'probe_readable') and not item.get('author'):
                findings.append({'code': 'missing_embedded_author', 'file': item['path']})
        fingerprint = hashlib.sha256(json.dumps(entries, sort_keys=True).encode()).hexdigest()
        for finding in findings:
            finding['key'] = hashlib.sha256(json.dumps(finding, sort_keys=True).encode()).hexdigest()[:24]
        books.append({"path": folder, "relative_path": str(Path(folder).relative_to(root)),
                      "title": Path(folder).name, "identity": "folder_candidate", "fingerprint": fingerprint,
                      "files": entries, "findings": findings})
    if progress:
        progress(len(files))
    return {"root": str(root), "complete": not issues, "issues": issues, "files": files,
            "books": books, "summary": {"file_count": len(files), "book_folder_candidates": len(books),
            "logical_bytes": sum(f["size_bytes"] for f in files),
            "unique_inode_logical_bytes": sum(identities.values()),
            "hardlinked_files": sum(f["link_count"] > 1 for f in files),
            "reclaimable_bytes": None}, "inspection_level": 'structural' if inspect_files else 'inventory_only'}


class ScanCancelled(Exception):
    pass


def with_reviews(report: dict, reviews: list[dict]) -> dict:
    decisions = {(r['folder'], r['finding'], r['fingerprint']): r['note'] for r in reviews}
    for book in report.get('books', []):
        book.setdefault('id', hashlib.sha256(book['path'].encode()).hexdigest()[:24])
        # The first inventory slice saved reports before review identities existed.
        book.setdefault('title', Path(book['path']).name)
        book.setdefault('relative_path', os.path.relpath(book['path'], report['root']))
        if 'fingerprint' not in book:
            book['fingerprint'] = hashlib.sha256(json.dumps(book['files'], sort_keys=True).encode()).hexdigest()
        for finding in book['findings']:
            if 'key' not in finding:
                finding['key'] = hashlib.sha256(json.dumps(finding, sort_keys=True).encode()).hexdigest()[:24]
            finding['review_note'] = decisions.get((book['path'], finding['key'], book['fingerprint']))
    return report
