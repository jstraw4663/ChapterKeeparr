#!/usr/bin/env python3
"""Audiobook workflow v5.5. One file: conversion, research, local speech checks and atomic replacement. macOS/Linux. See README.md."""


# ---------- chapter_metadata.py (included; no companion Python file required) ----------
"""Conservative chapter selection and explicitly supplied timeline validation."""
import json
import math
from collections import Counter
from pathlib import Path


def select_titles(sources, source_tags, book_name):
    """Do not mistake duplicated book titles or file ordinals for book chapters."""
    def norm(value):
        return ' '.join(str(value).split()).casefold()
    titles = [t.get('title', '').strip() for t in source_tags]
    counts = Counter(norm(t) for t in titles if t)
    book_titles = {norm(book_name)} | {norm(t.get('album', '')) for t in source_tags}
    result = []
    for i, (path, title) in enumerate(zip(sources, titles), 1):
        if title and norm(title) not in book_titles and counts[norm(title)] == 1:
            result.append(title)
        else:
            result.append('Track {:02d}: {}'.format(i, Path(path).stem))
    return result


def load_plan(path, audio_duration):
    """A supplied plan is explicit user input, never automatically trusted web data."""
    value = json.loads(Path(path).read_text(encoding='utf-8'))
    expected = float(value['expected_duration_seconds'])
    if not math.isfinite(expected) or abs(expected - audio_duration) > 0.25:
        raise ValueError('Chapter plan duration does not match this audio (tolerance 0.25 s)')
    entries = value['chapters']
    if not entries:
        raise ValueError('Chapter plan is empty')
    result = []
    for entry in entries:
        start = float(entry['start_seconds'])
        title = entry['title']
        if not math.isfinite(start) or start < 0 or start >= audio_duration:
            raise ValueError('Invalid chapter start time')
        if not isinstance(title, str) or not title.strip() or '\x00' in title:
            raise ValueError('Chapter title must be nonempty text without NUL characters')
        if result and start <= result[-1][0]:
            raise ValueError('Chapter start times must be strictly increasing')
        result.append((start, title.strip()))
    if result[0][0] != 0:
        raise ValueError('First chapter must begin at zero')
    return result


def check_plan(actual, plan, duration):
    if len(actual) != len(plan):
        raise ValueError('Output chapter count does not match chapter plan')
    for i, (chapter, (start, title)) in enumerate(zip(actual, plan)):
        end = plan[i + 1][0] if i + 1 < len(plan) else duration
        if chapter.get('tags', {}).get('title') != title:
            raise ValueError('Chapter title did not survive encoding: ' + title)
        if abs(float(chapter['start_time']) - start) > 0.01 or abs(float(chapter['end_time']) - end) > 0.01:
            raise ValueError('Chapter timing did not survive encoding: ' + title)


# ---------- book_sources.py (included; no companion Python file required) ----------
"""Read-only edition lookup and optional EPUB corroboration. No audio uploads."""
import bisect
import difflib
import json
import math
from pathlib import Path, PurePosixPath
import posixpath
import re
import statistics
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile


class NeedsReview(Exception):
    pass


class MetadataServiceError(NeedsReview):
    """Transport/service failure, not evidence against a recording."""


class MetadataNotFound(NeedsReview):
    """Keep a provider 404 distinct from an empty successful search."""


def norm(value):
    return ' '.join(re.findall(r'[a-z0-9]+', str(value).casefold()))


def similar(a, b):
    return difflib.SequenceMatcher(None, norm(a), norm(b)).ratio()


