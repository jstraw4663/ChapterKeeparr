"""Dev-only UI fixture: a throwaway config DB with one job in every state.

Never used by the app or the test suite. It writes only under the folder you
pass, and every audio file is generated with FFmpeg (no real audiobooks):

    python tests/fixtures/ui_seed.py /tmp/ck-ui
    CONFIG_DIR=/tmp/ck-ui/config LIBRARY_ROOTS=/tmp/ck-ui/library ENABLE_WORKERS=0 \
        python -m uvicorn app.api:create_app --factory --port 8765
"""
from __future__ import annotations

import json
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from app.db import Store  # noqa: E402
from app.flow import POLICY_VERSION, GATES  # noqa: E402

NOW = time.time()
CHAPTERS = [('Opening Credits', 0), ('Chapter 1', 20), ('Chapter 2', 70), ('Chapter 3', 125), ('Chapter 4', 180), ('Chapter 5', 240), ('End Credits', 290)]


def m4b(path: Path, seconds: int = 300) -> None:
    """A short generated tone with chapter markers, for spot-check playback."""
    path.parent.mkdir(parents=True, exist_ok=True)
    meta = path.with_suffix('.ffmeta')
    lines = [';FFMETADATA1', 'title=Generated fixture']
    for i, (title, start) in enumerate(CHAPTERS):
        end = CHAPTERS[i + 1][1] if i + 1 < len(CHAPTERS) else seconds
        lines += ['[CHAPTER]', 'TIMEBASE=1/1', f'START={start}', f'END={end}', f'title={title}']
    meta.write_text('\n'.join(lines) + '\n')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', f'sine=frequency=330:duration={seconds}',
                    '-i', str(meta), '-map_metadata', '1', '-map_chapters', '1', '-c:a', 'aac', '-b:a', '48k',
                    str(path)], check=True)
    meta.unlink()


def gates(states, details=None):
    details = details or {}
    return {key: {'label': label, 'state': states[i] if i < len(states) else 'waiting',
                  'detail': details.get(key, 'Not started'), 'updated_at': NOW - 600 + i * 60}
            for i, (key, label) in enumerate(GATES)}


def base_report(title, author, narrator, asin, states, **extra):
    report = {'policy_version': POLICY_VERSION, 'gates': gates(states),
              'assessment': {'recording': {'level': 'compatible', 'detail': 'Title, author, narrator and runtime checks passed'},
                             'coverage': {'level': 'no_known_gaps', 'detail': 'No gap detected by inventory/runtime checks'},
                             'alignment': {'level': 'compatible', 'detail': 'Published timeline matches local markers'},
                             'speech': {'level': 'sampled', 'detail': '6 required speech checks passed'},
                             'integrity': {'level': 'passed', 'detail': 'Output decoded and validated'}},
              'identity': {'title': title, 'author': author, 'narrator': narrator, 'asin': asin}}
    if asin:
        report['edition'] = {'asin': asin, 'title': title, 'authors': author, 'narrators': narrator,
                             'publisher': 'Fixture Audio', 'runtime_seconds': 300, 'cover_url': None}
        report['selected_recording'] = {'asin': asin, 'region': 'us'}
    report.update(extra)
    return report


def checks(passed=True, fail_at=()):
    return [{'title': title, 'boundary_seconds': start, 'passed': passed and i not in fail_at,
             'transcript': f'{title}. The narrator begins the {title.lower()} here.',
             'audio_excerpt': f'attempt-01/check-{i + 1:03d}.wav', 'method': 'spoken_number'}
            for i, (title, start) in enumerate(CHAPTERS[1:6])]


