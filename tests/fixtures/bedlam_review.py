"""Turn ONLY the synthetic Moby-Dick job created by ui_seed.py into a very large chapter draft.
Usage: python tests/fixtures/bedlam_review.py /tmp/ck-ui
Sized like The Eye of the Bedlam Bride (about 180 markers, most unconfirmed) to check that the
chapter draft review stays smooth. Generated tone excerpts and illustrative text; deliberately
non-publishable.
"""
import json
from pathlib import Path
import random
import sqlite3
import subprocess
import sys
import time

MARKERS = 180


def expand(root):
    root = Path(root).resolve(); config = root / 'config'
    with sqlite3.connect(config / 'chapterkeeper.sqlite3') as db:
        matches = []
        for job_id, raw in db.execute('SELECT id,result FROM jobs'):
            result = json.loads(raw or '{}'); report = result.get('report', {})
            if report.get('identity', {}).get('narrator') == 'Dee Fixture' and report.get('identity', {}).get('title') == 'Moby-Dick':
                matches.append((job_id, result, report))
        if len(matches) != 1:
            raise SystemExit('Expected exactly one synthetic Dee Fixture Moby-Dick job. No changes made.')
        job_id, result, report = matches[0]
        rng = random.Random(6)
        # Published chapters every ~5 minutes; local markers mostly drift a few seconds,
        # some far off, some extra boundaries, and a few chapters with no marker at all.
        published = [{'start': i * 300, 'title': 'Opening Credits' if i == 0 else f'Chapter {i}'} for i in range(MARKERS + 6)]
        missing = set(rng.sample(range(5, len(published) - 1), 6))
        local = [c for i, c in enumerate(published) if i not in missing][:MARKERS]
        folder = config / 'jobs' / job_id; clips = folder / 'recovery-clips'; clips.mkdir(parents=True, exist_ok=True)
        tone = clips / 'bedlam-tone.wav'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=15', '-ar', '16000', '-ac', '1', str(tone)], check=True)
        markers = []
        for i, c in enumerate(local):
            supported = i == 0 or rng.random() < 0.3
            drift = 0 if supported else rng.choice([2, -3, 4, 6, -8, 25, 70, 150])
            at = max(0, c['start'] + drift) if i else 0
            markers.append(dict(old_title=f'Track {i + 1:03d}', old_seconds=at, new_seconds=at,
                                title=c['title'] if supported else None, reference_start=c['start'] if supported else None,
                                status='supported' if supported else 'unresolved', confidence='spoken heading' if supported else 'unconfirmed',
                                source='Synthetic fixture', reason='Bedlam-sized synthetic draft',
                                transcript='' if i % 23 == 7 else f'[Test scenario] Spoken words near marker {i + 1}.',
                                audio_excerpt=None if i % 23 == 7 else 'recovery-clips/bedlam-tone.wav'))
        markers.sort(key=lambda m: m['old_seconds'])
        end = published[-1]['start'] + 300
        refs = [dict(c, end=published[i + 1]['start'] if i + 1 < len(published) else end) for i, c in enumerate(published)]
        report['recovery_draft'] = dict(complete=True, markers=markers, total_markers=len(markers), reference_chapters=refs,
                                        timeline_hash='synthetic-nonpublishable-bedlam-v1', source_sha256='synthetic-no-real-audio', duration_seconds=end)
        report['source_duration_seconds'] = end
        report.setdefault('edition', {})['publisher'] = 'Synthetic UI fixture — tone excerpts, illustrative text'
        report['edition'].setdefault('asin', 'B0CDXWSS5D'); report['edition'].setdefault('title', 'Moby-Dick')
        report['review_reason'] = {'category': 'chapters', 'detail': f'Bedlam-sized synthetic fixture: {len(markers)} markers, most unconfirmed. No real audiobook.'}
        result['report'] = report
        (folder / 'report.json').write_text(json.dumps(report, indent=2))
        db.execute('UPDATE jobs SET result=?,updated_at=? WHERE id=?', (json.dumps(result), time.time(), job_id))
        unresolved = sum(m['status'] != 'supported' for m in markers)
        print(f'Updated synthetic job {job_id}: {len(markers)} markers ({unresolved} unconfirmed), {len(refs)} published sections')


if __name__ == '__main__':
    expand(sys.argv[1])
