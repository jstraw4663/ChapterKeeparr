// Per-book history derived from the job record. The server keeps no event log
// (DESIGN-GAP: G-011), so this uses timestamps, gates, attempts and results
// that are actually recorded. Nothing is invented; unknown times sort last.
// Pure; no DOM access.

import { reportOf } from './status.js';
import { toMillis } from './format.js';

const GATE_TEXT = {
  inspect: ['Source files inspected', 'Source inspection stopped'],
  match: ['Edition matched', 'Edition not confirmed'],
  align: ['Chapter timing checked', 'Chapter timing needs a decision'],
  verify: ['Chapter audio verified', 'Chapter audio not verified'],
  save: ['Saved M4B to library', 'Saving stopped'],
};

/** → [{ at (ms|0), kind: ok|warn|bad|info|you, text, detail }] newest first */
export function historyFor(job, localLog = []) {
  if (!job) return [];
  const report = reportOf(job);
  const out = [];
  const push = (at, kind, text, detail = '') => out.push({ at: toMillis(at), kind, text, detail });

  push(job.created_at, 'info', 'Job created', `Source: ${job.path}`);
  if (job.started_at) {
    const checks = job.options?.verify_all ? 'every numbered chapter' : 'spot checks';
    push(job.started_at, 'info', `Attempt ${job.attempts || 1} started`, `Chapter checks: ${checks}`);
  }
  const gates = report.gates && typeof report.gates === 'object' ? report.gates : {};
  for (const [id, gate] of Object.entries(gates)) {
    if (!gate?.updated_at || !GATE_TEXT[id]) continue;
    if (gate.state === 'passed') push(gate.updated_at, 'ok', GATE_TEXT[id][0], gate.detail || '');
    else if (gate.state === 'review') push(gate.updated_at, 'warn', GATE_TEXT[id][1], gate.detail || '');
    else if (gate.state === 'blocked') push(gate.updated_at, 'bad', GATE_TEXT[id][1], gate.detail || '');
  }
  for (const attempt of report.edition_attempts || []) {
    const n = attempt.alignment?.matching_boundaries;
    const checks = Array.isArray(attempt.checks) ? attempt.checks : [];
    const passed = checks.filter(c => c.passed === true).length;
    out.push({ at: 0, kind: attempt.passed ? 'ok' : 'warn', text: `Edition ${attempt.asin || 'attempt'} ${attempt.passed ? 'confirmed' : 'not confirmed'}`,
      detail: [n != null ? `${n} matching boundaries` : '', checks.length ? `${passed} of ${checks.length} checks passed` : ''].filter(Boolean).join(' · ') });
  }
  for (const f of report.lookup_failures || []) out.push({ at: 0, kind: 'warn', text: `Couldn’t look up ${f.asin || 'an edition'}`, detail: f.reason || '' });
  if (job.status === 'awaiting_review') push(job.updated_at, 'warn', 'Paused for review', report.review_reason?.detail || report.reason || '');
  if (job.status === 'failed') push(job.finished_at || job.updated_at, 'bad', 'Failed', job.error || report.reason || '');
  if (job.status === 'cancelled') push(job.finished_at || job.updated_at, 'info', 'Job cancelled', 'Source files untouched');
  if (report.recovery_acceptance) push(job.finished_at, 'you', 'Finalized with accepted exceptions', `${Number(report.recovery_acceptance.supported_percent).toFixed(1)}% of markers supported`);
  if (Number(report.mp3s_deleted) > 0) push(job.finished_at, 'ok', 'Source MP3s removed', `${report.mp3s_deleted} files`);
  if (report.backup) push(job.finished_at, 'info', 'Previous M4B backed up', report.backup);
  for (const entry of localLog) if (entry.jobId === job.id && entry.own) out.push({ at: entry.at, kind: 'you', text: entry.text, detail: entry.detail || '' });
  // Newest first; entries without a recorded time keep their order after timed ones.
  return out.map((e, i) => ({ ...e, i })).sort((a, b) => (b.at || 0) - (a.at || 0) || a.i - b.i).map(({ i, ...e }) => e);
}
