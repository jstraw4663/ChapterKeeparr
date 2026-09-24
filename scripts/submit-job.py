#!/usr/bin/env python3
"""Submit a final library audio path to a ChapterKeeparr API queue."""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", help="path to a completed audio file inside the mounted library")
    parser.add_argument("--url", default=os.environ.get("CHAPTERKEEPER_URL", "http://localhost:8000"),
                        help="ChapterKeeparr base URL (default: CHAPTERKEEPER_URL or http://localhost:8000)")
    args = parser.parse_args()

    source = args.path.strip()
    if not source.startswith("/") or "\x00" in source:
        parser.error("path must be an absolute path inside the container, such as /library/Author/Book.m4b")

    body = json.dumps({"path": source}).encode("utf-8")
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    token = os.environ.get("CHAPTERKEEPER_API_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"

    request = urllib.request.Request(args.url.rstrip("/") + "/api/jobs", data=body,
                                     headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = response.read(1024 * 1024).decode("utf-8", errors="replace")
            print(payload or f"HTTP {response.status}")
            return 0
    except urllib.error.HTTPError as exc:
        details = exc.read(8192).decode("utf-8", errors="replace")
        print(f"ChapterKeeparr returned HTTP {exc.code}: {details}", file=sys.stderr)
        return 1
    except (urllib.error.URLError, TimeoutError) as exc:
        print(f"Could not reach ChapterKeeparr: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
