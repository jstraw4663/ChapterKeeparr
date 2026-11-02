"""Read-only filesystem inventory. Findings are candidates, not edition decisions."""
from __future__ import annotations

import os
import stat
from collections import Counter, defaultdict
from pathlib import Path


EBOOKS = {".epub", ".mobi", ".azw", ".azw3", ".pdf", ".fb2"}
AUDIO = {".m4b", ".mp3", ".m4a", ".flac", ".ogg", ".opus"}


def scan_library(root: Path, max_files: int = 100000) -> dict:
    """Never follow symlinks or open media for writing; preserve partial-scan errors."""
    files, issues = [], []
    folders = defaultdict(list)
    identities = {}

    def walk_error(error):
        issues.append({"path": str(error.filename), "code": "unreadable_directory"})

    for directory, dirs, names in os.walk(root, followlinks=False, onerror=walk_error):
        dirs.sort()
        for name in list(dirs):
            path = Path(directory) / name
            if path.is_symlink():
                dirs.remove(name)
                issues.append({"path": str(path), "code": "symlink_skipped"})
        for name in sorted(names):
            path = Path(directory) / name
            try:
                info = path.lstat()
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
            files.append(item)
            folders[str(path.parent)].append(item)

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
        books.append({"path": folder, "identity": "folder_candidate", "files": entries, "findings": findings})
    return {"root": str(root), "complete": not issues, "issues": issues, "files": files,
            "books": books, "summary": {"file_count": len(files), "book_folder_candidates": len(books),
            "logical_bytes": sum(f["size_bytes"] for f in files),
            "unique_inode_logical_bytes": sum(identities.values()),
            "hardlinked_files": sum(f["link_count"] > 1 for f in files),
            "reclaimable_bytes": None}, "inspection_level": "inventory_only"}
