// The one place that maps server job records onto the design's status model
// (DESIGN.md §3). Components never read job.status directly. Pure; no DOM access.

export const STATUS = {
  queued: { label: 'Queued', tone: 'muted' },
  converting: { label: 'Converting', tone: 'ink' },
  review: { label: 'Needs review', tone: 'warn' },
  failed: { label: 'Failed', tone: 'bad' },
  verified: { label: 'Verified', tone: 'ok-soft' },
  optimized: { label: 'Optimized', tone: 'ok' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
};
export const STATUS_ORDER = ['review', 'failed', 'converting', 'queued', 'verified', 'optimized', 'cancelled'];

export const STEPS = ['Inspect', 'Match edition', 'Check audio', 'Save'];

// Server gates (app/flow.py GATES) → design steps. Align and Verify both belong to
// "Check audio", but the sub-check is always named so timing compatibility and
// speech verification stay distinct (GAPS G-031).
const GATE_STEP = { inspect: 1, match: 2, align: 3, verify: 3, save: 4 };
const GATE_SUB = { align: 'timing', verify: 'speech' };

const REVIEW_TITLES = {
  identity: 'Edition not confirmed',
  chapters: 'Chapter timing needs a decision',
  source_inventory: 'Source files may be missing tracks',
  source_changed: 'Source files changed',
  service: 'Metadata service unavailable',
  operational: 'Processing problem',
};

export const reportOf = job => {
  const result = job?.result;
  if (!result || typeof result !== 'object') return {};
  return result.report && typeof result.report === 'object' ? result.report : {};
};

const gatesOf = job => (Array.isArray(job?.workflow?.gates) ? job.workflow.gates : []);

/** Where the job is on the 4-step tracker. index 0 = not started. */
export function stepOf(job) {
  const gates = gatesOf(job);
  if (job?.status === 'queued' || !gates.length) return { index: 0, state: 'todo', sub: null, gate: null };
  const open = gates.find(g => ['working', 'review', 'blocked'].includes(g.state));
  if (open) {
    const state = open.state === 'working' ? (job.status === 'running' ? 'current' : 'failed')
      : open.state === 'review' ? 'paused' : (job.status === 'awaiting_review' ? 'paused' : 'failed');
    return { index: GATE_STEP[open.id] || 1, state, sub: GATE_SUB[open.id] || null, gate: open };
  }
  const passed = gates.filter(g => g.state === 'passed' || g.state === 'skipped');
  if (passed.length === gates.length) return { index: 4, state: 'done', sub: null, gate: null };
  const firstWaiting = gates.find(g => g.state === 'waiting');
  const index = firstWaiting ? GATE_STEP[firstWaiting.id] || 1 : 4;
  return { index, state: job.status === 'running' ? 'current' : 'todo', sub: GATE_SUB[firstWaiting?.id] || null, gate: firstWaiting || null };
}

export const stepName = step => {
  if (!step.index) return '';
  const name = STEPS[step.index - 1];
  return step.sub ? `${name} · ${step.sub}` : name;
};

/** Source MP3 state: 'removed' | 'present' | 'none' | 'unknown'. Never guesses. */
export function mp3State(job) {
  const report = reportOf(job);
  if (report.mode === 'repair_existing') return 'none';
  if (report.mode === 'convert_then_repair') {
    if (Number(report.mp3s_deleted) > 0) return 'removed';
    // Accepted-exception finalization always retains MP3s (app/acceptance.py).
    if (job?.options?.keep_mp3s || report.recovery_acceptance) return 'present';
    return 'unknown';
  }
  return 'unknown';
}

export const epubState = job => (reportOf(job).epub?.path ? 'paired' : 'missing');

const percent = value => {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n <= 1 ? n * 100 : n)));
};

export function reviewTitle(job) {
  const report = reportOf(job);
  const category = job?.workflow?.review_category || report.review_reason?.category;
  if (category === 'chapters' && report.recovery_draft) return 'Some chapters couldn’t be located';
  return REVIEW_TITLES[category] || 'Needs a decision';
}

export function reviewDetail(job) {
  const report = reportOf(job);
  return report.review_reason?.detail || report.reason || job?.error || '';
}

/**
 * The single status projection used by every screen.
 * → { key, label, tone, detail, step, stepLabel, pct, live, cancelling, canRetry, canCancel }
 */
export function toStatus(job) {
  const report = reportOf(job);
  const step = stepOf(job);
  const base = { step, stepLabel: stepName(step), pct: null, live: false, cancelling: false, canRetry: false, canCancel: false };
  let key, detail;
  switch (job?.status) {
    case 'queued':
      key = 'queued'; detail = 'Waiting for the converter'; base.canCancel = true;
      break;
    case 'running': {
      key = 'converting'; base.live = true; base.canCancel = !job.cancel_requested;
      base.pct = percent(job.progress);
      base.cancelling = Boolean(job.cancel_requested);
      const speech = job?.result?.speech_check;
      const listening = speech && Number(speech.total) ? ` · listening ${speech.current} of ${speech.total}` : '';
      detail = base.cancelling ? 'Cancelling at the next safe point'
        : step.index ? `Step ${step.index} of 4 · ${stepName(step)}${listening}` : 'Starting';
      break;
    }
    case 'awaiting_review':
      key = 'review'; detail = reviewTitle(job); base.canCancel = true;
      break;
    case 'failed':
      key = 'failed'; base.canRetry = true;
      detail = step.index ? `Failed at step ${step.index} · ${STEPS[step.index - 1]}` : 'Failed';
      break;
    case 'cancelled':
      key = 'cancelled'; detail = 'Job cancelled · source files untouched'; base.canRetry = true;
      break;
    case 'skipped':
      // GAPS G-043: an unchanged, previously verified book stays verified;
      // "no processable source" has no design status and reads as failed.
      if (report.output_sha256 || report.recovery_acceptance) {
        key = verifiedKey(job); detail = 'Unchanged since last verification'; base.canRetry = true;
      } else {
        key = 'failed'; detail = report.reason || 'Nothing to convert here'; base.canRetry = false;
      }
      break;
    case 'complete':
      key = verifiedKey(job); base.canRetry = true;
      detail = key === 'optimized' ? 'M4B and EPUB paired'
        : report.recovery_acceptance ? 'Finalized with accepted exceptions'
          : epubState(job) === 'missing' ? 'Verified · no EPUB paired'
            : mp3State(job) === 'present' ? 'Verified · MP3s still on disk' : 'Verified';
      break;
    default:
      key = 'failed'; detail = `Unknown status: ${job?.status ?? '—'}`;
  }
  const meta = STATUS[key];
  return { ...base, key, label: meta.label, tone: meta.tone, detail };
}

function verifiedKey(job) {
  // GAPS G-016: Optimized = verified + EPUB paired + no source MP3s on disk.
  // An unknown MP3 state is never promoted to Optimized.
  const mp3 = mp3State(job);
  return epubState(job) === 'paired' && (mp3 === 'removed' || mp3 === 'none') ? 'optimized' : 'verified';
}

export const isAttention = key => key === 'review' || key === 'failed';
export const isActive = key => key === 'converting' || key === 'review' || key === 'failed';
export const isDone = key => key === 'verified' || key === 'optimized';
