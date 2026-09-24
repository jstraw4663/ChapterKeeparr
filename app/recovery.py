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

ALGORITHM_VERSION = 'alignment-recovery-4'


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
    good = []
    for segment in transcript.get('segments', []):
        at = clip_start + float(segment.get('start', 0))
        lp, ns = float(segment.get('avg_logprob', -99)), float(segment.get('no_speech_prob', 1))
        if not all(math.isfinite(x) for x in (at, lp, ns)) or lp < -1 or ns > .6:
            continue
        if boundary - 2.1 <= at <= boundary + 8:
            good.append(segment.get('text',''))
            number = engine.spoken_heading(segment.get('text', ''))
            if number is not None: observed.add(number)
    candidates = [c for c in remote if engine.chapter_number(c['title']) in observed]
    if len(observed) == 1 and len(candidates) == 1:
        return dict(title=candidates[0]['title'], reference_start=candidates[0]['start'],
                    status='supported', confidence='spoken heading', source='local speech',
                    reason='Spoken chapter identity supports retaining this existing marker; draft only.')
    if not observed:
        named = []
        for chapter in remote:
            title = engine.norm(chapter['title'])
            if engine.chapter_number(chapter['title']) is not None: continue
            aliases = [title]
            if title.startswith('chapter '):
                aliases.append('interlude '+title[len('chapter '):])
            if any(engine.norm(text) == alias or engine.norm(text).startswith(alias+' ')
                   for text in good for alias in aliases if len(engine.tokens(alias)) >= 2 or alias in ('prologue','epilogue')):
                named.append(chapter)
        if len(named) == 1:
            return dict(title=named[0]['title'],reference_start=named[0]['start'],status='supported',
                        confidence='spoken named heading',source='local speech',
                        reason='A unique spoken named heading supports retaining this marker; draft only.')
        if len(named) > 1:
            return dict(title=None,reference_start=None,status='unresolved',confidence='ambiguous',source='local speech',reason='Multiple named sections heard near this marker.')
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
    counts = Counter(m['reference_start'] for m in draft['markers'] if m['reference_start'] is not None)
    for marker in draft['markers']:
        if marker['reference_start'] is not None and counts[marker['reference_start']] > 1:
            marker.update(status='unresolved', confidence='ambiguous', reason='The same published chapter was heard at multiple local markers.')
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
    from . import engine, flow
    flow.gate(report,'inspect','working','Inspecting existing audio for a draft-only scan')
    source = args.target
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
    report['edition'] = engine.summaries(book)
    report['selected_recording'] = {'asin':args.asin,'region':args.region}
    flow.gate(report,'match','passed','Selected recording metadata is compatible')
    flow.assess(report,'recording','compatible','Available recording metadata passed compatibility checks')
    flow.gate(report,'align','working','Scanning existing markers; draft cannot publish')
    evidence = []
    for path in sorted(source.parent.glob('*.epub'))[:10]:
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
        raise engine.NeedsReview('Source changed during recovery. Draft is invalid; scan the current file again.')
    report.update(status='needs_review',reason='Local-marker draft saved: {} supported, {} unresolved markers and {} unresolved published sections. No audio was changed. Review is required.'.format(draft['supported_count'],draft['unresolved_count'],len(draft['missing_sections'])))
    flow.assess(report,'alignment','partial',f"{draft['supported_count']} supported existing markers; draft cannot publish")
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
