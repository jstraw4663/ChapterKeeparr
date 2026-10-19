"""Explicit, fingerprint-bound recovery acceptance. Never infer optional chapters."""
import copy
import fcntl
import math
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from . import engine, flow, inspection, recovery


def references(report):
    draft = report.get('recovery_draft') or {}
    if draft.get('reference_chapters'):
        return draft['reference_chapters']
    for attempt in report.get('alignment_attempts', []):
        if attempt.get('timeline_hash') == draft.get('timeline_hash'):
            return attempt.get('diagnostics', {}).get('reference_chapters', [])
    return []


def token(report):
    return recovery.digest([report.get('recovery_draft'), report.get('source_manifest'),
                            report.get('edition'), report.get('coverage_warnings'), references(report)])


def preview(report, default=95):
    draft = copy.deepcopy(report.get('recovery_draft') or {})
    remote = references(report)
    markers = draft.get('markers', [])
    if not markers:
        return None
    if remote:
        recovery.finalize_draft(draft, remote)
    supported = sum(m.get('status') == 'supported' for m in markers)
    return {'token': token(report), 'supported_percent': 100*supported/len(markers),
            'default_minimum_percent': default, 'supported': supported, 'total': len(markers),
            'ready': bool(draft.get('complete') and not draft.get('invalidated') and remote),
            'markers': [{'index': i+1, 'title': m.get('old_title',''), 'seconds': m['old_seconds'],
                         'suggested_title': m.get('title') if m.get('status') == 'supported' else None,
                         'supported': m.get('status') == 'supported', 'excerpt': m.get('audio_excerpt'),
                         'reference_id': str(m['reference_start']) if m.get('status') == 'supported' else None,
                         'transcript': m.get('transcript') or '',
                         'removable': i > 0} for i,m in enumerate(markers)],
            'sections': [{'id': str(c['start']), 'title': c['title']} for c in draft.get('missing_sections',[])],
            'published_sections': [{'id': str(c['start']), 'title': c['title']} for c in remote],
            'unresolved_markers': [{'index': i+1, 'title': m.get('old_title') or 'Untitled marker',
                                    'seconds': m['old_seconds']} for i,m in enumerate(markers) if m.get('status')!='supported'],
            'coverage_warnings': report.get('coverage_warnings') or [],
            'requires_gap_acceptance': True}  # Marker recognition never establishes completeness.


def validate(report, answer):
    info = preview(report)
    if not info or not info['ready']:
        raise engine.NeedsReview('A complete, valid recovery scan with reference evidence is required. Resume checks first.')
    if answer.get('draft_token') != info['token']:
        raise engine.NeedsReview('The reviewed draft changed. Review the current evidence before finalizing.')
    minimum = answer.get('minimum_percent')
    if isinstance(minimum,bool) or not isinstance(minimum,(int,float)) or not math.isfinite(minimum) or not 1 <= minimum <= 100:
        raise engine.NeedsReview('Minimum supported markers must be between 1 and 100 percent.')
    if not info['supported'] or info['supported_percent'] + 1e-9 < minimum:
        raise engine.NeedsReview('Supported marker coverage is below the selected minimum.')
    assignments = manual_assignments(report, answer)
    remaining = [s for s in info['sections'] if s['id'] not in assignments]
    if set(answer.get('optional_sections',[])) != {s['id'] for s in remaining}:
        raise engine.NeedsReview('Explicitly accept each unlocated published section as optional for this book.')
    if answer.get('marker_decisions') is not None:
        marker_plan(report, answer)
    elif info['unresolved_markers'] and answer.get('preserve_unresolved') is not True:
        raise engine.NeedsReview('Accept retaining the original labels and times of unresolved markers.')
    if answer.get('accept_possible_gap') is not True:
        raise engine.NeedsReview('Separately accept unresolved content coverage for this recording.')
    draft = report['recovery_draft']
    markers = draft['markers']
    if len(markers) != draft.get('total_markers'):
        raise engine.NeedsReview('The draft does not contain every original marker.')
    remote = references(report)
    if recovery.digest(remote) != draft.get('timeline_hash'):
        raise engine.NeedsReview('Reference timeline evidence changed.')
    seen = set()
    previous_reference = -1
    for m in markers:
        if m.get('new_seconds') != m.get('old_seconds'):
            raise engine.NeedsReview('This acceptance path cannot move or create markers.')
        if m.get('status') == 'supported':
            matches = [c for c in remote if c['start']==m.get('reference_start') and c['title']==m.get('title')]
            if len(matches)!=1 or m['reference_start'] in seen:
                raise engine.NeedsReview('Supported chapter identities conflict or repeat.')
            if m['reference_start'] <= previous_reference:
                raise engine.NeedsReview('Supported chapter identities are out of published order.')
            previous_reference = m['reference_start']
            seen.add(m['reference_start'])
    return {**info, 'sections': remaining, 'manual_assignments': assignments}


