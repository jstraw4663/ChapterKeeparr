#!/usr/bin/env python3
"""Export a report and first five saved marker excerpts; never reads source media.

Works inside an older ChapterKeeparr container with Python's standard library:
  python export_review_evidence.py JOB_ID --output /tmp/chapter-review.tar.gz
The config path defaults to CONFIG_DIR or /config. Reads SQLite in read-only mode.
"""
import argparse
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import sqlite3
import tarfile

MAX_BYTES = 25 * 1024 * 1024


def build_archive(config, job_id, output):
    config, output = Path(config).resolve(), Path(output).resolve()
    if not re.fullmatch(r'[a-fA-F0-9]{32}', job_id):
        raise ValueError('Expected a 32-character job ID copied from the app.')
    database = config / 'chapterkeeper.sqlite3'
    if not database.is_file():
        raise ValueError(f'No job database at {database}. Check the container name and CONFIG_DIR.')
    with sqlite3.connect(database.as_uri() + '?mode=ro', uri=True) as db:
        row = db.execute('SELECT result FROM jobs WHERE id=?', (job_id,)).fetchone()
    if row is None:
        raise ValueError('Job not found in this container. Check the job ID and container name.')
    result = json.loads(row[0] or '{}')
    report = result.get('report') or {}
    markers = report.get('recovery_draft', {}).get('markers', [])
    if len(markers) < 4:
        raise ValueError('This job has no usable four-marker recovery report. Export the active review job.')
    roots = []
    for filename in (report.get('recovery_evidence_report_path'), result.get('report_path'), result.get('local_report_path')):
        if filename:
            base = Path(filename).resolve().parent
            if base not in roots: roots.append(base)
    job_folder = config / 'jobs' / job_id
    if job_folder.is_dir():
        roots.extend(p.parent.resolve() for p in sorted(job_folder.glob('attempt-*/report.json'), reverse=True) if p.parent.resolve() not in roots)
        roots.append(job_folder.resolve())
    selected, required = {}, []
    for marker in markers[:5]:
        excerpt = marker.get('audio_excerpt')
        if not excerpt: raise ValueError('A selected marker has no saved clip; export its report from the app instead.')
        required.append(excerpt)
        for value in (excerpt, (marker.get('initial_attempt') or {}).get('audio_excerpt')):
            if not value: continue
            rel = PurePosixPath(value)
            if rel.is_absolute() or '..' in rel.parts or rel.suffix.lower() != '.wav':
                raise ValueError('Unexpected excerpt path in the report; no archive written.')
            for relative in (rel, rel.with_suffix('.json')):
                for base in roots:
                    path = (base / str(relative)).resolve()
                    if path.is_relative_to(base) and path.is_file():
                        selected[str(relative)] = path
                        break
    missing = [name for name in required if name not in selected]
    if missing:
        raise ValueError('Saved clips were not found beside the recorded report/attempt paths: ' + ', '.join(missing))
    body = json.dumps(report, indent=2).encode()
    if len(body) + sum(p.stat().st_size for p in selected.values()) > MAX_BYTES:
        raise ValueError('Evidence exceeds 25 MiB; export fewer markers rather than copying the full book.')
    if output.exists(): raise ValueError('Output already exists; choose a new archive filename.')
    temporary = output.with_name(output.name + '.partial')
    try:
        with tarfile.open(temporary, 'w:gz') as archive:
            info = tarfile.TarInfo('report.json'); info.size = len(body); info.mode = 0o600
            archive.addfile(info, io.BytesIO(body))
            for name, path in sorted(selected.items()): archive.add(path, arcname=name, recursive=False)
        with tarfile.open(temporary, 'r:gz') as archive:
            names = archive.getnames()
            if 'report.json' not in names or not all(name in names for name in required):
                raise ValueError('Archive verification failed; no output published.')
        temporary.rename(output)
    finally:
        temporary.unlink(missing_ok=True)
    return names


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('job_id')
    parser.add_argument('--config-dir', default=os.getenv('CONFIG_DIR', '/config'))
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    try:
        names = build_archive(args.config_dir, args.job_id, args.output)
    except (ValueError, OSError, sqlite3.Error, json.JSONDecodeError) as error:
        parser.exit(1, f'Export failed: {error}\n')
    print(f'Verified {len(names)} files in {args.output}')
    for name in names: print(name)


if __name__ == '__main__': main()
