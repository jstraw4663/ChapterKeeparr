"""Versioned timing diagnostics. Cached timing is never publication approval."""
import hashlib
import json
import os
from pathlib import Path
from collections import Counter
import math
import shutil
import resource
import sys
import re
import statistics

ALGORITHM_VERSION = 'alignment-recovery-6'


def embedded_named_headings(segment, boundary, clip_start):
    """Named headings embedded after prose need aligned, confident words and a pause."""
    from . import engine
    found = set()
    words = segment.get('words') or []
    for i, word in enumerate(words):
        token = engine.tokens(word.get('word', ''))
        kind = 'prologue' if token in (['prolog'], ['prologue']) else 'epilogue' if token in (['epilog'], ['epilogue']) else None
        if kind is None or not i:
            continue
        prefix = engine.tokens(' '.join(w.get('word', '') for w in words[max(0, i-3):i]))
        if any(t in prefix for t in ('in', 'the', 'read', 'reading', 'previous', 'next', 'remember', 'recall', 'from', 'during')):
            continue
        try:
            start, end, probability = float(word['start']), float(word['end']), float(word.get('probability', 0))
            prior_end = float(words[i-1]['end'])
            if (all(math.isfinite(v) for v in (start, end, probability, prior_end))
                    and 0 < end-start <= 4 and start-prior_end >= .35 and probability >= .7
                    and boundary-2.1 <= clip_start+start <= boundary+8):
                found.add(kind)
        except (KeyError, TypeError, ValueError):
            pass
    return found


def embedded_headings(segment, boundary, clip_start):
    """Additional draft evidence only: timed, separated, confident explicit headings.

    Missing word alignment never licenses a search-anywhere text match. Existing
    bounded wider retries still apply; uncertain cases stay for manual review.
    """
    from . import engine
    words = segment.get('words') or []
    found = set()
    for index, word in enumerate(words):
        if index == 0 or engine.tokens(word.get('word', '')) != ['chapter']:
            continue
        prefix = engine.tokens(' '.join(w.get('word', '') for w in words[max(0, index-6):index]))
        # Even a pause does not turn an explicit narrative reference into a heading.
        if any(t in prefix for t in ('in', 'chapter', 'read', 'reading', 'remember', 'recall', 'see', 'since', 'from', 'during', 'previous', 'next')):
            continue
        phrase = ''
        for end in range(index, min(len(words), index+7)):
            phrase += ' ' + words[end].get('word', '')
            # Require the complete number, not a prefix of sixty one or 61.5.
            number = engine.spoken_heading(phrase)
            if number is None:
                continue
            following = engine.tokens(words[end+1].get('word', '')) if end+1 < len(words) else []
            if following and (following[0] in engine.NUMBER_WORDS or following[0] in ('hundred', 'and') or following[0].isdigit()):
                continue
            try:
                start = float(word['start'])
                previous_end = float(words[index-1]['end'])
                timing = [(float(w['start']), float(w['end']), float(w.get('probability', 0))) for w in words[index:end+1]]
                if not all(math.isfinite(v) for row in timing for v in row) or not math.isfinite(previous_end):
                    break
                if any(b <= a or p < .7 for a,b,p in timing) or any(b > c for (_,b,_),(c,_,_) in zip(timing,timing[1:])):
                    break
                if boundary-2.1 <= clip_start+start <= boundary+8 and start-previous_end >= .35 and timing[-1][1]-start <= 4:
                    found.add(number)
            except (KeyError, TypeError, ValueError):
                pass
            break
    return found


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def evaluate(existing, remote, seconds, source_hash, identity, cache_dir=None, force=False):
    from . import engine
    timeline_hash = digest(remote)
    key = digest([ALGORITHM_VERSION, source_hash, existing, timeline_hash, seconds, identity])
    path = Path(cache_dir) / (key + '.json') if cache_dir and source_hash else None
    if path and path.is_file() and not force:
        try:
            value = json.loads(path.read_text())
            if value.get('cache_key') == key and value.get('algorithm_version') == ALGORITHM_VERSION:
                return dict(value, cached=True)
        except (OSError, ValueError, AttributeError):
            pass
    value = dict(algorithm_version=ALGORITHM_VERSION, timeline_hash=timeline_hash,
                 cache_key=key, cached=False, diagnostics={}, timing_passed=False)
    try:
        plan, alignment = engine.fit_timeline(existing, remote, seconds, value['diagnostics'])
        value.update(timing_passed=True, plan=plan, alignment=alignment,
                     reason='Timing anchors passed. Recording still requires speech verification.')
    except engine.NeedsReview as exc:
        value['reason'] = str(exc)
    if path:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix('.' + str(os.getpid()) + '.tmp')
        engine.write_json(temporary, value)
        os.replace(temporary, path)
        # Reconstructible cache only; reports remain durable job evidence.
        try:
            entries = sorted(path.parent.glob('*.json'), key=lambda p: p.stat().st_mtime_ns)
            for old in entries[:-1000]:
                old.unlink(missing_ok=True)
        except FileNotFoundError:
            pass  # Another worker may prune the shared reconstructible cache.
    return value