def manual_assignments(report, answer):
    """Resolve IDs against this exact draft; labels supplied by the client are ignored."""
    markers = report['recovery_draft']['markers']
    decisions = answer.get('marker_decisions')
    if decisions is None:
        return {}
    if not isinstance(decisions, list) or len(decisions) != len(markers):
        raise engine.NeedsReview('Review a decision for every original marker.')
    indexed = {}
    for d in decisions:
        if not isinstance(d, dict) or type(d.get('index')) is not int or not 1 <= d['index'] <= len(markers) or d['index'] in indexed:
            raise engine.NeedsReview('Marker decisions contain an unknown or duplicate index.')
        indexed[d['index']] = d
    remote = {str(c['start']): c for c in references(report)}
    used = set()
    assigned = {}
    previous = []
    for i, marker in enumerate(markers, 1):
        decision = indexed[i]
        if decision.get('action') == 'remove':
            continue
        manual = decision.get('action') == 'published'
        identity = decision.get('section_id') if manual else str(marker['reference_start']) if marker.get('status') == 'supported' else None
        if identity is None and not manual:
            continue
        if not isinstance(identity, str) or identity not in remote:
            raise engine.NeedsReview('Choose a published section from the current draft.')
        if identity in used:
            raise engine.NeedsReview('A published section cannot be assigned to two retained markers.')
        override = manual and decision.get('override_order') is True
        if any(remote[identity]['start'] < start and not (override or accepted) for start, accepted in previous):
            raise engine.NeedsReview('Assigned sections must follow the published order. Review the selected timestamp.')
        previous.append((remote[identity]['start'], override))
        used.add(identity)
        if manual:
            assigned[identity] = {'index': i, 'title': remote[identity]['title'], 'seconds': marker['old_seconds'], 'override_order': override}
    return assigned


def marker_plan(report, answer):
    """Explicit navigation edits; recognition coverage always uses the original draft."""
    markers = report['recovery_draft']['markers']
    decisions = answer.get('marker_decisions')
    if decisions is None:
        return [{'start_seconds':m['old_seconds'], 'title':m['title'] if m['status']=='supported' else m.get('old_title','')} for m in markers]
    assignments = manual_assignments(report, answer)
    if not isinstance(decisions, list) or len(decisions) != len(markers):
        raise engine.NeedsReview('Review a decision for every original marker.')
    indexed = {}
    for d in decisions:
        if not isinstance(d, dict) or type(d.get('index')) is not int or not 1 <= d['index'] <= len(markers) or d['index'] in indexed:
            raise engine.NeedsReview('Marker decisions contain an unknown or duplicate index.')
        indexed[d['index']] = d
    plan = []
    for i,m in enumerate(markers, 1):
        d = indexed[i]; action = d.get('action')
        if action == 'remove':
            if i == 1 or d.get('confirmed') is not True:
                raise engine.NeedsReview('Confirm each removal; the first marker must remain.')
            continue
        if action == 'keep': title = m.get('old_title','')
        elif action == 'suggested' and m.get('status') == 'supported': title = m['title']
        elif action == 'published': title = assignments[d['section_id']]['title']
        elif action == 'rename':
            title = d.get('title')
            if not isinstance(title,str) or not title.strip() or len(title)>200 or any(ord(c)<32 for c in title):
                raise engine.NeedsReview('Enter a chapter name of 1–200 characters without control characters.')
            title = title.strip()
        else: raise engine.NeedsReview('Invalid marker action or unavailable suggested name.')
        plan.append({'start_seconds':m['old_seconds'], 'title':title})
    return plan