def main(folder: str) -> None:
    base = Path(folder).resolve()
    library, config = base / 'library', base / 'config'
    config.mkdir(parents=True, exist_ok=True)
    store = Store(config / 'chapterkeeper.sqlite3')
    store.initialize()

    def job(rel, status, report, *, progress=1.0, stage=None, options=None, error=None, age=0, review_answer=None, speech=None, cancel=False):
        path = library / rel
        path.mkdir(parents=True, exist_ok=True)
        record, _ = store.enqueue(path, options or {})
        result = {'report': report, 'report_path': str(config / 'jobs' / record['id'] / 'report.json')}
        if speech:
            result['speech_check'] = speech
            result['activity'] = f"Listening locally {speech['current']}/{speech['total']}: Chapter {speech['current']}"
        t = NOW - age
        with sqlite3.connect(store.path) as db:
            db.execute('UPDATE jobs SET status=?, stage=?, progress=?, result=?, error=?, created_at=?, updated_at=?, '
                       'started_at=?, finished_at=?, attempts=1, review_answer=?, cancel_requested=? WHERE id=?',
                       (status, stage or status, progress, json.dumps(result), error, t - 3600, t, t - 3000,
                        None if status in ('running', 'queued', 'awaiting_review') else t,
                        json.dumps(review_answer) if review_answer else None, int(cancel), record['id']))
        return record['id']

    dracula = library / 'Bram Stoker' / 'Dracula'
    m4b(dracula / 'Dracula.m4b')
    (dracula / 'Dracula.epub').write_bytes(b'fixture')
    job('Bram Stoker/Dracula', 'complete', base_report('Dracula', 'Bram Stoker', 'Alan Fixture', 'B000FIXT01', ['passed'] * 5,
        mode='repair_existing', output=str(dracula / 'Dracula.m4b'), checks=checks(), verification_scope='sampled',
        epub={'title': 'Dracula', 'path': str(dracula / 'Dracula.epub')}, output_sha256='abc', mp3s_deleted=0), age=86400)
    emma = library / 'Jane Austen' / 'Emma'
    m4b(emma / 'Emma.m4b')
    job('Jane Austen/Emma', 'complete', base_report('Emma', 'Jane Austen', 'Bea Fixture', 'B000FIXT02', ['passed'] * 5,
        mode='convert_then_repair', output=str(emma / 'Emma.m4b'), checks=checks(), output_sha256='abd', mp3s_deleted=0,
        epub={'title': 'Emma', 'path': str(emma / 'Emma.epub')}), options={'keep_mp3s': True}, age=7200)
    job('Jane Austen/Persuasion', 'complete', base_report('Persuasion', 'Jane Austen', 'Bea Fixture', 'B000FIXT03', ['passed'] * 5,
        mode='repair_existing', checks=checks(), output_sha256='abe'), age=5400)
    for i, (author, title) in enumerate([('H. G. Wells', 'The Island of Doctor Moreau'), ('Jules Verne', 'Around the World in Eighty Days'),
                                         ('Alexandre Dumas', 'The Three Musketeers'), ('Arthur Conan Doyle', 'A Study in Scarlet'),
                                         ('Arthur Conan Doyle', 'The Sign of the Four'), ('Mary Shelley', 'The Last Man')]):
        job(f'{author}/{title}', 'complete', base_report(title, author, 'Fixture Reader', f'B000FIXT{10 + i}', ['passed'] * 5,
            mode='repair_existing', checks=checks(), output_sha256=f'x{i}',
            epub={'title': title, 'path': f'/fixture/{title}.epub'} if i % 2 else None), age=200000 + i * 3600)
    job('H. G. Wells/The Invisible Man', 'running', base_report('The Invisible Man', 'H. G. Wells', 'Cal Fixture', 'B000FIXT04',
        ['passed', 'passed', 'passed', 'working'], checks=checks()[:2]), progress=0.62, stage='checking_speech',
        speech={'current': 12, 'total': 40}, age=30)
    job('Herman Melville/Moby-Dick', 'awaiting_review', base_report('Moby-Dick', 'Herman Melville', 'Dee Fixture', 'B0CDXWSS5D', ['passed', 'review'],
        review_reason={'category': 'identity', 'detail': 'Metadata provider has no entry for this ID/region or chapter timeline (HTTP 404). This does not prove the ASIN is invalid. Try a different region or audiobook ASIN.'},
        reason='HTTP 404 · https://api.audnex.us/books/B0CDXWSS5D/chapters?region=us',
        edition_attempts=[{'asin': 'B0CDXWSS5D', 'passed': False, 'alignment': {'matching_boundaries': 12}, 'checks': checks(fail_at=(0, 2, 3, 4))}],
        checks=checks(fail_at=(0, 2, 3, 4))), progress=0.35, age=900)
    draft_markers = [{'old_title': t, 'title': t, 'old_seconds': s, 'new_seconds': s, 'status': 'supported' if i != 3 else 'unresolved',
                      'reference_start': s, 'reason': 'Spoken heading heard', 'source': 'speech', 'confidence': 'high',
                      'transcript': f'{t}.', 'audio_excerpt': f'recovery-clips/m{i:03d}.wav'} for i, (t, s) in enumerate(CHAPTERS)]
    refs = [{'start': s, 'title': t} for t, s in CHAPTERS] + [{'start': 295, 'title': 'Secret Skit'}]
    job('Mary Shelley/Frankenstein', 'awaiting_review', base_report('Frankenstein; or, The Modern Prometheus — An Unabridged Dramatic Reading', 'Mary Shelley', 'Eve Fixture, Second Fixture, Third Fixture, Fourth Fixture', 'B000FIXT05',
        ['passed', 'passed', 'review'],
        review_reason={'category': 'chapters', 'detail': 'Possible missing content or an edited recording: Local audio is 62.6 seconds shorter than the published timeline'},
        coverage_warnings=['Local audio is 62.6 seconds shorter than the published timeline; missing content or an edition edit needs review'],
        recovery_draft={'complete': True, 'markers': draft_markers, 'total_markers': len(draft_markers), 'supported_count': 6, 'unresolved_count': 1,
                        'missing_sections': [{'start': 295, 'title': 'Secret Skit'}], 'reference_chapters': refs, 'timeline_hash': 'fixture'}),
        progress=0.5, age=1800)
    job('H. G. Wells/The Time Machine', 'failed', base_report('The Time Machine', 'H. G. Wells', 'Fay Fixture', None, ['passed', 'passed', 'blocked'],
        review_reason={'category': 'operational', 'detail': 'ffmpeg exited with status 1 while decoding track 07'}),
        progress=0.4, error='ffmpeg exited with status 1 while decoding track 07', age=3000)
    job('Jane Austen/Pride and Prejudice', 'queued', {}, progress=0, age=10)
    job('Arthur Conan Doyle/The Hound of the Baskervilles', 'cancelled', base_report('The Hound of the Baskervilles', 'Arthur Conan Doyle', None, None, ['passed', 'working']), progress=0.2, age=40000)
    job('Robert Louis Stevenson/Treasure Island', 'skipped', base_report('Treasure Island', 'Robert Louis Stevenson', 'Gus Fixture', 'B000FIXT06', ['passed'] * 5,
        output_sha256='abf', mode='repair_existing', checks=checks()), age=100000)
    (library / 'incoming' / 'The War of the Worlds').mkdir(parents=True, exist_ok=True)
    for n in range(1, 4):
        (library / 'incoming' / 'The War of the Worlds' / f'{n:02d}.mp3').write_bytes(b'')
    print(f'Seeded {base}. Start with CONFIG_DIR={config} LIBRARY_ROOTS={library} ENABLE_WORKERS=0')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else '/tmp/ck-ui')
