"""Evidence-backed review coverage, separate from speech and content completeness."""
import math
import re
import statistics
from . import engine

VERSION = 'review-evidence-1'


def metadata(remote, markers):
    scope = ''
    sections = []
    identities = {}
    for c in remote:
        identity = engine.section_identity(c['title'])
        if identity['part']:
            scope = identity['part']
        value = {'number': identity['number'], 'scope': scope}
        sections.append({'id': str(c['start']), 'title': c['title'], **value})
        key = c['title'].strip().lower()
        identities[key] = {**value, 'scope': ''} if key in identities else value
    for m in markers:
        title = str(m.get('old_title') or '')
        identities.setdefault(title.strip().lower(), {'number': engine.chapter_number(title), 'scope': ''})
    return sections, identities


def eligibility(draft, remote):
    """Independent, broad, stable audio anchors plus a unique nearby boundary.

    No per-click inference. A selected match is additional timing evidence, never
    a new speech result or calibrated probability. Edited/short recordings and
    insufficient anchors cannot earn this additional credit.
    """
    markers = draft['markers']
    anchors = [m for m in markers if m.get('status') == 'supported' and m.get('reference_start') is not None]
    eligible = [[] for _ in markers]
    if not draft.get('complete') or draft.get('invalidated') or not re.fullmatch(r'[0-9a-f]{64}', str(draft.get('source_sha256', ''))):
        return eligible, 'A complete, fingerprint-bound recording scan is required.'
    reason = 'At least six independent audio anchors across the recording are required.'
    if len(anchors) < 6:
        return eligible, reason
    duration = draft.get('duration_seconds')
    ends = [c.get('end') for c in remote]
    if not isinstance(duration, (int, float)) or not math.isfinite(duration) or duration <= 0 or not ends or any(not isinstance(v, (int, float)) or not math.isfinite(v) for v in ends):
        return eligible, 'Recording and published duration evidence is required.'
    if abs(max(ends)-duration) > 2:
        return eligible, 'Recording and published durations differ; timing-only selections need further review.'
    offsets = [m['old_seconds']-m['reference_start'] for m in anchors]
    offset = statistics.median(offsets)
    if max(offsets)-min(offsets) > .7 or max(m['old_seconds'] for m in anchors)-min(m['old_seconds'] for m in anchors) < .5*duration:
        return eligible, 'Audio anchors do not establish stable timing across this recording.'
    for i, m in enumerate(markers):
        distances = sorted((abs(m['old_seconds']-c['start']-offset), j) for j, c in enumerate(remote))
        if not distances or distances[0][0] > 2 or (len(distances)>1 and distances[1][0]-distances[0][0]<10):
            continue
        distance, j = distances[0]
        at = remote[j]['start']+offset
        if any(k != i and abs(other['old_seconds']-at)-distance < 10 for k, other in enumerate(markers)):
            continue
        eligible[i] = [str(remote[j]['start'])]
    return eligible, 'Selected matches require unique timing within 2 seconds, stable audio anchors and consistent order.'


def title_identity(title, policy):
    known = policy.get('identities', {}).get(str(title).strip().lower())
    if known is not None:
        return known
    # Unknown custom labels are only numbered when explicitly written Chapter N.
    match = re.match(r'^chapter\s+([0-9]+)(?![\d.])\b', str(title).strip(), re.I)
    return {'number': int(match[1]) if match else None, 'scope': ''}