def identify_marker(transcript, boundary, clip_start, remote, evidence=None):
    """Identify from speech, never from a track's index or existing title."""
    from . import engine
    observed = set()
    named_kinds = set()
    good = []
    for segment in transcript.get('segments', []):
        at = clip_start + float(segment.get('start', 0))
        lp, ns = float(segment.get('avg_logprob', -99)), float(segment.get('no_speech_prob', 1))
        if not all(math.isfinite(x) for x in (at, lp, ns)) or lp < -1 or ns > .6:
            continue
        observed.update(embedded_headings(segment, boundary, clip_start))
        named_kinds.update(embedded_named_headings(segment, boundary, clip_start))
        if boundary - 2.1 <= at <= boundary + 8:
            good.append(segment.get('text',''))
            number = engine.spoken_heading(segment.get('text', ''))
            if number is not None: observed.add(number)
            heading = re.match(r'^\s*(prolog(?:ue)?|epilog(?:ue)?)(?:\s*[.!?:;,]|\s*$)', segment.get('text', ''), re.I)
            if heading:
                named_kinds.add('prologue' if heading[1].lower().startswith('prolog') else 'epilogue')
    candidates = [c for c in remote if engine.chapter_number(c['title']) in observed]
    named = [c for c in remote if engine.section_identity(c['title'])['kind'] in named_kinds]
    if len(observed) == 1 and len(candidates) == 1 and not named_kinds:
        return dict(title=candidates[0]['title'], reference_start=candidates[0]['start'],
                    status='supported', confidence='spoken heading', source='local speech',
                    reason='Spoken chapter identity supports retaining this existing marker; draft only.')
    if not observed:
        if len(named_kinds) > 1:
            return dict(title=None, reference_start=None, status='unresolved', confidence='ambiguous',
                        source='local speech', reason='Multiple named headings heard near this marker.')
        for chapter in remote:
            title = engine.norm(chapter['title'])
            if engine.chapter_number(chapter['title']) is not None: continue
            if engine.section_identity(chapter['title'])['kind'] in ('prologue', 'epilogue'): continue
            aliases = [title]
            if title.startswith('chapter '):
                aliases.append('interlude '+title[len('chapter '):])
            if any(engine.norm(text) == alias or engine.norm(text).startswith(alias+' ')
                   for text in good for alias in aliases if len(engine.tokens(alias)) >= 2 or alias in ('prologue','epilogue')):
                if chapter not in named: named.append(chapter)
        if len(named) == 1:
            return dict(title=named[0]['title'],reference_start=named[0]['start'],status='supported',
                        confidence='spoken named heading',source='local speech',
                        reason='A unique spoken named heading supports retaining this marker; draft only.')
        if len(named) > 1:
            return dict(title=None,reference_start=None,status='unresolved',confidence='ambiguous',source='local speech',reason='Multiple named sections heard near this marker.')
        if named_kinds:
            return dict(title=None, reference_start=None, status='unresolved', confidence='ambiguous',
                        source='local speech', reason='Spoken named heading has no unique section in this edition.')
    if observed and named_kinds:
        return dict(title=None, reference_start=None, status='unresolved', confidence='ambiguous',
                    source='local speech', reason='Conflicting numbered and named headings heard near this marker.')
    # Only unique, distinctive text openings; never assign EPUB titles by list order.
    if not observed and evidence:
        hits = [e for e in evidence.get('entries',[]) if len(set(engine.tokens(e.get('opening',''))[:18])) >= 8
                and engine.compare_opening(' '.join(good),e.get('opening','')) >= .85]
        if len(hits) == 1:
            title = hits[0]['title']; number = engine.chapter_number(title)
            matches = [c for c in remote if engine.norm(c['title']) == engine.norm(title) or
                       (number is not None and engine.chapter_number(c['title']) == number)]
            if len(matches) == 1:
                return dict(title=matches[0]['title'],reference_start=matches[0]['start'],status='supported',
                            confidence='distinctive opening',source='EPUB and local speech',
                            reason='A unique matching EPUB opening supports this existing marker; draft only.')
    return dict(title=None, reference_start=None, status='unresolved', confidence='ambiguous' if observed else 'unconfirmed',
                source='local speech', reason='Missing, conflicting or repeated chapter heading; no title assigned.')


