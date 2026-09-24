// Status-change events and where their notifications go (DESIGN.md §9).
// There is no push channel yet (GAPS G-003), so events come from diffing
// successive job polls. Pure; no DOM access.

import { toStatus } from './status.js';
import { bookFromJob, routeFor } from './books.js';

/** kind: 'ok' | 'warn' | 'bad' | 'info' | 'plain' (own-action confirmation). */
export function destinationFor(kind) {
  if (kind === 'plain') return null; // Own actions shrink in place and fade.
  if (kind === 'warn') return 'review';
  return 'queue';
}

export const snapshot = jobs => new Map((jobs || []).map(job => [job.id, toStatus(job).key]));

function eventFor(job, from, to) {
  const book = bookFromJob(job);
  const base = { jobId: job.id, title: '', body: book.status.detail, action: 'Open', href: routeFor(book), at: Date.now() };
  switch (to) {
    case 'review':
      return { ...base, kind: 'warn', title: `${book.title} needs review`, action: 'Review' };
    case 'verified':
    case 'optimized':
      return { ...base, kind: 'ok', title: `${book.title} is ${to}`, body: from === 'verified' || from === 'optimized' ? book.status.detail : 'All chapter checks passed · saved to library' };
    case 'failed':
      return { ...base, kind: 'bad', title: `${book.title} failed`, action: 'Open' };
    case 'converting':
      return { ...base, kind: 'info', title: from === 'review' ? `${book.title} resumed` : `${book.title} started`, body: from === 'review' ? 'Re-checking with your changes' : 'Converting and checking chapters', action: 'Watch' };
    case 'queued':
      return from ? null : { ...base, kind: 'info', title: `${book.title} queued`, body: 'Waiting for the converter', action: 'Watch' };
    case 'cancelled':
      return { ...base, kind: 'info', title: `${book.title} was cancelled`, body: 'Source files untouched', action: 'Open' };
    default:
      return null;
  }
}

/**
 * Compare the previous snapshot with the new job list.
 * `expected` maps jobId → status key the user's own action is about to cause;
 * that transition is not announced twice (the own-action note already was).
 * The first poll (previous === null) only sets the baseline.
 */
export function diffJobs(previous, jobs, expected = new Map()) {
  if (!previous) return [];
  const events = [];
  for (const job of jobs || []) {
    const to = toStatus(job).key;
    const from = previous.get(job.id);
    if (from === to) continue;
    if (expected.get(job.id) === to) continue;
    const event = eventFor(job, from, to);
    if (event) events.push({ ...event, dest: destinationFor(event.kind) });
  }
  return events;
}

/** Own-action confirmation: no destination, fades in place. */
export const ownAction = (title, body = '', jobId = null) => ({ kind: 'plain', title, body, jobId, dest: null, at: Date.now(), own: true });

/**
 * Activity rows derived from the job list, for when there's no server event log
 * (GAPS G-010): one row per job for its latest milestone.
 */
export function activityFromJobs(jobs) {
  const rows = [];
  for (const job of jobs || []) {
    const status = toStatus(job);
    const book = bookFromJob(job);
    const at = job.finished_at || job.updated_at || job.created_at;
    const kind = { verified: 'ok', optimized: 'ok', review: 'warn', failed: 'bad', cancelled: 'info', converting: 'play', queued: 'info' }[status.key];
    const text = {
      verified: `${book.title} verified`, optimized: `${book.title} optimized`, review: `${book.title} paused for review`,
      failed: `${book.title} failed`, cancelled: `${book.title} cancelled`, converting: `${book.title} converting`, queued: `${book.title} queued`,
    }[status.key];
    rows.push({ id: `job:${job.id}:${status.key}`, jobId: job.id, at, kind, text, detail: status.detail, href: routeFor(book), group: status.key });
  }
  return rows;
}

export const ACTIVITY_FILTERS = [
  ['all', 'All'],
  ['verified', 'Verified'],
  ['paused', 'Paused'],
  ['failed', 'Failed'],
  ['you', 'Your actions'],
];

export function passesActivity(row, filter) {
  if (filter === 'verified') return row.kind === 'ok';
  if (filter === 'paused') return row.kind === 'warn';
  if (filter === 'failed') return row.kind === 'bad';
  if (filter === 'you') return row.kind === 'you';
  return true;
}