def assess(info, decisions=None):
    """Authoritative recomputation; no client-supplied score is trusted."""
    policy = info.get('quality_policy') or {}
    sections = info.get('published_sections') or []
    by_id = {s['id']: s for s in sections}
    ranks = {s['id']: i for i, s in enumerate(sections)}
    edits = {d['index']: d for d in decisions or []}
    rows = []
    scope = ''
    for m in info['markers']:
        d = edits.get(m['index'], {'action': 'suggested' if m.get('supported') else 'keep'})
        if d.get('action') == 'remove' or (not m.get('supported') and m['index'] not in edits):
            continue
        identity = d.get('section_id') if d.get('action') == 'published' else m.get('reference_id')
        section = by_id.get(identity, {})
        title = d.get('title', '') if d.get('action') == 'rename' else m['title'] if d.get('action') == 'keep' else section.get('title') or m.get('suggested_title') or m['title']
        parsed = title_identity(title, policy)
        scope = section.get('scope') or parsed.get('scope') or scope
        rows.append({'index': m['index'], 'id': identity, 'rank': ranks.get(identity), 'title': title,
                     'number': parsed['number'], 'scope': scope, 'override': d.get('override_order') is True})
    warnings = []
    seen_ids = {}; seen_numbers = {}; highest = None; highest_number = {}
    def warn(kind, indexes, message):
        warnings.append({'kind': kind, 'indexes': sorted(set(indexes)), 'message': message})
    for row in rows:
        i = row['index']; identity = row['id']; n = row['number']; scope = row['scope']
        if identity in seen_ids:
            warn('duplicate', [seen_ids[identity], i], 'The same published chapter is assigned more than once.')
        if identity is not None:
            seen_ids[identity] = i
        if row['rank'] is not None:
            if highest and row['rank'] < highest['rank']:
                warn('out_of_order', [highest['index'], i], f"{row['title']} appears before an earlier chapter in the published order.")
            if highest is None or row['rank'] > highest['rank']:
                highest = row
        if n is not None:
            key = (scope, n)
            if key in seen_numbers:
                warn('duplicate_number', [seen_numbers[key], i], f'Chapter {n} is repeated within the same part.')
            seen_numbers[key] = i
            prior = highest_number.get(scope)
            if prior and n < prior['number'] and not any(w['kind']=='out_of_order' and i in w['indexes'] for w in warnings):
                warn('out_of_order', [prior['index'], i], f"Chapter {n} follows Chapter {prior['number']} in this part.")
            if prior is None or n > prior['number']:
                highest_number[scope] = row
            expected = by_id.get(identity, {}).get('number')
            if expected is not None and expected != n:
                warn('title_conflict', [i], f'The chosen title says Chapter {n}, but the matched section is Chapter {expected}.')
    ranked = [r for r in rows if r['rank'] is not None]
    used = {r['id'] for r in rows}
    if ranked:
        lo = min(r['rank'] for r in ranked); hi = max(r['rank'] for r in ranked)
        for rank, section in enumerate(sections):
            if lo < rank < hi and section['id'] not in used and section.get('number') is not None:
                target = next((r for r in ranked if r['rank'] > rank), ranked[-1])
                warn('unassigned_chapter', [target['index']], f"{section['title']} has no assigned marker between matched chapters. Its audio may still be inside another chapter.")
    # Explicit custom chapter labels may have no published ID. Still flag a
    # missing intermediate number when this edition actually contains it.
    for section in sections:
        n = section.get('number'); scope = section.get('scope', '')
        numbered = [r for r in rows if r['number'] is not None and r['scope']==scope]
        if n is None or not numbered or (scope, n) in seen_numbers or section['id'] in used:
            continue
        if min(r['number'] for r in numbered) < n < max(r['number'] for r in numbered) and not any(w['kind']=='unassigned_chapter' and w['message'].startswith(section['title']+' has ') for w in warnings):
            target = next(r for r in numbered if r['number']>n)
            warn('unassigned_chapter', [target['index']], f"{section['title']} has no assigned marker between matched chapters. Its audio may still be inside another chapter.")
    invalid = {i for w in warnings if w['kind'] != 'unassigned_chapter' for i in w['indexes']}
    retained_audio = sum(m.get('supported') and edits.get(m['index'], {}).get('action') not in ('remove', 'published') for m in info['markers'])
    # A selected original audio identity is still an independent anchor.
    retained_audio += sum(m.get('supported') and edits.get(m['index'], {}).get('action')=='published' and edits[m['index']].get('section_id')==m.get('reference_id') for m in info['markers'])
    qualified = []
    for m in info['markers']:
        d = edits.get(m['index'], {})
        if (not m.get('supported') and d.get('action')=='published' and not d.get('override_order')
                and d.get('section_id') in m.get('eligible_reference_ids', []) and m['index'] not in invalid
                and retained_audio >= policy.get('minimum_audio_anchors', 6)):
            qualified.append(m['index'])
    original_audio = info.get('supported', sum(bool(m.get('supported')) for m in info['markers']))
    total = len(info['markers'])
    return {'policy_version': policy.get('version'), 'validated_count': original_audio+len(qualified), 'validated_percent': 100*(original_audio+len(qualified))/max(1,total),
            'audio_count': original_audio, 'selected_count': len(qualified), 'qualified_indexes': qualified, 'warnings': warnings}
