"""Installed build identity and a bounded, manual, read-only release check."""
from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

REPOSITORY = "jstraw4663/ChapterKeeparr"
RELEASES = f"https://github.com/{REPOSITORY}/releases"


def build_info() -> dict:
    root = Path(__file__).parent
    info = json.loads((root / "build-info.json").read_text())
    # Source checkouts have an actual revision; container builds embed theirs.
    if not info.get("revision") and (root.parent / ".git").exists():
        try:
            info["revision"] = subprocess.check_output(
                ["git", "rev-parse", "HEAD"], cwd=root.parent, timeout=2,
                stderr=subprocess.DEVNULL, text=True).strip()
        except (OSError, subprocess.SubprocessError):
            pass
    static = root / "static"
    digest = hashlib.sha256()
    for file in sorted(static.rglob("*")):
        if file.is_file():
            digest.update(str(file.relative_to(static)).encode())
            digest.update(file.read_bytes())
    marker = re.search(r'''ASSET_VERSION = ['"]([^'"]+)['"]''', (static / "js/assets.js").read_text())
    return {**info, "frontend_assets": digest.hexdigest()[:16],
            "frontend_version": marker[1] if marker else None,
            "speech_backend": os.getenv("SPEECH_BACKEND", "faster-whisper"),
            "model": Path(os.getenv("MODEL", "/opt/models/small.en")).name,
            "release_notes_url": RELEASES}


def stamp_build(root: Path) -> None:
    """Called only during an image build; share identity across API, tab and PWA."""
    file = root / "build-info.json"
    info = json.loads(file.read_text())
    info.update(version=os.getenv("APP_VERSION") or info["version"],
                channel=os.getenv("BUILD_CHANNEL") or "development",
                revision=os.getenv("BUILD_REVISION") or None,
                built_at=os.getenv("BUILD_DATE") or None)
    file.write_text(json.dumps(info))
    identity = f"{info['version']}@{info['revision']}" if info['revision'] else f"{info['version']}@development"
    (root / "static/js/assets.js").write_text("export const ASSET_VERSION = " + json.dumps(identity) + ";\n")
    worker = root / "static/sw.js"
    cache = "chapterkeeparr-shell-" + hashlib.sha256(identity.encode()).hexdigest()[:20]
    text, count = re.subn(r"const CACHE = '[^']+';", lambda _: "const CACHE = '" + cache + "';", worker.read_text(), count=1)
    if count != 1:
        raise ValueError("Service worker cache identity could not be stamped")
    worker.write_text(text)


def stable_version(value):
    match = re.fullmatch(r"v?(\d+)\.(\d+)\.(\d+)", value or "")
    return tuple(map(int, match.groups())) if match else None


class UpdateChecker:
    """One request at a time; repeated clicks reuse the result for five minutes."""
    def __init__(self, installed):
        self.installed = installed
        self.lock = threading.Lock()
        self.result = None
        self.expires = 0

    def check(self):
        with self.lock:
            if self.result and time.monotonic() < self.expires:
                return self.result
            result = {"state": "unknown", "checked_at": datetime.now(timezone.utc).isoformat(),
                      "latest_version": None, "release_notes_url": RELEASES,
                      "message": "Unable to determine the latest release."}
            try:
                with requests.get(f"https://api.github.com/repos/{REPOSITORY}/releases/latest",
                                  headers={"Accept": "application/vnd.github+json", "User-Agent": "ChapterKeeparr-update-check"},
                                  timeout=(3, 5), allow_redirects=False, stream=True) as response:
                    if response.status_code != 200:
                        result["message"] = f"Release check unavailable (HTTP {response.status_code}). The repository may be private, have no published release, or be rate limited."
                    else:
                        chunks = []; size = 0; deadline = time.monotonic() + 8
                        for chunk in response.iter_content(16384):
                            size += len(chunk)
                            if size > 1024 * 1024 or time.monotonic() > deadline:
                                raise ValueError("Release response too large")
                            chunks.append(chunk)
                        release = json.loads(b"".join(chunks))
                        if not isinstance(release, dict):
                            raise ValueError("Invalid release response")
                        latest = stable_version(release.get("tag_name"))
                        current = stable_version(self.installed.get("version"))
                        result["latest_version"] = release.get("tag_name")
                        if latest and current and not release.get("draft") and not release.get("prerelease") and self.installed.get("channel") == "release":
                            result["state"] = "available" if latest > current else "current" if latest == current else "ahead"
                            result["message"] = {"available": "An update is available.", "current": "Up to date.", "ahead": "This build is newer than the latest published release."}[result["state"]]
                        else:
                            result["message"] = "Latest release found; this development or unrecognized build cannot be compared reliably."
            except (requests.RequestException, ValueError, TypeError):
                result["message"] = "Release check failed. Check the server’s connection and try again later."
            self.result = result
            self.expires = time.monotonic() + 300
            return result


if __name__ == "__main__":
    stamp_build(Path(__file__).parent)
