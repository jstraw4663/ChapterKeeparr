"""Explicit workflow gates and evidence assessments. No probabilities or implicit approvals."""
import time

POLICY_VERSION = 'gated-workflow-1'
GATES = (('inspect', 'Inspect files'), ('match', 'Match recording'), ('align', 'Align chapters'),
         ('verify', 'Verify'), ('save', 'Save'))
STATES = {'waiting', 'working', 'passed', 'review', 'blocked', 'skipped'}


def initialize(report):
    report['policy_version'] = POLICY_VERSION
    report.setdefault('gates', {key: {'label': label, 'state': 'waiting', 'detail': 'Not started'} for key,label in GATES})
    report.setdefault('assessment', {
        'recording': {'level': 'unknown', 'detail': 'Recording has not been matched'},
        'coverage': {'level': 'unknown', 'detail': 'Content completeness is not established'},
        'alignment': {'level': 'unknown', 'detail': 'Chapter timing has not been checked'},
        'speech': {'level': 'unknown', 'detail': 'No speech checks completed'},
        'integrity': {'level': 'unknown', 'detail': 'Output has not been validated'},
    })


def gate(report, key, state, detail):
    initialize(report)
    if key not in report['gates'] or state not in STATES:
        raise ValueError('Invalid workflow gate transition')
    report['gates'][key].update(state=state, detail=detail, updated_at=time.time())
    if state == 'working':
        report['active_gate'] = key
        keys = [k for k,_ in GATES]
        for later in keys[keys.index(key)+1:]:
            report['gates'][later].update(state='waiting',detail='Waiting for earlier checks')


def assess(report, dimension, level, detail):
    initialize(report)
    report['assessment'][dimension] = {'level': level, 'detail': detail}


def require_review(report, category, detail, gate_id=None):
    initialize(report)
    gate_id = gate_id or report.get('active_gate', 'inspect')
    report['review_reason'] = {'category': category, 'detail': detail}
    gate(report, gate_id, 'blocked' if category in ('service', 'source_changed', 'operational') else 'review', detail)


def assert_publishable(report):
    """Called after output validation, immediately before entering commit."""
    from .engine import NeedsReview
    initialize(report)
    if report.get('recovery_draft') is not None:
        raise NeedsReview('Recovery drafts cannot authorize publication')
    if any(report['gates'][key]['state'] != 'passed' for key in ('inspect','match','align','verify')):
        raise NeedsReview('Publication blocked: required workflow gates have not passed')
    if report['assessment']['coverage']['level'] != 'no_known_gaps':
        raise NeedsReview('Publication blocked: content coverage remains unresolved')
    if report['assessment']['integrity']['level'] != 'passed':
        raise NeedsReview('Publication blocked: output integrity is unverified')
    checks = report.get('checks', [])
    if not checks or any(c.get('passed') is not True for c in checks):
        raise NeedsReview('Publication blocked: required speech checks have not passed')


def present(job):
    """API projection. Legacy records never inherit newly verified gate claims."""
    report = (job.get('result') or {}).get('report') or {}
    current = report.get('policy_version') == POLICY_VERSION and bool(report.get('gates'))
    gates = report.get('gates') if current else {k: {'label': label, 'state': 'waiting', 'detail': 'No evidence recorded under this workflow'} for k,label in GATES}
    gates = {k: dict(v) for k,v in gates.items()}
    status = job.get('status')
    if status in ('queued','running') and status == 'queued':
        # A queued retry must not show a prior attempt as currently completed.
        gates = {k: {'label': label, 'state': 'waiting', 'detail': 'Queued; evidence will be revalidated'} for k,label in GATES}
    if status in ('failed','cancelled') and current:
        for item in gates.values():
            if item['state'] == 'working': item.update(state='blocked', detail=job.get('error') or status)
    assessment = report.get('assessment', {}) if current and status != 'queued' else {}
    reason = report.get('review_reason', {})
    if status in ('queued','running'): overall = 'Processing' if status=='running' else 'Queued'
    elif status == 'cancelled': overall = 'Cancelled'
    elif status == 'failed': overall = 'Processing blocked'
    elif assessment.get('coverage',{}).get('level') == 'suspected_gap': overall = 'Possible missing content'
    elif status == 'complete' and current and gates['save']['state'] == 'passed':
        overall = 'Verified — all numbered chapters checked' if report.get('verification_scope') == 'all_numbered' else 'Verified — sampled checks'
    elif status == 'skipped': overall = 'Unchanged — previous verification retained' if report.get('output_sha256') else 'Skipped — no processable source'
    elif not current and status == 'complete': overall = 'Completed under earlier verification rules'
    else: overall = 'Review required'
    category = reason.get('category', 'identity' if not report.get('recovery_draft') else 'chapters')
    next_action = {'identity': 'Choose or correct the recording', 'chapters': 'Review unresolved sections',
                   'source_inventory': 'Check source files and restore missing tracks',
                   'source_changed': 'Inspect changed files before retrying',
                   'service': 'Retry when the metadata service is available',
                   'operational': 'Resolve the reported processing problem'}.get(category, 'Inspect the report')
    return {'policy_version': report.get('policy_version'), 'overall': overall,
            'gates': [{'id': key, **gates[key]} for key,_ in GATES], 'assessment': assessment,
            'review_category': category, 'next_action': next_action, 'current_evidence': bool(current),
            'publication_allowed': False}  # Display metadata is never an authorization token.


def check_coverage(report, diagnostics):
    """A heuristic warning can block, but absence of a warning never proves completeness."""
    warnings = []
    if not diagnostics or not diagnostics.get('reference_duration_seconds') or not diagnostics.get('local_duration_seconds'):
        detail = 'Content coverage diagnostics are unavailable; publication requires a measured local and reference timeline'
        report['coverage_warnings'] = [detail]
        assess(report,'coverage','unresolved',detail)
        return [detail]
    if diagnostics:
        shortfall = diagnostics.get('reference_duration_seconds',0)-diagnostics.get('local_duration_seconds',0)
        if shortfall > 2:
            warnings.append(f'Local audio is {shortfall:.1f} seconds shorter than the published timeline; missing content or an edition edit needs review')
        differences = [p['difference'] for p in diagnostics.get('nearest_candidates',[])]
        if len(differences)>=6 and max(differences)-min(differences)>2:
            warnings.append('Boundary differences contain drift or internal changes inconsistent with one offset')
    report['coverage_warnings'] = warnings
    assess(report,'coverage','suspected_gap' if warnings else 'no_known_gaps',
           '; '.join(warnings) if warnings else 'No gap detected by inventory/runtime checks; this does not prove every passage is present')
    return warnings