def finalize_draft(draft, remote):
    from . import engine
    markers = draft['markers']
    ranks = {c['start']: i for i, c in enumerate(remote)}
    def conflict(marker, reason):
        marker.setdefault('prior_match', {k: marker.get(k) for k in ('title', 'reference_start', 'confidence', 'source')})
        marker.update(status='unresolved', confidence='ambiguous', reason=reason)
    for marker in markers:
        if marker.get('status') == 'supported' and marker.get('confidence') == 'spoken heading' and engine.chapter_number(marker.get('title') or '') is None:
            conflict(marker, 'Numbered speech was assigned to a named section. Review this match with the current heading parser.')
    counts = Counter(m['reference_start'] for m in markers if m.get('status') == 'supported' and m.get('reference_start') is not None)
    for marker in draft['markers']:
        if marker['reference_start'] is not None and counts[marker['reference_start']] > 1:
            conflict(marker, 'The same published chapter was heard at multiple local markers.')
    # Do not use an inverted recognition pair as fixed bounds for other markers.
    highest = None
    for marker in markers:
        if marker.get('status') != 'supported' or marker.get('reference_start') not in ranks: continue
        if highest and ranks[highest['reference_start']] > ranks[marker['reference_start']]:
            conflict(highest, 'Recognized sections conflict with the surrounding chapter order.')
            conflict(marker, 'Recognized sections conflict with the surrounding chapter order.')
        if highest is None or ranks[marker['reference_start']] > ranks[highest['reference_start']]: highest = marker
    # With enough consistent anchors, a large isolated residual is a conflict,
    # never a license to move a timestamp or invent the nearest chapter identity.
    anchors = [m for m in markers if m.get('status') == 'supported' and m.get('reference_start') in ranks and m.get('old_seconds') is not None]
    if len(anchors) >= 6:
        offsets = [m['old_seconds']-m['reference_start'] for m in anchors]
        center = statistics.median(offsets)
        spread = statistics.median(abs(t-center) for t in offsets)
        if spread <= 2:
            for m, offset in zip(anchors, offsets):
                if abs(offset-center) > max(60, 6*spread+2):
                    conflict(m, 'Speech identity conflicts with the otherwise consistent chapter timing. Review this match.')
    found = {m['reference_start'] for m in draft['markers'] if m['status'] == 'supported'}
    draft['missing_sections'] = [c for c in remote if c['start'] not in found]
    draft['supported_count'] = sum(m['status'] == 'supported' for m in draft['markers'])
    draft['unresolved_count'] = len(draft['markers']) - draft['supported_count']
    draft['publication_allowed'] = False