def raw_get_json(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'MP3ToM4B/3.0 (chapter-repair)', 'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as response:
        raw = response.read(8 * 1024 * 1024 + 1)
    if len(raw) > 8 * 1024 * 1024:
        raise ValueError('Metadata response is unexpectedly large')
    return json.loads(raw)


def get_json(url):
    try:
        return raw_get_json(url)
    except urllib.error.HTTPError as ex:
        if ex.code == 404:
            search = urllib.parse.urlsplit(url).path.rstrip('/') == '/search'
            message = ('Metadata search returned HTTP 404. The search service did not supply results; this does not establish that the book or ASIN is missing. Retry search or enter an exact audiobook ASIN.' if search else
                       'Metadata provider has no entry for this ID/region or chapter timeline (HTTP 404). This does not prove the ASIN is invalid. Try a different region or audiobook ASIN.')
            raise MetadataNotFound(message + ' URL: ' + url) from ex
        raise MetadataServiceError('Metadata service returned HTTP {}. Retry later or choose another edition. URL: {}'.format(ex.code, url)) from ex
    except (urllib.error.URLError, TimeoutError) as ex:
        raise MetadataServiceError('Metadata service could not be reached: {}. Retry when the connection is available.'.format(ex)) from ex


def search_books(query, region='us', author=None, limit=20):
    """Two bounded query variants; only a search 404/empty result triggers fallback."""
    primary = {'title': clean_book_title(query), 'author': author} if author else {'keywords': query}
    fallback = {'keywords': clean_book_title(query)} if author else {'title': clean_book_title(query)}
    for index, params in enumerate((primary, fallback)):
        params.update(region=region, limit=limit)
        try:
            books = get_json('https://libexdb.com/search?' + urllib.parse.urlencode(params))
        except MetadataNotFound:
            if index == 0: continue
            raise
        if not isinstance(books, list) or any(not isinstance(b, dict) for b in books):
            raise NeedsReview('Unrecognized metadata search response. Please retry later.')
        if books or index == 1:
            return books[:limit]


def clean_book_title(value):
    # Only strip explicit trailing format labels; never erase subtitles or numbers.
    return re.sub(r'\s*[\(\[]\s*(?:unabridged|audiobook|unabridged audiobook)\s*[\)\]]\s*$', '', str(value or ''), flags=re.I).strip()


def similar_title(a, b):
    a, b = clean_book_title(a), clean_book_title(b)
    if re.findall(r'\b\d+\b', a) != re.findall(r'\b\d+\b', b): return 0.0
    return similar(a, b)


def asin_from_tags(tags):
    found = set()
    for key, value in tags.items():
        value = str(value).strip()
        if key.lower() in ('asin', 'audible_asin', 'audibleasin') and re.fullmatch(r'[A-Z0-9]{10}', value):
            found.add(value)
        found.update(x.upper() for x in re.findall(r'\baudible_asin\s*[:=]\s*([A-Z0-9]{10})\b', value, re.I))
        found.update(re.findall(r'audible\.[^/\s]+/(?:[^\s]*/)?(?:pd/)?([A-Z0-9]{10})(?:[/?\s]|$)', value))
    return sorted(found)


def names(entries):
    return ' '.join(e.get('name', '') if isinstance(e, dict) else str(e) for e in (entries or []))




def remote_timeline(data):
    result = []
    for item in data.get('chapters', []):
        start = float(item['startOffsetMs']) / 1000
        length = float(item['lengthMs']) / 1000
        title = item['title']
        if not (math.isfinite(start) and math.isfinite(length) and start >= 0 and length > 0):
            raise NeedsReview('Invalid published chapter timing')
        if not isinstance(title, str) or not title.strip() or '\x00' in title:
            raise NeedsReview('Invalid published chapter title')
        if result and abs(start - result[-1]['end']) > .1:
            raise NeedsReview('Published timeline contains gaps/overlaps or nested chapters')
        result.append({'start': start, 'end': start + length, 'title': title.strip()})
    if not result or result[0]['start'] != 0:
        raise NeedsReview('Published timeline must begin at zero')
    return result


def fit_timeline(existing, remote, duration, diagnostics=None):
    """Estimate one offset from many boundaries; do not guess track numbers."""
    local = sorted(set(float(c['start_time']) for c in existing if float(c['start_time']) > 0))
    reference = [c['start'] for c in remote if c['start'] > 0]
    details = diagnostics if diagnostics is not None else {}
    details.update(local_chapters=[{'start': float(c['start_time']), 'title': c.get('tags', {}).get('title', '')} for c in existing],
                   reference_chapters=remote, local_duration_seconds=duration,
                   reference_duration_seconds=remote[-1]['end'], matched_pairs=[],
                   unmatched_local=local, unmatched_reference=reference, offset_seconds=None,
                   matching_boundaries=0, usable_anchors=min(len(local),len(reference)))
    if abs(remote[-1]['end'] - duration) > 90:
        raise NeedsReview('Recording length differs too much from the published edition')
    if min(len(local), len(reference)) < 6:
        raise NeedsReview('Fewer than six usable timing anchors; automatic alignment is unsafe')
    candidates = []
    # Sparse differences within +/-90 seconds, normally roughly one per track.
    for t in local:
        lo, hi = bisect.bisect_left(reference, t - 90), bisect.bisect_right(reference, t + 90)
        candidates.extend(t - x for x in reference[lo:hi])
    if not candidates:
        raise NeedsReview('No nearby published boundaries match the file')
    candidates.sort()
    left = 0
    best = []
    for right, value in enumerate(candidates):
        while value - candidates[left] > .5:
            left += 1
        if right - left + 1 > len(best):
            best = candidates[left:right + 1]
    offset = statistics.median(best)
    matches = []
    used = set()
    for t in local:
        pos = bisect.bisect_left(reference, t - offset)
        possible = [i for i in (pos - 1, pos) if 0 <= i < len(reference) and i > max(used, default=-1)]
        if not possible:
            continue
        i = min(possible, key=lambda i: abs(t - reference[i] - offset))
        if abs(t - reference[i] - offset) <= .35:
            used.add(i)
            matches.append((reference[i], t))
    minimum = min(len(local), len(reference))
    details.update(offset_seconds=offset, matching_boundaries=len(matches), usable_anchors=minimum,
                   matched_pairs=[{'reference': a, 'local': b, 'residual': b-a-offset} for a,b in matches],
                   unmatched_local=[t for t in local if t not in {b for a,b in matches}],
                   unmatched_reference=[t for t in reference if t not in {a for a,b in matches}])
    # Plot nearest candidates as diagnostic evidence only, never as verified anchors.
    nearest = []
    for t in local:
        pos = bisect.bisect_left(reference, t)
        choices = [i for i in (pos-1, pos) if 0 <= i < len(reference)]
        if choices:
            i = min(choices, key=lambda i: abs(t-reference[i]))
            if abs(t-reference[i]) <= 90:
                nearest.append({'reference': reference[i], 'local': t,
                                'difference': t-reference[i], 'matched': (reference[i], t) in matches})
    details['nearest_candidates'] = nearest
    if len(matches) < 6 or len(matches) / minimum < .8:
        raise NeedsReview('Too few matching boundaries for reliable alignment ({} of {})'.format(len(matches), minimum))
    residuals = [b - a - offset for a, b in matches]
    if max(residuals) - min(residuals) > .5 or matches[0][1] > duration * .15 or matches[-1][1] < duration * .85:
        raise NeedsReview('Boundary matches do not consistently span the recording')
    snap = dict(matches)
    plan = []
    for c in remote:
        start = snap.get(c['start'], c['start'] + offset)
        if c['end'] + offset <= 0:
            raise NeedsReview('A published opening section appears missing; review the edit')
        start = max(0, start)
        if start >= duration or (plan and start <= plan[-1]['start_seconds']):
            raise NeedsReview('Aligned chapter timing is out of range or collapsed')
        plan.append({'start_seconds': round(start, 6), 'title': c['title']})
    plan[0]['start_seconds'] = 0
    return plan, {'offset_seconds': offset, 'matching_boundaries': len(matches),
                  'reference_boundary_count': len(reference), 'local_boundary_count': len(local),
                  'residual_range_seconds': max(residuals) - min(residuals),
                  'first_anchor_seconds': matches[0][1], 'last_anchor_seconds': matches[-1][1]}


def epub_evidence(path):
    """Parse EPUB package, nav/NCX, and short chapter openings without extraction."""
    with zipfile.ZipFile(path) as z:
        def xml(name):
            info = z.getinfo(name)
            if info.file_size > 4 * 1024 * 1024:
                raise ValueError('EPUB XML entry is too large')
            raw = z.read(name)
            if b'<!ENTITY' in raw.upper():
                raise ValueError('EPUB entity declarations are not supported')
            return ET.fromstring(raw)
        container = xml('META-INF/container.xml')
        package = next(e.attrib['full-path'] for e in container.iter() if e.tag.endswith('}rootfile'))
        tree = xml(package)
        base = posixpath.dirname(package)
        title = next((' '.join(e.itertext()).strip() for e in tree.iter() if e.tag.endswith('}title')), '')
        author = next((' '.join(e.itertext()).strip() for e in tree.iter() if e.tag.endswith('}creator')), '')
        manifest = [e for e in tree.iter() if e.tag.endswith('}item')]
        nav = next((e for e in manifest if 'nav' in e.attrib.get('properties', '').split()), None)
        if nav is not None:
            navfile = posixpath.normpath(posixpath.join(base, urllib.parse.unquote(nav.attrib['href'])))
            navroot = xml(navfile)
            toc = next((e for e in navroot.iter() if e.tag.endswith('}nav') and e.attrib.get('{http://www.idpf.org/2007/ops}type') == 'toc'), None)
            links = [(e.attrib['href'], ' '.join(e.itertext()).strip()) for e in toc.iter() if e.tag.endswith('}a') and 'href' in e.attrib] if toc is not None else []
        else:
            ncx = next(e for e in manifest if e.attrib.get('media-type') == 'application/x-dtbncx+xml')
            navfile = posixpath.normpath(posixpath.join(base, urllib.parse.unquote(ncx.attrib['href'])))
            links = []
            for e in xml(navfile).iter():
                if not e.tag.endswith('}navPoint'):
                    continue
                content = next((c for c in e if c.tag.endswith('}content')), None)
                label = next((c for c in e if c.tag.endswith('}navLabel')), None)
                if content is not None and label is not None:
                    links.append((content.attrib['src'], ' '.join(label.itertext()).strip()))
        entries = []
        for href, label in links[:2000]:
            parsed = urllib.parse.urlsplit(href)
            if parsed.scheme or parsed.netloc:
                continue
            name = posixpath.normpath(posixpath.join(posixpath.dirname(navfile), urllib.parse.unquote(parsed.path)))
            if name.startswith('../') or PurePosixPath(name).is_absolute():
                continue
            try:
                doc = xml(name)
                if parsed.fragment:
                    doc = next((e for e in doc.iter() if e.attrib.get('id') == urllib.parse.unquote(parsed.fragment)), doc)
                paragraphs = [' '.join(e.itertext()).strip() for e in doc.iter() if e.tag.endswith('}p')]
                opening = ' '.join(paragraphs).split()[:80]
            except (KeyError, ET.ParseError):
                opening = []
            entries.append({'title': label, 'opening': ' '.join(opening)})
        return {'path': str(path), 'title': title, 'author': author, 'entries': entries}


# ---------- speech_checks.py (included; no companion Python file required) ----------
"""Local-only speech spot checks. Expected chapter text is never given to Whisper."""
import difflib
import json
import math
import os
from pathlib import Path
import re
import sys


def finite_score(value, fallback):
    value = float(value)
    return value if math.isfinite(value) else fallback


def words_for(n):
    small = ['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen']
    tens = ['', '', 'twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety']
    if n < 20: return small[n]
    if n < 100: return tens[n // 10] + (' ' + small[n % 10] if n % 10 else '')
    return small[n // 100] + ' hundred' + (' ' + words_for(n % 100) if n % 100 else '')


NUMBER_WORDS = {words_for(i): i for i in range(1, 1000)}
NUMBER_PATTERN = '|'.join(re.escape(k) for k in sorted(NUMBER_WORDS, key=len, reverse=True))
LEADING = re.compile(r'^\s*(?:chapter\s+)?(\d{1,3}|' + NUMBER_PATTERN + r')(?=\s*[,.:!?;]|\s*$)', re.I)


def chapter_number(title):
    s = title.strip().casefold().replace('-', ' ')
    m = LEADING.match(s)
    if not m: return None
    return int(m[1]) if m[1].isdigit() else NUMBER_WORDS.get(m[1])


def tokens(text):
    return re.findall(r'[a-z0-9]+', text.casefold())


def compare_opening(text, opening):
    expected = tokens(opening)[:18]
    actual = tokens(text)
    if len(expected) < 8 or len(actual) < 8:
        return 0.0
    # Allow a chapter number and heading before the prose, but not arbitrary
    # overlap anywhere in the EPUB. Require a long ordered prefix match.
    size = min(len(expected), 14)
    return max((difflib.SequenceMatcher(None, expected[:size], actual[i:i + size]).ratio()
                for i in range(min(15, max(1, len(actual) - size + 1)))), default=0.0)



def spoken_heading(text):
    # Explicit chapter labels can share a segment with subsequent prose.
    text = text.strip().replace('-', ' ')
    match = re.match(r'^chapter\s+(\d{1,3}|' + NUMBER_PATTERN + r')(?![\w]|[.,:]\d)\b', text, re.I)
    if match:
        value = match[1].casefold()
        return int(value) if value.isdigit() else NUMBER_WORDS.get(value)
    # Bare numbers count only as standalone headings, never times or prose.
    match = re.fullmatch(r'(\d{1,3}|' + NUMBER_PATTERN + r')\s*[.!?:;]?', text, re.I)
    if match:
        value = match[1].casefold()
        return int(value) if value.isdigit() else NUMBER_WORDS.get(value)
    return None

def evaluate(result, expected_number, boundary, clip_start, epub_opening=''):
    matches = []
    conflicts = []
    for segment in result.get('segments', []):
        at = clip_start + float(segment.get('start', 0))
        # Segment timestamps may include the leading two seconds of silence.
        if not boundary - 2.1 <= at <= boundary + 8:
            continue
        lp, ns = float(segment.get('avg_logprob', -99)), float(segment.get('no_speech_prob', 1))
        if not (math.isfinite(lp) and math.isfinite(ns)) or lp < -1 or ns > .6:
            continue
        number = spoken_heading(segment.get('text', ''))
        if number is not None:
            item = {'number': number, 'at_seconds': round(at, 3), 'text': segment['text'].strip()}
            (matches if number == expected_number else conflicts).append(item)
    good_segments = [s for s in result.get('segments', [])
                     if math.isfinite(float(s.get('avg_logprob', -99))) and math.isfinite(float(s.get('no_speech_prob', 1)))
                     and float(s.get('avg_logprob', -99)) >= -1 and float(s.get('no_speech_prob', 1)) <= .6]
    text = ' '.join(s.get('text', '') for s in good_segments)
    overlap = compare_opening(text, epub_opening) if epub_opening else 0.0
    # A contradictory spoken chapter number always blocks automatic acceptance.
    ok = not conflicts and (bool(matches) or overlap >= .85)
    return {'passed': ok, 'spoken_matches': matches, 'conflicts': conflicts,
            'epub_opening_similarity': round(overlap, 3), 'transcript': result.get('text', ''),
            'method': 'spoken_number' if matches and not conflicts else ('epub_opening' if ok else 'unconfirmed')}


class LocalSpeech:
    def __init__(self, backend, model, cache):
        os.environ.setdefault('HF_HOME', str(Path(cache).resolve()))
        os.environ.setdefault('NUMBA_CACHE_DIR', str(Path(cache).resolve() / 'numba'))
        self.backend = backend
        self.model = model
        if backend == 'mlx':
            import mlx_whisper
            self.engine = mlx_whisper
        else:
            from faster_whisper import WhisperModel
            self.engine = WhisperModel(model, device='cpu', compute_type='int8', download_root=str(Path(cache).resolve() / 'faster-whisper'), cpu_threads=int(os.environ.get('CPU_THREADS', '4')), num_workers=1)

    def transcribe(self, wav):
        if self.backend == 'mlx':
            value = self.engine.transcribe(str(wav), path_or_hf_repo=self.model, language='en',
                                           temperature=0, condition_on_previous_text=False, verbose=None, word_timestamps=True)
            return {'text': value['text'], 'segments': [dict(start=s['start'], end=s['end'], text=s['text'],
                        words=s.get('words', []), avg_logprob=finite_score(s.get('avg_logprob', -99), -99), no_speech_prob=finite_score(s.get('no_speech_prob', 1), 1)) for s in value['segments']]}
        segments, info = self.engine.transcribe(str(wav), language='en', beam_size=5, temperature=0,
                                                condition_on_previous_text=False, vad_filter=False, word_timestamps=True)
        values = [dict(start=s.start, end=s.end, text=s.text, avg_logprob=finite_score(s.avg_logprob, -99),
                       no_speech_prob=finite_score(s.no_speech_prob, 1),
                       words=[dict(word=w.word, start=w.start, end=w.end, probability=w.probability)
                              for w in (s.words or [])]) for s in segments]
        return {'text': ' '.join(s['text'] for s in values), 'segments': values}


# ---------- Validated media conversion / retagging ----------
#!/usr/bin/env python3
"""MP3ToM4B 3.0.0 — Python 3.8+, FFmpeg/ffprobe; no pip dependencies.

One target directory is one book. See README.md for safety and disk requirements.
"""
import argparse
import contextlib
import fcntl
import json
import math
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import sys
import tempfile



class ConversionError(Exception):
    pass


def log(message, level='INFO'):
    print('[{}] {}'.format(level, message), flush=True)


def run(args, stdout=None):
    # A file-backed stderr avoids unbounded memory on a damaged long recording.
    with tempfile.TemporaryFile() as errors:
        proc = subprocess.Popen([str(x) for x in args], stdin=subprocess.DEVNULL,
                                stdout=stdout if stdout is not None else subprocess.PIPE,
                                stderr=errors)
        try:
            out, _ = proc.communicate()
        except BaseException:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
            raise
        if proc.returncode:
            errors.seek(0, 2)
            errors.seek(max(0, errors.tell() - 6000))
            raise ConversionError('{} failed: {}'.format(args[0], errors.read().decode('utf-8', 'replace')))
        return out


def probe(tool, path):
    return json.loads(run([tool, '-v', 'error', '-show_format', '-show_streams',
                           '-show_chapters', '-of', 'json', path]))


def duration(data):
    audio = next((s for s in data.get('streams', []) if s.get('codec_type') == 'audio'), {})
    value = float(audio.get('duration') or data.get('format', {}).get('duration') or 0)
    if not math.isfinite(value) or value <= 0:
        raise ConversionError('Missing or invalid audio duration')
    return value


def natural(path):
    return [(1, int(x)) if x.isdigit() else (0, x.casefold())
            for x in re.split(r'(\d+)', str(path))]


def scan(root):
    files = []
    def fail(error):
        raise error
    for base, dirs, names in os.walk(root, followlinks=False, onerror=fail):
        dirs[:] = sorted(d for d in dirs if not Path(base, d).is_symlink()
                         and not d.startswith('.mp3tom4b-'))
        for name in names:
            path = Path(base, name)
            if path.suffix.lower() == '.mp3':
                if path.is_symlink() or not path.is_file():
                    raise ConversionError('Refusing non-regular MP3: {}'.format(path))
                files.append(path)
    return sorted(files, key=lambda p: (natural(p.relative_to(root)), str(p)))


def fingerprint(path):
    s = path.lstat()
    if not stat.S_ISREG(s.st_mode):
        raise ConversionError('Source is no longer a regular file: {}'.format(path))
    return s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns


def tags(data):
    result = {}
    for stream in data.get('streams', []):
        if stream.get('codec_type') == 'audio':
            result.update({k.lower(): str(v) for k, v in stream.get('tags', {}).items()})
    result.update({k.lower(): str(v) for k, v in data.get('format', {}).get('tags', {}).items()})
    return result


def escape(value):
    return str(value).replace('\\', '\\\\').replace('=', '\\=').replace(';', '\\;').replace('#', '\\#').replace('\r', '').replace('\n', '\\\n')


def validate(data, expected, count, decoded, cover):
    audio = [s for s in data.get('streams', []) if s.get('codec_type') == 'audio']
    if len(audio) != 1 or audio[0].get('codec_name') != 'aac':
        raise ConversionError('Output must contain exactly one AAC audio stream')
    actual = duration(data)
    # MP3 headers include encoder padding; decoded PCM provides a tighter check.
    if abs(actual - expected) > max(2.0, expected * 0.01):
        raise ConversionError('Output duration differs from summed MP3 durations')
    if abs(actual - decoded) > 0.25:
        raise ConversionError('Output duration differs from decoded source audio')
    chapters = data.get('chapters', [])
    if len(chapters) != count:
        raise ConversionError('Output chapter count does not match MP3 count')
    previous = 0.0
    for chapter in chapters:
        start, end = float(chapter['start_time']), float(chapter['end_time'])
        if not all(math.isfinite(x) for x in (start, end)) or end <= start or abs(start - previous) > 0.01 or end > actual + 0.25:
            raise ConversionError('Invalid chapter boundaries')
        previous = end
    if abs(previous - decoded) > 0.01:
        raise ConversionError('Chapters do not cover the complete audiobook')
    if cover and not any(s.get('disposition', {}).get('attached_pic') for s in data.get('streams', [])):
        raise ConversionError('Output is missing its cover art')


def convert(root, keep, bitrate, ffmpeg, ffprobe, chapter_file=None, output_path=None, already_locked=False):
    # Use a persistent regular lock file for SMB compatibility.
    # macOS/Linux only; all instances of this script cooperate on this lock.
    with contextlib.ExitStack() as stack:
        fd = open_book_lock(root)
        stack.callback(os.close, fd)
        try:
            if not already_locked: fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ConversionError('Another conversion is using this folder')
        sources = scan(root)
        if len(sources) < 2:
            log('Skipped: fewer than two MP3 files.')
            return False
        output = output_path or root / (root.name + '.m4b')
        if any(p.suffix.lower() == '.m4b' for p in root.iterdir()):
            raise ConversionError('An M4B already exists in the target folder; refusing to overwrite or delete MP3s')
        snapshots = {p: fingerprint(p) for p in sources}
        records = [probe(ffprobe, p) for p in sources]
        lengths = [duration(d) for d in records]
        total = sum(lengths)
        channels = 1 if all(next(s for s in d['streams'] if s.get('codec_type') == 'audio').get('channels') == 1 for d in records) else 2
        rate = 44100
        frame_bytes = channels * 2
        required = total * rate * frame_bytes + total * int(bitrate[:-1]) * 125 * 2 + 64 * 1024**2
        if shutil.disk_usage(root).free < required:
            raise ConversionError('Insufficient free space for temporary PCM audio and M4B (about {:.2f} GB needed)'.format(required / 1e9))
        log('Converting {} MP3s in natural relative-path order ({:.1f} minutes).'.format(len(sources), total / 60))
        with tempfile.TemporaryDirectory(prefix='.mp3tom4b-', dir=str(root)) as temp:
            temp = Path(temp)
            pcm = temp / 'audio.pcm'
            boundaries = [0]
            with pcm.open('wb') as target:
                for index, (source, expected) in enumerate(zip(sources, lengths), 1):
                    log('Decoding {}/{}: {}'.format(index, len(sources), source.relative_to(root)))
                    before = target.tell()
                    run([ffmpeg, '-nostdin', '-v', 'error', '-xerror', '-i', source,
                         '-map', '0:a:0', '-vn', '-sn', '-dn', '-ac', channels, '-ar', rate,
                         '-c:a', 'pcm_s16le', '-f', 's16le', 'pipe:1'], stdout=target)
                    size = target.tell() - before
                    seconds = size / (rate * frame_bytes)
                    if size <= 0 or size % frame_bytes or abs(seconds - expected) > max(0.5, expected * 0.01):
                        raise ConversionError('Decoded duration mismatch: {}'.format(source))
                    boundaries.append(boundaries[-1] + size // frame_bytes)
            cover = None
            for source, data in zip(sources, records):
                artwork = next((s for s in data.get('streams', []) if s.get('disposition', {}).get('attached_pic')), None)
                if artwork:
                    cover = temp / 'cover.jpg'
                    run([ffmpeg, '-nostdin', '-v', 'error', '-xerror', '-i', source, '-map',
                         '0:{}'.format(artwork['index']), '-frames:v', '1', '-c:v', 'mjpeg', cover])
                    break
            if cover is None:
                for folder in dict.fromkeys([root] + [p.parent for p in sources]):
                    candidates = sorted((p for p in folder.iterdir() if p.is_file() and not p.is_symlink()
                        and p.suffix.lower() in ('.jpg', '.jpeg', '.png')
                        and p.stem.lower() in ('cover', 'folder', 'front', 'album', root.name.lower())), key=lambda p: p.name.lower())
                    if candidates:
                        cover = temp / 'cover.jpg'
                        run([ffmpeg, '-nostdin', '-v', 'error', '-xerror', '-i', candidates[0],
                             '-frames:v', '1', '-c:v', 'mjpeg', cover])
                        break
            if cover is None:
                log('No embedded artwork or common cover file found.', 'WARNING')
            merged = {}
            for data in records:
                for key, value in tags(data).items():
                    if value.strip():
                        merged.setdefault(key, value)
            metadata = {'title': merged.get('album') or root.name,
                        'album': merged.get('album') or root.name, 'media_type': '2'}
            for key in ('artist', 'album_artist', 'composer', 'genre', 'date', 'comment', 'description', 'copyright', 'synopsis'):
                if key in merged:
                    metadata[key] = merged[key]
            # MP4 lacks universal fields for these; retain readable information in comment.
            extra = ['{}: {}'.format(k, merged[k]) for k in ('author', 'narrator', 'narratedby', 'publisher', 'language', 'woas', 'audible_asin') if k in merged]
            if extra:
                metadata['comment'] = '\n'.join([metadata.get('comment', '')] + extra).strip()
            lines = [';FFMETADATA1'] + ['{}={}'.format(k, escape(v)) for k, v in metadata.items()]
            decoded_duration = boundaries[-1] / rate
            if chapter_file:
                plan = load_plan(chapter_file, decoded_duration)
            else:
                names = select_titles(sources, [tags(d) for d in records], root.name)
                plan = [(boundaries[i] / rate, name) for i, name in enumerate(names)]
            for i, (start, title) in enumerate(plan):
                end = plan[i + 1][0] if i + 1 < len(plan) else decoded_duration
                lines.extend(['[CHAPTER]', 'TIMEBASE=1/{}'.format(rate),
                              'START={}'.format(round(start * rate)),
                              'END={}'.format(round(end * rate)), 'title=' + escape(title)])
            meta = temp / 'metadata.txt'
            meta.write_text('\n'.join(lines) + '\n', encoding='utf-8')
            partial = temp / 'partial.m4b'
            args = [ffmpeg, '-nostdin', '-v', 'error', '-xerror', '-f', 's16le', '-ar', rate, '-ac', channels,
                    '-i', pcm, '-f', 'ffmetadata', '-i', meta]
            if cover:
                args += ['-i', cover]
            args += ['-map', '0:a:0', '-map_metadata', '1', '-map_chapters', '1', '-c:a', 'aac', '-b:a', bitrate]
            if cover:
                args += ['-map', '2:v:0', '-c:v', 'copy', '-disposition:v:0', 'attached_pic']
            args += ['-movflags', '+faststart', '-movie_timescale', '1000', '-f', 'mp4', partial]
            log('Encoding AAC and writing chapters…')
            run(args)
            result = probe(ffprobe, partial)
            validate(result, total, len(plan), decoded_duration, bool(cover))
            check_plan(result['chapters'], plan, decoded_duration)
            log('Checking the complete M4B audio for decoding errors…')
            run([ffmpeg, '-nostdin', '-v', 'error', '-xerror', '-i', partial, '-map', '0:a:0', '-f', 'null', '-'])
            if scan(root) != sources or any(fingerprint(p) != snapshots[p] for p in sources):
                raise ConversionError('Source MP3s changed during conversion; keeping all MP3s')
            with partial.open('rb') as handle:
                os.fsync(handle.fileno())
            # Atomic publication, refuses to replace a file created by another process.
            publish_new(partial, output)
            log('Validated M4B saved: {}'.format(output))
            # From here on the validated M4B MUST survive cleanup failures.
            if not keep:
                for source in sources:
                    if fingerprint(source) != snapshots[source]:
                        raise ConversionError('Source changed during cleanup; validated M4B and remaining MP3s retained')
                    try:
                        source.unlink()
                    except OSError as error:
                        raise ConversionError('MP3 cleanup incomplete; validated M4B and remaining MP3s retained: {}'.format(error))
                log('Deleted {} source MP3s. All other files preserved.'.format(len(sources)))
            else:
                log('Kept all source MP3s (--keep-mp3s / DeleteMP3s=no).')
        return True


def retag(source, output, chapter_file, ffmpeg, ffprobe, asin=None):
    """Write a separately validated chaptered copy; never modify the input file."""
    original_stat = fingerprint(source)
    if output.exists() or output.is_symlink():
        raise ConversionError('Output already exists; refusing to overwrite')
    original = probe(ffprobe, source)
    audio_duration = duration(original)
    plan = load_plan(chapter_file, audio_duration)
    art = [s for s in original.get('streams', []) if s.get('disposition', {}).get('attached_pic')]
    with tempfile.TemporaryDirectory(prefix='.mp3tom4b-', dir=str(output.parent)) as folder:
        folder = Path(folder)
        metadata = folder / 'chapters.txt'
        lines = [';FFMETADATA1']
        for i, (start, title) in enumerate(plan):
            end = plan[i + 1][0] if i + 1 < len(plan) else audio_duration
            lines.extend(['[CHAPTER]', 'TIMEBASE=1/44100',
                          'START={}'.format(round(start * 44100)),
                          'END={}'.format(round(end * 44100)), 'title=' + escape(title)])
        metadata.write_text('\n'.join(lines) + '\n', encoding='utf-8')
        partial = folder / 'partial.m4b'
        cmd = [ffmpeg, '-nostdin', '-v', 'error', '-xerror', '-i', source,
               '-f', 'ffmetadata', '-i', metadata, '-map', '0:a:0']
        for stream in art:
            cmd += ['-map', '0:{}'.format(stream['index'])]
        cmd += ['-map_metadata', '0', '-map_chapters', '1', '-c', 'copy',
                '-movflags', '+faststart', '-movie_timescale', '1000', '-f', 'mp4', partial]
        if asin:
            old_comment = original.get('format', {}).get('tags', {}).get('comment', '')
            old_comment = re.sub(r'(?im)^audible_asin\s*[:=].*$', '', old_comment).strip()
            comment = (old_comment + '\naudible_asin: ' + asin).strip()
            cmd[-1:-1] = ['-metadata', 'comment=' + comment]
        log('Writing chapter metadata without re-encoding audio…')
        run(cmd)
        result = probe(ffprobe, partial)
        validate(result, audio_duration, len(plan), audio_duration, bool(art))
        check_plan(result['chapters'], plan, audio_duration)
        def audio_hash(path):
            return run([ffmpeg, '-nostdin', '-v', 'error', '-i', path, '-map', '0:a:0',
                        '-c:a', 'copy', '-f', 'hash', '-hash', 'sha256', '-'])
        log('Verifying unchanged AAC audio and decoding the complete result…')
        if audio_hash(source) != audio_hash(partial):
            raise ConversionError('Audio payload changed while updating chapters')
        run([ffmpeg, '-nostdin', '-v', 'error', '-xerror', '-i', partial,
             '-map', '0:a:0', '-f', 'null', '-'])
        if fingerprint(source) != original_stat:
            raise ConversionError('Input M4B changed during chapter update')
        with partial.open('rb') as handle:
            os.fsync(handle.fileno())
        publish_new(partial, output)
    log('Saved {} verified chapter entries: {}'.format(len(plan), output))
    return True



def file_hash(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()

def write_json(path, data):
    Path(path).write_text(json.dumps(data, indent=2, ensure_ascii=False, allow_nan=False) + '\n', encoding='utf-8')

def choose_checks(plan, all_chapters=False):
    numbered = [i for i, c in enumerate(plan) if chapter_number(c['title']) is not None]
    if len(numbered) < 3:
        raise NeedsReview('Need at least three numbered chapters for this English speech-check workflow')
    if all_chapters:
        return numbered
    wanted = {numbered[round((len(numbered) - 1) * q / 4)] for q in range(5)}
    wanted.update(numbered[:2])
    # Check the numbered chapter immediately after each structural part boundary.
    for i, c in enumerate(plan):
        if re.match(r'^part\b', c['title'], re.I):
            after = next((j for j in numbered if j > i), None)
            if after is not None: wanted.add(after)
    return sorted(wanted)

# ---------- Unified interactive workflow ----------
from datetime import datetime, timezone
import hashlib
import importlib.util
import platform

REPORTS_DIR = '.audiobook-reports'

def publish_new(source, destination):
    """No-clobber publication, including filesystems without hard links."""
    import errno
    source, destination = Path(source), Path(destination)
    try:
        os.link(str(source), str(destination))
        return
    except OSError as ex:
        if ex.errno not in (errno.ENOTSUP, errno.EOPNOTSUPP, errno.EXDEV, errno.ENOSYS):
            raise
    # Exclusive creation preserves no-clobber semantics on SMB. The source stays
    # intact until the caller completes publication. Never retry FileExistsError.
    created = None
    try:
        with destination.open('xb') as output:
            st = os.fstat(output.fileno())
            created = (st.st_dev, st.st_ino)
            with source.open('rb') as original:
                shutil.copyfileobj(original, output, 1024 * 1024)
            output.flush()
            os.fsync(output.fileno())
        if file_hash(source) != file_hash(destination):
            raise ConversionError('Published copy failed SHA-256 verification')
    except BaseException:
        if created is not None:
            try:
                st = destination.lstat()
                if (st.st_dev, st.st_ino) == created:
                    destination.unlink()
            except FileNotFoundError:
                pass
        raise


def open_book_lock(root):
    # Keep this inode permanently: unlinking a lock file can let two processes
    # lock different inodes. Closing the descriptor releases the OS lock.
    import stat
    path = root / '.audiobook-workflow.lock'
    fd = os.open(str(path), os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    if not stat.S_ISREG(os.fstat(fd).st_mode):
        os.close(fd)
        raise ConversionError('Workflow lock must be a regular file: ' + str(path))
    return fd




class UserStopped(NeedsReview):
    pass


class Questions:
    def __init__(self, enabled, report):
        self.enabled = enabled
        self.report = report
        self.folder = None

    def text(self, question, default=None):
        self.report['pending_question'] = question
        if self.folder: write_report(self.folder, self.report)
        if not self.enabled:
            raise NeedsReview(question + ' Run in an interactive terminal, or supply the corresponding option.')
        try:
            answer = input('\n' + question + (' [{}]'.format(default) if default else '') + '\n> ').strip()
        except EOFError:
            raise UserStopped('Input closed while waiting for details')
        if answer.casefold() in ('q', 'quit', 'stop'):
            raise UserStopped('Stopped at your request')
        answer = answer or default
        if not answer:
            return self.text(question, default)
        self.report.setdefault('answers', []).append({'question': question, 'answer': answer})
        self.report.pop('pending_question', None)
        return answer

    def choose(self, question, items):
        self.report['choices'] = items
        if not self.enabled:
            self.report['pending_question'] = question
            raise NeedsReview(question + ' Run interactively to answer, or specify the exact file/ASIN.')
        if self.enabled:
            print('\n' + question)
            for i, item in enumerate(items, 1):
                print('  {}. {}'.format(i, item))
        while True:
            answer = self.text('Enter a choice number, or q to stop:')
            if answer.isdigit() and 1 <= int(answer) <= len(items):
                self.report.pop('choices', None)
                return int(answer) - 1
            if self.enabled:
                print('Please choose one of the listed numbers.')


def write_report(folder, report):
    # Keep one readable report updated through questions, checks and commit.
    write_json(folder / 'report.json', report)
    lines = ['# Audiobook processing report', '', '**Status: {}**'.format(report['status']), '',
             'Input: ' + report.get('input', ''), '']
    for key in ('reason', 'pending_question', 'output', 'backup', 'selection_basis'):
        if report.get(key): lines += ['{}: {}'.format(key.replace('_', ' ').capitalize(), report[key]), '']
    if report.get('gates'):
        lines += ['## Workflow gates', '']
        for item in report['gates'].values():
            lines += ['- {}: {} — {}'.format(item['label'],item['state'],item['detail'])]
        lines += ['', '## Evidence assessment', '']
        for key,item in report.get('assessment',{}).items():
            lines += ['- {}: {} — {}'.format(key,item['level'],item['detail'])]
        lines += ['', 'Evidence labels are not probabilities of complete content.', '']
    for choice in report.get('choices', []): lines += ['- ' + choice]
    if report.get('edition'):
        e = report['edition']; lines += ['', 'Edition: {} / {} / {}'.format(e['title'], e['narrators'], e['asin']), '']
    if report.get('alignment'):
        a = report['alignment']; lines += ['Matched {} boundaries; time offset {:.3f} seconds.'.format(a['matching_boundaries'], a['offset_seconds']), '']
    for attempt in report.get('edition_attempts', []):
        lines += ['', 'Edition attempt {}: {}'.format(attempt['asin'], 'PASS' if attempt['passed'] else 'REVIEW')]
        for check in attempt['checks']:
            lines += ['- {}: {} — {}'.format(check['title'], 'PASS' if check['passed'] else 'REVIEW', check['transcript'].strip())]
    for c in report.get('checks', []):
        lines += ['## {} — {}'.format(c['title'], 'PASS' if c['passed'] else 'REVIEW'), '',
                  c['transcript'].strip(), '', '[Listen to excerpt](' + c['audio_excerpt'] + ')', '']
    lines += ['MP3 files deleted: {}'.format(report.get('mp3s_deleted', 0)), '',
              'Audio checks run locally. Spot checks cannot guarantee every chapter. English/AAC and consistent existing timing anchors are currently required. No unrelated non-MP3 files are edited.', '']
    (folder / 'report.md').write_text('\n'.join(lines), encoding='utf-8')


def media_files(root, suffix):
    result = []
    def fail(error): raise error
    for base, dirs, files in os.walk(root, followlinks=False, onerror=fail):
        dirs[:] = [d for d in dirs if d != REPORTS_DIR and not d.startswith('.mp3tom4b-') and not Path(base, d).is_symlink()]
        for name in files:
            path = Path(base, name)
            if path.suffix.casefold() == suffix:
                if path.is_symlink() or not path.is_file():
                    raise NeedsReview('Refusing linked/non-regular media: ' + str(path))
                result.append(path)
    return sorted(result, key=lambda p: (natural(p.relative_to(root)), str(p)))


def summaries(book):
    from .covers import cover_url
    return {'asin': book.get('asin'), 'cover_url': cover_url(book), 'title': book.get('title', ''),
            'authors': names(book.get('authors')), 'narrators': names(book.get('narrators')),
            'publisher': book.get('publisherName') or book.get('publisher', ''),
            'runtime_seconds': float(book.get('runtimeLengthMin') or book.get('lengthMinutes') or 0) * 60}


def eligible_book(book, title, author, narrator, seconds):
    e = summaries(book)
    return ((not title or similar_title(title, e['title']) >= .88) and
            (not author or similar(author, e['authors']) >= .78) and
            (not narrator or similar(narrator, e['narrators']) >= .78) and
            e['runtime_seconds'] > 0 and abs(e['runtime_seconds'] - seconds) <= max(120, seconds * .01) and
            norm(book.get('language', '')) in ('english', 'en') and
            norm(book.get('formatType') or book.get('bookFormat') or '') == 'unabridged')


def research_edition(title, author, narrator, seconds, region, asin, data, questions, report, folder,
                     cache_dir=None, force=False):
    from .recovery import evaluate, digest, ALGORITHM_VERSION
    region = region.lower()
    attempted = report.setdefault('attempted_editions', [])
    report['algorithm_version'] = ALGORITHM_VERSION
    if len(attempted) >= 10:
        raise NeedsReview('Ten editions have been checked without confirmation. Review the diagnostics or correct book details.')
    if asin:
        asin = asin.upper().strip()
        if not re.fullmatch(r'[A-Z0-9]{10}', asin): raise NeedsReview('Invalid Audible audiobook ID: ' + asin)
        if asin + ':' + region in attempted:
            raise NeedsReview('This edition has already been checked in this attempt.')
        try:
            book = get_json('https://api.audnex.us/books/' + asin + '?region=' + region)
            if not isinstance(book, dict) or book.get('asin') != asin:
                raise NeedsReview('Provider returned metadata for a different or missing ASIN.')
            books = [book]
        except (NeedsReview, ValueError) as exc:
            attempted.append(asin + ':' + region)
            report.setdefault('alignment_attempts', []).append(dict(asin=asin, region=region,
                identity_compatible=None, timing_passed=False, diagnostics={}, reason=str(exc)))
            write_report(folder, report)
            raise
    else:
        books = search_books(title, region, author=author, limit=10)
    unique = {}
    for book in books:
        if not isinstance(book, dict): continue
        identifier = str(book.get('asin', '')).upper()
        if re.fullmatch(r'[A-Z0-9]{10}', identifier) and identifier + ':' + region not in attempted:
            unique.setdefault(identifier, dict(book, asin=identifier))
    books = list(unique.values())[:10-len(attempted)]
    report['candidates'] = [summaries(b) for b in books]
    for book in books:
        e = summaries(book)
        identifier = e['asin']
        attempted.append(identifier + ':' + region)
        report.setdefault('attempted_asins', []).append(identifier)
        record = dict(asin=identifier, region=region, edition=e, identity_compatible=False,
                      timing_passed=False, reason='Checking metadata', diagnostics={})
        report.setdefault('alignment_attempts', []).append(record)
        try:
            if not eligible_book(book, title, author, narrator, seconds):
                raise NeedsReview('Metadata does not match title, author, narrator, language, unabridged format or runtime. This is not a compatible-recording count.')
            record['identity_compatible'] = True
            log('Checking edition {} ({})…'.format(identifier, e['publisher']))
            published = get_json('https://api.audnex.us/books/' + identifier + '/chapters?region=' + region)
            if published.get('asin') != identifier or published.get('isAccurate') is not True:
                raise NeedsReview('Provider has not verified this timeline')
            remote = remote_timeline(published)
            timeline_hash = digest(remote)
            duplicate = next((a for a in report['alignment_attempts'][:-1] if a.get('timeline_hash') == timeline_hash), None)
            outcome = evaluate(data.get('chapters', []), remote, seconds,
                               report.get('audio_source_sha256'), [title, author, narrator], cache_dir, force)
            record.update(outcome)
            if duplicate:
                record['duplicate_of'] = duplicate['asin'] + ':' + duplicate['region']
                raise NeedsReview('Identical chapter timeline already evaluated for ' + record['duplicate_of'])
            if not outcome['timing_passed']:
                raise NeedsReview(outcome['reason'])
            report['selection_basis'] = 'Metadata and timing compatible; speech verification is still required'
            report['viable_asins'] = [identifier]
            return e, published, outcome['plan'], outcome['alignment']
        except MetadataServiceError as ex:
            record['reason'] = str(ex)
            record['service_error'] = True
            raise
        except (NeedsReview, ValueError, KeyError, TypeError) as ex:
            record['reason'] = str(ex)
            report.setdefault('rejected_editions', []).append({'asin': identifier, 'region': region, 'reason': str(ex)})
        finally:
            write_report(folder, report)
    raise NeedsReview('No remaining edition passed metadata and timing checks. Inspect alignment diagnostics: a matching recording may still need audio reconstruction; selecting the same ASIN again will not fix poor markers.')


def inspect_identity(source, root, args, questions, report):
    data = probe(args.ffprobe, source)
    report['source_duration_seconds'] = duration(data)
    t = tags(data)
    embedded_ids = sorted(set(asin_from_tags(t)))
    report['embedded_tags'] = {'title': t.get('album') or t.get('title'),
                               'author': t.get('artist') or t.get('author'),
                               'narrator': t.get('narratedby') or t.get('narrator') or t.get('composer'),
                               'asin': embedded_ids[0] if len(embedded_ids) == 1 else None}
    title = args.title or t.get('album') or t.get('title')
    author = args.author or t.get('artist') or t.get('author')
    narrator = args.narrator or t.get('narratedby') or t.get('narrator') or t.get('composer')
    evidence = None
    if not args.no_epub:
        files = [args.epub.expanduser()] if args.epub else media_files(root, '.epub')
        matches = []
        for path in files:
            try:
                e = epub_evidence(path)
                if (not title or similar_title(title, e['title']) >= .88) and (not author or similar(author, e['author']) >= .78): matches.append(e)
            except Exception as ex:
                report.setdefault('notes', []).append('Ignored EPUB {}: {}'.format(path.name, ex))
        if len(matches) == 1:
            evidence = matches[0]
            title, author = title or evidence['title'], author or evidence['author']
        elif args.epub:
            raise NeedsReview('The supplied EPUB does not match this book')
    found = asin_from_tags(t)
    if not found and not args.asin:
        # Inspect each matching source, not an arbitrary first file in Downloads.
        for path in media_files(root, '.mp3')[:200]:
            mt = tags(probe(args.ffprobe, path))
            if similar(title or '', mt.get('album') or mt.get('title', '')) >= .9 and similar(author or '', mt.get('artist', '')) >= .8:
                found.extend(asin_from_tags(mt))
        found = sorted(set(found))
    identifier = args.asin
    if not identifier and len(found) == 1: identifier = found[0]
    elif not identifier and len(found) > 1:
        identifier = found[questions.choose('Source files contain multiple Audible IDs. Select the correct recording.', found)]
    if not title and not identifier: title = questions.text('What is the book title?')
    if not author and not identifier: author = questions.text('Who is the author?')
    report['identity'] = {'title': title, 'author': author, 'narrator': narrator, 'asin': identifier}
    return data, title, author, narrator, identifier, evidence


def speech_review(source, plan, evidence, args, report, folder, engine, attempt):
    artifact_dir = folder / ('attempt-{:02d}'.format(attempt))
    artifact_dir.mkdir()
    report['checks'] = []
    openings = {}
    if evidence:
        numbers = {chapter_number(c['title']) for c in plan} - {None}
        epub_numbers = {chapter_number(e['title']) for e in evidence['entries']} - {None}
        if numbers == epub_numbers:
            for e in evidence['entries']:
                n = chapter_number(e['title'])
                if n is not None: openings.setdefault(n, e['opening'])
    indices = choose_checks(plan, args.verify_all)
    seconds = duration(probe(args.ffprobe, source))
    for ordinal, i in enumerate(indices, 1):
        chapter = plan[i]; boundary = chapter['start_seconds']; clip_start = max(0, boundary - 2)
        wav = artifact_dir / ('check-{:03d}.wav'.format(ordinal))
        log('Listening locally {}/{}: {}'.format(ordinal, len(indices), chapter['title']))
        run([args.ffmpeg, '-nostdin', '-v', 'error', '-ss', clip_start, '-i', source,
             '-t', min(24, seconds-clip_start), '-map', '0:a:0', '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav])
        transcript = engine.transcribe(wav)
        write_json(wav.with_suffix('.json'), transcript)
        checked = evaluate(transcript, chapter_number(chapter['title']), boundary, clip_start,
                           openings.get(chapter_number(chapter['title']), ''))
        checked.update(title=chapter['title'], boundary_seconds=boundary, audio_excerpt=str(wav.relative_to(folder)))
        report['checks'].append(checked)
        write_report(folder, report)
    return all(c['passed'] for c in report['checks'])


def commit_result(staged, destination, original_snapshot, original_hash, backup_dir, receipt=None):
    """Publish only a validated file; keep original until the atomic rename."""
    if original_snapshot is not None:
        if fingerprint(destination)[:4] != original_snapshot[:4] or file_hash(destination) != original_hash:
            raise NeedsReview('Existing M4B changed while processing; no replacement performed')
        backup = backup_dir / 'original.m4b'
        shutil.copy2(destination, backup)
        with backup.open('rb') as f: os.fsync(f.fileno())
        if file_hash(backup) != original_hash:
            raise ConversionError('Backup verification failed; original M4B kept')
        if fingerprint(destination)[:4] != original_snapshot[:4]:
            raise NeedsReview('Existing M4B changed while creating backup; no replacement performed')
        os.chmod(staged, destination.stat().st_mode & 0o777)
        os.replace(staged, destination)
    else:
        # No-clobber publication prevents a concurrently created book being lost.
        publish_new(staged, destination)
        backup = None
    if receipt is not None:
        receipt.update(committed=True, backup=str(backup) if backup else None)
    fd = os.open(str(destination.parent), os.O_RDONLY)
    try: os.fsync(fd)
    finally: os.close(fd)
    return backup


def workflow(args, interactive=True):
    from . import flow, inspection, recovery
    report = {'status': 'starting', 'input': str(args.target), 'checks': [], 'answers': [], 'mp3s_deleted': 0}
    flow.initialize(report)
    report['verification_scope'] = 'all_numbered' if args.verify_all else 'sampled'
    questions = Questions(interactive, report)
    if args.target is None:
        args.target = Path(questions.text('Enter one audiobook folder or an M4B file (q to stop):').strip('"\''))
    target = args.target.expanduser()
    if target.is_symlink(): raise NeedsReview('Please supply the actual folder/file rather than a symbolic link')
    target = target.resolve(strict=True)
    root = target if target.is_dir() else target.parent
    if root == Path(root.anchor): raise NeedsReview('Choose one audiobook folder, not a filesystem root')
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    if (root / REPORTS_DIR).is_symlink():
        raise NeedsReview('Report directory must not be a symbolic link')
    folder = root / REPORTS_DIR / stamp
    folder.mkdir(parents=True)
    report['input'] = str(target)
    args._report_path = folder / "report.json"
    questions.folder = folder
    write_report(folder, report)
    fd = open_book_lock(root)
    committed = False
    receipt = {}
    try:
        try: fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: raise NeedsReview('Another workflow is using this folder')
        flow.gate(report,'inspect','working','Checking source files, ordering and inventory')
        write_report(folder,report)
        for tool in (args.ffmpeg, args.ffprobe):
            if not shutil.which(tool): raise ConversionError('Missing executable: ' + tool)
        if target.is_file():
            if target.suffix.casefold() != '.m4b': raise NeedsReview('Supply an M4B file or a folder containing MP3s')
            existing = target
        else:
            m4bs = media_files(root, '.m4b')
            if len(m4bs) > 1:
                report['pending_question'] = 'Multiple M4Bs found; select one to update.'
                report['choices'] = [str(p.relative_to(root)) for p in m4bs]
                write_report(folder, report)
                existing = m4bs[questions.choose(report['pending_question'], report['choices'])]
            else: existing = m4bs[0] if m4bs else None
        original_snapshot = fingerprint(existing) if existing else None
        original_hash = file_hash(existing) if existing else None
        mp3s = media_files(root, '.mp3') if not existing else []
        snapshots = {p: fingerprint(p) for p in mp3s}
        if not existing and len(mp3s) < 2:
            report.update(status='skipped', reason='No M4B and fewer than two MP3 files.')
            write_report(folder, report); log(report['reason']); return 0
        inventory = inspection.manifest([existing] if existing else mp3s, root, args.ffprobe, getattr(args,'check_cancel',lambda:None))
        report['source_manifest'] = inventory
        warnings = inspection.sequence_warnings(inventory)
        if warnings:
            report['coverage_warnings'] = warnings
            flow.assess(report,'coverage','suspected_gap','; '.join(warnings))
            flow.require_review(report,'source_inventory','Possible missing or misordered tracks: '+ '; '.join(warnings),'inspect')
            raise NeedsReview(report['review_reason']['detail'])
        dependency = 'mlx_whisper' if args.backend == 'mlx' else 'faster_whisper'
        if importlib.util.find_spec(dependency) is None:
            raise ConversionError('Activate your speech virtual environment and install ' + ('requirements-mac.txt' if args.backend == 'mlx' else 'requirements-cpu.txt'))
        destination = existing or root / (root.name + '.m4b')
        report['output'] = str(destination)
        report['mode'] = 'repair_existing' if existing else 'convert_then_repair'
        report['source_sha256'] = original_hash
        with tempfile.TemporaryDirectory(prefix='.mp3tom4b-workflow-', dir=str(root)) as tmp:
            tmp = Path(tmp)
            if existing:
                source = existing
            else:
                source = tmp / 'converted.m4b'
                report['status'] = 'converting'; write_report(folder, report)
                if not inspection.prepared_conversion(root, source, inventory, args, getattr(args,'prepared_cache',None), convert):
                    raise ConversionError('No convertible MP3s')
            flow.gate(report,'inspect','passed','Source inventory captured; audio ready for matching')
            flow.gate(report,'match','working','Reading recording identity and catalog candidates')
            write_report(folder,report)
            source_hash = file_hash(source)
            report['audio_source_sha256'] = source_hash
            data, title, author, narrator, asin, evidence = inspect_identity(source, root, args, questions, report)
            seconds = duration(data)
            audio = [s for s in data.get('streams', []) if s.get('codec_type') == 'audio']
            if len(audio) != 1 or audio[0].get('codec_name') != 'aac': raise NeedsReview('Expected exactly one AAC audio stream')
            if evidence: report['epub'] = {'title': evidence['title'], 'path': evidence['path']}
            model = args.model or ('mlx-community/whisper-small.en-mlx' if args.backend == 'mlx' else 'small.en')
            engine = None
            attempt = 0
            searched_alternatives = False
            report['attempted_asins'] = []
            report['edition_attempts'] = []
            while True:
                attempt += 1
                try:
                    report['status'] = 'researching'
                    flow.gate(report,'match','working','Checking compatible recording editions')
                    write_report(folder, report)
                    selected, published, plan, alignment = research_edition(title, author, narrator, seconds, args.region, asin, data, questions, report, folder, cache_dir=getattr(args, 'recovery_cache', None), force=args.force or getattr(args, 'recovery_force', False))
                    report.update(edition=selected, alignment=alignment)
                    report['selected_recording'] = {'asin': selected['asin'], 'region': args.region}
                    flow.gate(report,'match','passed','Recording metadata passed compatibility checks')
                    flow.assess(report,'recording','compatible','Available title/author/narrator, language, format and runtime checks passed')
                    flow.gate(report,'align','working','Checking the proposed timeline and content coverage')
                    diagnostic = next((a['diagnostics'] for a in report.get('alignment_attempts',[]) if a.get('asin') == selected['asin'] and a.get('timing_passed')), {})
                    coverage = flow.check_coverage(report,diagnostic)
                    if coverage:
                        flow.require_review(report,'chapters','Possible missing content or an edited recording: '+ '; '.join(coverage),'align')
                        raise NeedsReview(report['review_reason']['detail'])
                    flow.gate(report,'align','passed','Timeline passed offset, coverage and ordering checks')
                    flow.assess(report,'alignment','compatible','Published timeline and local markers pass the timing rules')
                    flow.gate(report,'verify','working','Checking local speech against proposed chapters')
                    write_json(folder / 'published-chapters.json', published)
                    plan_data = {'expected_duration_seconds': seconds, 'source_sha256': source_hash,
                                 'asin': selected['asin'], 'chapters': plan}
                    write_json(folder / 'proposed.chapters.json', plan_data)
                    report['status'] = 'checking_speech'; write_report(folder, report)
                    if engine is None:
                        log('Loading the local speech model…')
                        engine = LocalSpeech(args.backend, model, args.model_cache.expanduser())
                    passed = speech_review(source, plan, evidence, args, report, folder, engine, attempt)
                    report['edition_attempts'].append({'asin': selected['asin'], 'alignment': alignment, 'passed': passed, 'checks': list(report['checks'])})
                    (folder / ('attempt-{:02d}'.format(attempt))).mkdir(exist_ok=True)
                    write_json(folder / ('attempt-{:02d}'.format(attempt)) / 'edition.json', {'edition': selected, 'plan': plan_data, 'passed': passed})
                    if not passed:
                        asin = None
                        searched_alternatives = True
                        log('Speech checks did not confirm this edition; searching other ASINs…', 'WARNING')
                        continue
                    break
                except UserStopped: raise
                except NeedsReview as ex:
                    if isinstance(ex,MetadataServiceError):
                        flow.require_review(report,'service',str(ex))
                        raise
                    if report.get('review_reason',{}).get('category') == 'chapters' and report.get('coverage_warnings'):
                        raise
                    if asin and not searched_alternatives:
                        report.setdefault('lookup_failures', []).append({'asin': asin, 'reason': str(ex)})
                        asin = None
                        searched_alternatives = True
                        log('Current ID could not be confirmed; searching alternate editions…', 'WARNING')
                        continue
                    if recovery.automatic_review(source,data,evidence,args,report,folder):
                        return 2
                    if not report.get('review_reason'):
                        flow.require_review(report,'chapters' if report.get('edition_attempts') or report.get('active_gate')!='match' else 'identity',str(ex))
                    report.update(status='needs_details', reason=str(ex)); write_report(folder, report)
                    if not interactive: raise
                    print('\n' + str(ex) + '\nReport: ' + str(folder / 'report.md'))
                    action = questions.choose('How would you like to proceed?', ['Enter a different Audible audiobook ID', 'Correct title/author/narrator and search again', 'Stop and keep the original files'])
                    if action == 2: raise UserStopped('Stopped with original files preserved')
                    if action == 0: asin = questions.text('Enter the exact audiobook ASIN:').upper()
                    else:
                        title = questions.text('Book title:', title)
                        author = questions.text('Author:', author)
                        narrator = questions.text('Narrator (enter unknown if unavailable):', narrator)
                        if narrator.casefold() == 'unknown': narrator = None
                        asin = None
                    report['attempted_asins'] = []
                    report['attempted_editions'] = []
                    report['alignment_attempts'] = []
                    searched_alternatives = False
                    report.pop('reason', None)
            report.pop('reason', None)
            report.pop('review_reason',None)
            flow.assess(report,'speech',report['verification_scope'],f"{len(report['checks'])} required speech checks passed; named/credit sections are not all independently checked")
            plan_data['verification'] = {'checks_passed': len(report['checks']), 'verify_all': args.verify_all}
            write_json(folder / 'verified.chapters.json', plan_data)
            if file_hash(source) != source_hash: raise NeedsReview('Audio changed during analysis')
            staged = tmp / 'validated.m4b'
            report['status'] = 'validating_output'; write_report(folder, report)
            retag(source, staged, folder / 'verified.chapters.json', args.ffmpeg, args.ffprobe, asin=selected['asin'])
            if mp3s and (media_files(root, '.mp3') != mp3s or any(fingerprint(p) != snapshots[p] for p in mp3s)):
                raise NeedsReview('MP3 sources changed during analysis; all MP3s retained')
            if not inspection.unchanged(inventory,root,getattr(args,'check_cancel',lambda:None)):
                flow.require_review(report,'source_changed','Source inventory changed before publication','verify')
                raise NeedsReview('Source inventory changed before publication; originals retained')
            flow.assess(report,'integrity','passed','Output decoded and audio payload/chapter metadata validated')
            flow.gate(report,'verify','passed','Required speech and output integrity checks passed')
            flow.assert_publishable(report)
            flow.gate(report,'save','working','Creating backup and committing validated output')
            report['status'] = 'committing'; write_report(folder, report)
            backup = commit_result(staged, destination, original_snapshot, original_hash, folder, receipt)
            committed = True
            if backup: report['backup'] = str(backup)
            report['status'] = 'saved'; write_report(folder, report)
            if mp3s and not args.keep_mp3s:
                for path in mp3s:
                    if fingerprint(path) != snapshots[path]: raise ConversionError('MP3 changed during cleanup; remaining MP3s retained')
                    path.unlink()
                    report['mp3s_deleted'] += 1
            flow.gate(report,'save','passed','Validated output committed; required source cleanup completed')
            report['status'] = 'complete'; report['output_sha256'] = file_hash(destination)
            write_report(folder, report)
        log('Complete: ' + str(destination)); log('Report: ' + str(folder / 'report.md'))
        return 0
    except (Exception, KeyboardInterrupt) as ex:
        committed = committed or receipt.get('committed', False)
        if receipt.get('backup'): report['backup'] = receipt['backup']
        report['status'] = 'cleanup_incomplete' if committed else ('needs_review' if isinstance(ex, NeedsReview) else 'error')
        report['reason'] = str(ex) or 'Interrupted; original files retained'
        if not report.get('review_reason'):
            category = 'operational' if not isinstance(ex,NeedsReview) else 'chapters' if report.get('active_gate') in ('align','verify') else 'identity'
            flow.require_review(report,category,report['reason'])
        write_report(folder, report)
        log(report['reason'], 'WARNING' if isinstance(ex, NeedsReview) else 'ERROR')
        log('Report: ' + str(folder / 'report.md'))
        if isinstance(ex, KeyboardInterrupt): raise
        return 2 if isinstance(ex, NeedsReview) and not committed else 1
    finally:
        os.close(fd)


# ---------- Library discovery and verified completion receipts ----------
import copy


def discover_jobs(target):
    """Never combine separate book directories. Only numbered disc folders group."""
    if target.is_file():
        if target.suffix.lower() != '.m4b': raise NeedsReview('Supply an M4B file or library folder')
        return [target], []
    m4bs = media_files(target, '.m4b')
    mp3s = media_files(target, '.mp3')
    groups = {}
    for path in mp3s:
        parent = path.parent
        if re.fullmatch(r'(?:cd|disc|disk)[ _.-]*\d+', parent.name, re.I) and parent != target:
            parent = parent.parent
        groups.setdefault(parent, []).append(path)
    jobs = list(m4bs)
    issues = []
    for root, sources in groups.items():
        # Existing audiobook takes priority over retained source tracks.
        if any(p.parent == root for p in m4bs): continue
        actual = set(media_files(root, '.mp3'))
        if actual != set(sources) or any(root in p.parents for p in m4bs):
            issues.append({'input': str(root), 'status': 'needs_review', 'reason': 'Mixed nested audiobook layout; select an individual book folder after separating its audio.'})
        elif len(sources) < 2:
            issues.append({'input': str(root), 'status': 'needs_review', 'reason': 'Only one MP3; at least two are required.'})
        else: jobs.append(root)
    return sorted(jobs, key=lambda p: str(p).casefold()), issues


def completed_receipt(source, verify_all=False):
    """Stop at the newest successful receipt matching the full file hash."""
    reports = source.parent / REPORTS_DIR
    if reports.is_symlink(): raise NeedsReview('Report directory must not be a symbolic link')
    # Explicit directory access: some glob implementations silently suppress
    # filesystem errors, which must not be mistaken for absent history.
    try:
        entries = list(reports.iterdir())
    except FileNotFoundError:
        source.stat()  # Confirm the media itself is still reachable.
        return None
    digest = None
    for directory in sorted(entries, reverse=True):
        if directory.name.startswith('batch-'): continue
        path = directory / 'report.json'
        try:
            if directory.is_symlink() or not directory.is_dir() or path.is_symlink(): continue
            data = json.loads(path.read_text(encoding='utf-8'))
            expected = data.get('output_sha256', '')
            if data.get('status') != 'complete' or not re.fullmatch('[0-9a-f]{64}', expected): continue
            if verify_all:
                plan = json.loads((directory / 'verified.chapters.json').read_text(encoding='utf-8'))
                if not plan.get('verification', {}).get('verify_all'): continue
        except FileNotFoundError:
            source.stat()
            continue
        except (ValueError, TypeError, AttributeError):
            continue
        # Other I/O failures propagate: never reprocess because SMB history
        # became unreadable. No state is inferred from a failed read.
        if digest is None:
            log('Checking completion fingerprint (reading the M4B once)…')
            before = fingerprint(source)
            digest = file_hash(source)
            if fingerprint(source) != before:
                raise NeedsReview('File changed while checking completion receipt')
        if expected == digest:
            return path
    return None


def library_workflow(args, interactive=True):
    if args.target is None:
        args.target = Path(Questions(interactive, {}).text('Enter a library, author, book folder, or M4B file:').strip('"\''))
    if args.target.expanduser().is_symlink(): raise NeedsReview('Supply the actual path, not a symbolic link')
    target = args.target.expanduser().resolve(strict=True)
    if target == Path(target.anchor): raise NeedsReview('Choose a library folder, not the filesystem root')
    jobs, issues = discover_jobs(target)
    if len(jobs) > 1 and any(getattr(args, field, None) for field in ('asin', 'title', 'author', 'narrator', 'epub')):
        raise NeedsReview('Book-specific metadata options require a single book input; they cannot be applied across a library')
    log('Found {} audiobook job(s), {} layout issue(s).'.format(len(jobs), len(issues)))
    if getattr(args, 'dry_run', False):
        for job in jobs: print(('REVIEW M4B: ' if job.is_file() else 'CONVERT MP3s: ') + str(job))
        for issue in issues: print('NEEDS REVIEW: ' + issue['input'] + ': ' + issue['reason'])
        print('Preview only; processing checks completion hashes before each job.')
        return 2 if issues else 0
    root = target if target.is_dir() else target.parent
    if (root / REPORTS_DIR).is_symlink(): raise NeedsReview('Report directory must not be a symbolic link')
    folder = root / REPORTS_DIR / ('batch-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    local_folder = Path.home() / '.cache' / 'mp3tom4b' / 'batch-reports' / folder.name
    local_folder.mkdir(parents=True, exist_ok=True)
    results = list(issues)
    def save():
        payload = {'input': str(target), 'jobs': results}
        lines = ['# Library processing report', '', 'Input: ' + str(target), '']
        for entry in results:
            lines += ['- **' + entry['status'] + '**: ' + entry['input'] + ' — ' + entry.get('reason', '')]
        # Record locally first so losing the share cannot destroy diagnostics.
        local_json = local_folder / 'batch.json'
        temp = local_folder / 'batch.json.tmp'
        write_json(temp, payload)
        os.replace(temp, local_json)
        (local_folder / 'batch.md').write_text('\n'.join(lines), encoding='utf-8')
        try:
            root.stat()  # Do not recreate missing mount paths.
            folder.mkdir(parents=True, exist_ok=True)
            write_json(folder / 'batch.json', payload)
            (folder / 'batch.md').write_text('\n'.join(lines), encoding='utf-8')
        except OSError as ex:
            raise NeedsReview('Library storage is unavailable or not writable; batch stopped. Reconnect/check the share and rerun the same command. Local report: {}. Storage error: {}'.format(local_folder / 'batch.md', ex)) from ex
    save()
    for index, job in enumerate(jobs, 1):
        log('[{}/{}] {}'.format(index, len(jobs), job))
        entry = {'input': str(job), 'status': 'running'}
        results.append(entry); save()
        try:
            receipt = None
            if job.is_file() and not getattr(args, 'force', False):
                receipt = completed_receipt(job, args.verify_all)
            if receipt:
                entry.update(status='skipped', reason='Unchanged verified M4B', report=str(receipt))
                log('Skipping unchanged verified file: ' + str(job))
            else:
                child = copy.copy(args); child.target = job
                child._report_path = None
                code = workflow(child, interactive)
                entry.update(status={0:'complete', 2:'needs_review'}.get(code, 'error'))
                if child._report_path:
                    entry['report'] = str(child._report_path)
                    detail = json.loads(child._report_path.read_text(encoding='utf-8'))
                    entry['status'] = detail['status']
                    entry['reason'] = detail.get('reason', '')
        except KeyboardInterrupt:
            entry.update(status='interrupted', reason='Batch stopped by user'); save(); raise
        except Exception as ex:
            entry.update(status='needs_review' if isinstance(ex, NeedsReview) else 'error', reason=str(ex))
            log(str(ex), 'WARNING')
            if isinstance(ex, OSError):
                save()
                raise NeedsReview('File/history access failed; batch stopped without reprocessing this book. Check the share and rerun. Local report: ' + str(local_folder / 'batch.md')) from ex
        save()
    log('Library report: ' + str(folder / 'batch.md'))
    if any(e['status'] in ('error', 'cleanup_incomplete') for e in results): return 1
    return 2 if any(e['status'] == 'needs_review' for e in results) else 0


def main(argv=None):
    parser = argparse.ArgumentParser(description='Process a book or library: convert MP3s, review M4B chapters, and skip unchanged verified books.')
    parser.add_argument('path', nargs='?', type=Path, help='Library, author, book folder, or M4B; omit to be asked')
    parser.add_argument('--local', type=Path, help='Alias for the input folder (now runs the FULL workflow)')
    parser.add_argument('--repair', type=Path, help='Alias for an existing M4B (now updates in place)')
    parser.add_argument('--force', action='store_true', help='Reprocess even when a successful report matches the file hash')
    parser.add_argument('--dry-run', action='store_true', help='List discovered jobs without modifying files or using online services')
    parser.add_argument('--asin')
    parser.add_argument('--title')
    parser.add_argument('--author')
    parser.add_argument('--narrator')
    parser.add_argument('--region', choices=['us','uk','ca','au','de','es','fr','in','it','jp'], default='us')
    parser.add_argument('--epub', type=Path)
    parser.add_argument('--no-epub', action='store_true')
    parser.add_argument('--keep-mp3s', action='store_true', help='Keep converted source MP3s after full success')
    parser.add_argument('--verify-all', action='store_true')
    parser.add_argument('--non-interactive', action='store_true', help='Report missing details and exit 2 instead of asking')
    parser.add_argument('--backend', choices=['mlx','faster-whisper'], default='mlx' if platform.system() == 'Darwin' and platform.machine() == 'arm64' else 'faster-whisper')
    parser.add_argument('--model')
    parser.add_argument('--model-cache', type=Path, default=Path.home()/'.cache'/'mp3tom4b-models')
    parser.add_argument('--bitrate', default='112k')
    parser.add_argument('--ffmpeg', default='ffmpeg')
    parser.add_argument('--ffprobe', default='ffprobe')
    args = parser.parse_args(argv)
    values = [p for p in (args.path, args.local, args.repair) if p is not None]
    if len(values) > 1: parser.error('Supply only one input path')
    if args.epub and args.no_epub: parser.error('--epub and --no-epub cannot be combined')
    if not re.fullmatch(r'\d+k', args.bitrate) or not 32 <= int(args.bitrate[:-1]) <= 320: parser.error('Bitrate must be 32k–320k')
    args.target = values[0] if values else None
    nzb = args.target is None and 'NZBPP_DIRECTORY' in os.environ
    if nzb:
        category = os.environ.get('NZBPO_CATEGORY', 'Books')
        if (category and os.environ.get('NZBPP_CATEGORY') != category) or os.environ.get('NZBPP_TOTALSTATUS') != 'SUCCESS': return 95
        args.target = Path(os.environ.get('NZBPP_FINALDIR') or os.environ['NZBPP_DIRECTORY'])
        args.keep_mp3s = args.keep_mp3s or os.environ.get('NZBPO_DELETEMP3S', 'yes').lower() == 'no'
        args.ffmpeg = os.environ.get('NZBPO_FFMPEG', args.ffmpeg)
        args.ffprobe = os.environ.get('NZBPO_FFPROBE', args.ffprobe)
        args.bitrate = os.environ.get('NZBPO_BITRATE', args.bitrate)
        args.backend = os.environ.get('NZBPO_BACKEND', args.backend)
        args.model_cache = Path(os.environ.get('NZBPO_MODELCACHE', str(args.model_cache)))
        if args.backend not in ('mlx','faster-whisper'): parser.error('Backend must be mlx or faster-whisper')
        if not re.fullmatch(r'\d+k', args.bitrate) or not 32 <= int(args.bitrate[:-1]) <= 320: parser.error('Bitrate must be 32k–320k')
    try:
        result = library_workflow(args, interactive=not (args.non_interactive or nzb) and sys.stdin.isatty())
    except (Exception, KeyboardInterrupt) as ex:
        log(str(ex) or 'Stopped', 'ERROR'); result = 2 if isinstance(ex, NeedsReview) else 1
    return (93 if result == 0 else 94) if nzb else result


if __name__ == '__main__':
    def interrupted(signum, frame): raise KeyboardInterrupt('Interrupted by signal {}'.format(signum))
    signal.signal(signal.SIGTERM, interrupted)
    sys.exit(main())