def finalize(args, prior, answer, folder):
    """Retag the exact reviewed audio; preserve source tracks and original M4B backup."""
    info = validate(prior, answer)
    report = copy.deepcopy(prior)
    report.pop('review_reason',None); report.pop('reason',None)
    report['checks'] = []
    if getattr(args,'evidence_report_path',None):
        report['recovery_evidence_report_path'] = args.evidence_report_path
    report['verification_scope'] = 'accepted_exceptions'
    report['recovery_acceptance'] = {**answer, 'supported_percent':info['supported_percent'],
                                    'accepted_at':datetime.now(timezone.utc).isoformat(),
                                    'sections':info['sections'], 'unresolved_markers':info['unresolved_markers']}
    report['recovery_acceptance']['manual_assignments'] = info['manual_assignments']
    target = args.target
    root = target if target.is_dir() else target.parent
    fd = engine.open_book_lock(root)
    committed = {}
    try:
        try: fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError: raise engine.NeedsReview('Another workflow is using this book folder.')
        if (root/engine.REPORTS_DIR).is_symlink():
            raise engine.NeedsReview('Report directory must not be a symbolic link.')
        folder = root/engine.REPORTS_DIR/('accepted-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
        folder.mkdir(parents=True)
        args._report_path = folder/'report.json'
        report.update(status='starting',input=str(target))
        flow.gate(report,'inspect','working','Rechecking the exact reviewed source and original marker inventory')
        engine.write_report(folder,report)
        existing = target.is_file()
        source = target if existing else args.prepared_cache/'prepared.m4b'
        destination = target if existing else root/(root.name+'.m4b')
        report['output'] = str(destination)
        draft = report['recovery_draft']
        if source.is_symlink() or engine.file_hash(source) != draft['source_sha256']:
            raise engine.NeedsReview('Reviewed audio changed or retained conversion is unavailable. Resume checks before accepting again.')
        snapshot = engine.fingerprint(source)
        inventory = report.get('source_manifest')
        if not existing and (not inventory or not inspection.unchanged(inventory,root,args.check_cancel)):
            raise engine.NeedsReview('MP3 source inventory changed; approval cannot be reused.')
        data = engine.probe(args.ffprobe,source)
        chapters = data.get('chapters',[])
        if len(chapters)!=len(draft['markers']) or any(float(c['start_time']) != m['old_seconds'] or c.get('tags',{}).get('title','') != m.get('old_title','') for c,m in zip(chapters,draft['markers'])):
            raise engine.NeedsReview('Original chapter inventory does not match the reviewed draft.')
        flow.gate(report,'inspect','passed','Reviewed source hash and original marker inventory match')
        if not report.get('edition',{}).get('asin'):
            raise engine.NeedsReview('Recording identity is missing from the draft.')
        flow.gate(report,'match','passed','Previously matched recording is bound to the reviewed draft')
        plan = marker_plan(prior, answer)
        report['recovery_acceptance']['saved_markers'] = len(plan)
        report['recovery_acceptance']['removed_markers'] = len(draft['markers']) - len(plan)
        # Acceptance is a separate approval object; the evidence remains explicitly a draft.
        flow.gate(report,'align','passed','Reviewed names and navigation removals applied; retained marker times unchanged')
        flow.assess(report,'alignment','accepted_exceptions','No marker times moved and no unlocated sections invented')
        flow.assess(report,'coverage','accepted_exceptions','User accepted the listed unlocated sections and possible content gaps')
        flow.assess(report,'speech','accepted_exceptions',f"{info['supported']} of {info['total']} marker identities supported; exceptions explicitly accepted")
        flow.gate(report,'verify','working','Validating the accepted plan and unchanged audio payload')
        report['status']='validating_output';engine.write_report(folder,report)
        plan_file=folder/'accepted.chapters.json'
        engine.write_json(plan_file,{'source_sha256':draft['source_sha256'],'expected_duration_seconds':engine.duration(data),'chapters':plan,'acceptance':report['recovery_acceptance']})
        with tempfile.TemporaryDirectory(prefix='.mp3tom4b-accepted-',dir=root) as temp:
            staged=Path(temp)/'validated.m4b'
            engine.retag(source,staged,plan_file,args.ffmpeg,args.ffprobe,asin=report['edition']['asin'])
            args.check_cancel()
            if engine.file_hash(source)!=draft['source_sha256'] or engine.fingerprint(source)!=snapshot:
                raise engine.NeedsReview('Audio changed before publication; acceptance invalidated.')
            if inventory and not inspection.unchanged(inventory,root,args.check_cancel):
                raise engine.NeedsReview('Source inventory changed before publication.')
            flow.assess(report,'integrity','passed','Chapter metadata validated, full output decoded and audio payload unchanged')
            flow.gate(report,'verify','passed','Accepted plan and output integrity validated')
            flow.assert_publishable(report)
            flow.gate(report,'save','working','Backing up the original and committing accepted metadata')
            report['status']='committing';engine.write_report(folder,report)
            backup=engine.commit_result(staged,destination,snapshot if existing else None,draft['source_sha256'] if existing else None,folder,committed)
            if backup:report['backup']=str(backup)
        flow.gate(report,'save','passed','Finalized with accepted exceptions; source MP3s retained')
        report.update(status='complete',output_sha256=engine.file_hash(destination),mp3s_deleted=0,
                      completion_label='Finalized with accepted exceptions')
        engine.write_report(folder,report)
        return 0
    except (Exception,KeyboardInterrupt) as ex:
        report.update(status='cleanup_incomplete' if committed.get('committed') else 'needs_review',reason=str(ex))
        if committed.get('backup'): report['backup']=committed['backup']
        flow.require_review(report,'operational' if committed.get('committed') or not isinstance(ex,engine.NeedsReview) else 'source_changed',str(ex))
        engine.write_report(folder,report)
        if isinstance(ex,KeyboardInterrupt): raise
        return 1 if committed.get('committed') or not isinstance(ex,engine.NeedsReview) else 2
    finally:
        os.close(fd)