def scan_markers(source, data, remote, speech, args, report, folder, evidence=None):
    """On-demand bounded clips. Persist every result; never retag or publish."""
    from . import engine
    seconds = engine.duration(data)
    chapters = data.get('chapters', [])
    starts = [float(c['start_time']) for c in chapters]
    if not starts or len(starts) > 1000:
        raise engine.NeedsReview('Local-marker recovery needs 1–1000 existing markers. Chapterless audio requires a deeper scan.')
    if starts[0] != 0 or any(not math.isfinite(t) or t < 0 or t >= seconds for t in starts) or any(b <= a for a,b in zip(starts, starts[1:])):
        raise engine.NeedsReview('Existing marker times are invalid; local-marker recovery cannot safely retain them.')
    draft = dict(algorithm_version=ALGORITHM_VERSION, method='local-marker-review',
                 source_sha256=report['audio_source_sha256'], timeline_hash=digest(remote),
                 duration_seconds=seconds, markers=[], publication_allowed=False, reference_chapters=remote,
                 complete=False, total_markers=len(starts), missing_sections=remote)
    report['recovery_draft'] = draft
    report['status'] = 'checking_speech'
    clips = folder / 'recovery-clips'; clips.mkdir(exist_ok=True)
    for index, (chapter, boundary) in enumerate(zip(chapters, starts)):
        engine.log('Listening locally {}/{}: marker {}'.format(index+1,len(starts),index+1))
        if shutil.disk_usage(folder).free < 64 * 1024**2:
            raise engine.NeedsReview('Recovery paused: less than 64 MB free for bounded excerpts.')
        rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        rss_bytes = rss if sys.platform == 'darwin' else rss*1024
        if rss_bytes > float(os.getenv('RECOVERY_MAX_RSS_MB', '3000'))*1024**2:
            raise engine.NeedsReview('Recovery paused at the configured memory limit; partial draft retained.')
        if (index+1)*24*32000 > max(1,float(os.getenv('CACHE_MAX_GB','10')))*1024**3:
            raise engine.NeedsReview('Recovery excerpt budget reached; partial draft retained.')
        clip_start = max(0, boundary-2)
        wav = clips / ('marker-%04d.wav' % index)
        engine.run([args.ffmpeg, '-nostdin', '-v', 'error', '-y', '-ss', clip_start, '-i', source,
                    '-t', min(24, seconds-clip_start), '-map', '0:a:0', '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav])
        transcript = speech.transcribe(wav)
        engine.write_json(wav.with_suffix('.json'),transcript)
        marker = identify_marker(transcript,boundary,clip_start,remote,evidence)
        marker.update(old_title=chapter.get('tags',{}).get('title',''), old_seconds=boundary,
                      new_seconds=boundary, transcript=transcript.get('text',''),
                      audio_excerpt=str(wav.relative_to(folder)))
        draft['markers'].append(marker)
        finalize_draft(draft,remote)
        engine.write_report(folder,report)
    # One wider pass only. Keep the first-pass evidence durable before inference.
    for index, marker in enumerate(draft['markers']):
        if marker['status'] != 'unresolved': continue
        engine.log('Retrying unresolved marker {}/{} with a wider excerpt'.format(index+1,len(starts)))
        if shutil.disk_usage(folder).free < 64 * 1024**2:
            raise engine.NeedsReview('Recovery retry paused: insufficient disk space; partial draft retained.')
        rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        if (rss if sys.platform == 'darwin' else rss*1024) > float(os.getenv('RECOVERY_MAX_RSS_MB','3000'))*1024**2:
            raise engine.NeedsReview('Recovery retry paused at the memory limit; partial draft retained.')
        if (len(starts)*24+(index+1)*36)*32000 > max(1,float(os.getenv('CACHE_MAX_GB','10')))*1024**3:
            raise engine.NeedsReview('Recovery retry excerpt budget reached; partial draft retained.')
        boundary = starts[index]
        clip_start = max(0,boundary-8)
        clip_end = min(seconds,boundary+28)
        marker['initial_attempt'] = dict(marker)
        marker['retry'] = {'status':'running','clip_start_seconds':clip_start,'clip_end_seconds':clip_end}
        engine.write_report(folder,report)
        wav = clips / ('marker-%04d-retry.wav' % index)
        engine.run([args.ffmpeg,'-nostdin','-v','error','-y','-ss',clip_start,'-i',source,
                    '-t',clip_end-clip_start,'-map','0:a:0','-vn','-ar','16000','-ac','1','-c:a','pcm_s16le',wav])
        transcript = speech.transcribe(wav)
        engine.write_json(wav.with_suffix('.json'),transcript)
        result = identify_marker(transcript,boundary,clip_start,remote,evidence)
        # A different window must not erase contradictory/duplicate first-pass evidence.
        if marker.get('confidence') == 'ambiguous' or marker.get('reference_start') is not None:
            result.update(status='unresolved',confidence='ambiguous',
                          reason='First-pass conflicting or duplicate evidence still requires review.')
        marker.update(result,transcript=transcript.get('text',''),audio_excerpt=str(wav.relative_to(folder)))
        marker['retry']['status'] = 'complete'
        finalize_draft(draft,remote)
        engine.write_report(folder,report)
    draft['complete'] = True
    finalize_draft(draft,remote)
    return draft


def run_local_review(args, report, folder):
    """Redraft existing audio or the exact retained conversion, under the book lock."""
    import fcntl
    from . import engine, inspection
    target = args.target
    root = target if target.is_dir() else target.parent
    fd = engine.open_book_lock(root)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise engine.NeedsReview('Another workflow is using this book folder.')
        source = target
        if target.is_dir():
            prior = getattr(args, 'prior_report', {})
            inventory = prior.get('source_manifest')
            source = Path(args.prepared_cache) / 'prepared.m4b'
            expected = prior.get('audio_source_sha256')
            if not inventory or not expected or not source.is_file() or source.is_symlink():
                raise engine.NeedsReview('The retained conversion is unavailable. Run the checks again to prepare current audio before drafting.')
            if not inspection.unchanged(inventory, root, args.check_cancel) or engine.file_hash(source) != expected:
                raise engine.NeedsReview('Source files or retained audio changed. Run the checks again before drafting.')
            report['source_manifest'] = inventory
        result = _run_local_review(args, report, folder, source, root)
        if target.is_dir() and not inspection.unchanged(report['source_manifest'], root, args.check_cancel):
            report['recovery_draft'].update(complete=False, invalidated=True)
            engine.write_report(folder, report)
            raise engine.NeedsReview('Source inventory changed during recovery; draft invalidated.')
        return result
    except engine.NeedsReview as ex:
        # Keep the current gate and invalidation evidence visible to the worker.
        report.update(status='needs_review', reason=str(ex))
        engine.write_report(folder, report)
        raise
    finally:
        os.close(fd)


def _run_local_review(args, report, folder, source, root):
    from . import engine, flow
    flow.gate(report,'inspect','working','Inspecting existing audio for a draft-only scan')
    if not source.is_file() or source.suffix.lower() != '.m4b':
        raise engine.NeedsReview('Choose an existing M4B for local-marker review.')
    if not args.asin:
        raise engine.NeedsReview('Select a recording ASIN before reviewing local markers.')
    data = engine.probe(args.ffprobe,source)
    seconds = engine.duration(data)
    source_hash = engine.file_hash(source)
    report.update(status='researching', input=str(source), source_duration_seconds=seconds,
                  audio_source_sha256=source_hash, algorithm_version=ALGORITHM_VERSION)
    flow.gate(report,'inspect','passed','Existing audio inspected and fingerprinted')
    flow.gate(report,'match','working','Checking the selected recording metadata')
    book = engine.get_json('https://api.audnex.us/books/'+args.asin+'?region='+args.region)
    if book.get('asin') != args.asin or not engine.eligible_book(book,args.title,args.author,args.narrator,seconds):
        raise engine.NeedsReview('Selected recording metadata does not match this file. Correct the identity before recovery.')
    published = engine.get_json('https://api.audnex.us/books/'+args.asin+'/chapters?region='+args.region)
    if published.get('asin') != args.asin or published.get('isAccurate') is not True:
        raise engine.NeedsReview('Selected recording has no verified published timeline.')
    remote = engine.remote_timeline(published)
    # Redrafting must retain the same content-gap warnings as automatic recovery.
    diagnostics = evaluate(data.get('chapters', []), remote, seconds, source_hash,
                           [args.title, args.author, args.narrator])['diagnostics']
    flow.check_coverage(report, diagnostics)
    report['edition'] = engine.summaries(book)
    report['selected_recording'] = {'asin':args.asin,'region':args.region}
    flow.gate(report,'match','passed','Selected recording metadata is compatible')
    flow.assess(report,'recording','compatible','Available recording metadata passed compatibility checks')
    flow.gate(report,'align','working','Scanning existing markers; draft cannot publish')
    evidence = []
    for path in sorted(root.glob('*.epub'))[:10]:
        if path.is_symlink(): continue
        try:
            item = engine.epub_evidence(path)
            if engine.similar_title(item['title'],book.get('title','')) >= .88 and engine.similar(item['author'],engine.names(book.get('authors'))) >= .78:
                evidence.append(item)
        except (ValueError, KeyError, OSError) as exc:
            report.setdefault('notes',[]).append('EPUB could not be used: '+str(exc))
    evidence = evidence[0] if len(evidence) == 1 else None
    if evidence: report['epub'] = {'title': evidence['title'], 'path': evidence['path']}
    speech = engine.LocalSpeech(args.backend,args.model,args.model_cache)
    draft = scan_markers(source,data,remote,speech,args,report,folder,evidence)
    if engine.file_hash(source) != source_hash:
        draft.update(complete=False, invalidated=True)
        engine.write_report(folder, report)
        raise engine.NeedsReview('Source changed during recovery. Draft is invalid; scan the current file again.')
    report.update(status='needs_review',reason='Local-marker draft saved: {} supported, {} unresolved markers and {} unresolved published sections. No audio was changed. Review is required.'.format(draft['supported_count'],draft['unresolved_count'],len(draft['missing_sections'])))
    flow.assess(report,'alignment','partial',f"{draft['supported_count']} supported existing markers; draft cannot publish")
    if report['assessment']['coverage']['level'] != 'suspected_gap':
        flow.assess(report,'coverage','unresolved','Existing marker review cannot establish complete content')
    flow.assess(report,'speech','local_markers','Existing markers scanned; missing/new boundaries are not verified')
    flow.require_review(report,'chapters',report['reason'],'align')
    engine.write_report(folder,report)
    return 2


def automatic_candidate(report):
    """Escalate only one unambiguous metadata-compatible timeline; never a service error."""
    candidates = [a for a in report.get('alignment_attempts',[]) if a.get('identity_compatible') is True
                  and a.get('diagnostics',{}).get('reference_chapters') and not a.get('timing_passed')]
    requested = report.get('identity',{}).get('asin')
    if requested:
        selected = [a for a in candidates if a['asin']==requested]
        if selected: return selected[0]
    hashes = {a.get('timeline_hash') for a in candidates}
    return candidates[0] if len(hashes)==1 and candidates else None


def automatic_review(source,data,evidence,args,report,folder):
    from . import engine, flow
    import contextlib
    candidate = automatic_candidate(report)
    if not candidate or report.get('automatic_recovery_attempted'): return False
    report['automatic_recovery_attempted'] = True
    report['edition'] = candidate['edition']
    report['selected_recording'] = {'asin':candidate['asin'],'region':candidate['region']}
    flow.gate(report,'match','passed','Recording metadata is compatible; timing needs recovery')
    flow.assess(report,'recording','compatible','Title/author/narrator and edition filters passed; not a probability')
    flow.check_coverage(report,candidate['diagnostics'])
    flow.gate(report,'align','working','Checking existing markers against local speech and matching EPUB evidence')
    engine.write_report(folder,report)
    with getattr(args,'recovery_slot',contextlib.nullcontext)():
        speech=engine.LocalSpeech(args.backend,args.model or ('mlx-community/whisper-small.en-mlx' if args.backend=='mlx' else 'small.en'),args.model_cache)
        scan_markers(source,data,candidate['diagnostics']['reference_chapters'],speech,args,report,folder,evidence)
    draft=report['recovery_draft']
    if engine.file_hash(source)!=report['audio_source_sha256']:
        draft['invalidated']=True
        flow.require_review(report,'source_changed','Source changed during recovery','align')
        raise engine.NeedsReview('Source changed during recovery; draft invalidated')
    flow.assess(report,'alignment','partial',f"{draft['supported_count']} of {draft['total_markers']} existing markers supported; draft cannot publish")
    flow.assess(report,'speech','local_markers','All existing markers scanned; new/missing boundaries are not verified')
    if draft['missing_sections'] and report['assessment']['coverage']['level']!='suspected_gap':
        flow.assess(report,'coverage','unresolved',f"{len(draft['missing_sections'])} published sections remain unlocated; this does not prove missing audio")
    detail=f"Automatic recovery saved a draft: {draft['supported_count']} supported markers, {draft['unresolved_count']} unresolved markers and {len(draft['missing_sections'])} unlocated published sections. Review the evidence; original audio is unchanged."
    flow.require_review(report,'chapters',detail,'align')
    report.update(status='needs_review',reason=detail)
    engine.write_report(folder,report)
    return True
