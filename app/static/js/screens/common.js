// Shared screen behaviour: job actions with confirmation, offline gating and the
// merged activity feed. One way to cancel, retry or report an own action.

import { html } from '../format.js';
import { api } from '../api.js';
import { state, refresh, expect, isOffline, bookById } from '../store.js';
import { ownAction, activityFromJobs } from '../events.js';
import { notify } from '../notify.js';
import { readLog } from '../prefs.js';
import { confirmSheet, isPhone } from '../overlay.js';
import { button, confirmRow } from '../ui.js';

export const OFFLINE_REASON = 'Needs a connection';
export const offline = () => isOffline();

/** Server action button: disabled with "Needs a connection" while offline. */
export const serverButton = opts => button({ ...opts, disabled: opts.disabled || offline(), disabledReason: opts.disabled ? opts.disabledReason : OFFLINE_REASON });

export function reportError(error, title = 'That didn’t work') {
  notify({ kind: 'bad', title, body: error?.message || String(error), dest: null, at: Date.now() });
}

/** Cancel with confirmation: inline row on desktop (ctx.ui.confirm), sheet on phone. */
export async function askCancel(jobId, ctx) {
  if (isPhone()) {
    const book = bookById(jobId);
    const ok = await confirmSheet({ title: 'Cancel this job?', body: `${book?.title || 'This book'} leaves the queue. Your source files stay where they are.`, confirmLabel: 'Cancel job' });
    if (ok) await cancelJob(jobId);
    return;
  }
  ctx.ui.confirm = `cancel:${jobId}`;
  ctx.rerender();
}

export async function cancelJob(jobId, ctx) {
  const book = bookById(jobId);
  if (ctx) { ctx.ui.confirm = null; ctx.rerender(); }
  try {
    const job = await api.cancel(jobId);
    if (job?.status === 'cancelled') expect(jobId, 'cancelled');
    notify(ownAction(job?.status === 'cancelled' ? 'Job cancelled' : 'Cancelling at the next safe point', `${book?.title || 'The book'} · source files untouched`, jobId));
    await refresh({ fresh: true });
  } catch (error) { reportError(error, 'Couldn’t cancel the job'); }
}

export async function retryJob(jobId) {
  const book = bookById(jobId);
  try {
    await api.retry(jobId);
    expect(jobId, 'queued');
    notify({ kind: 'info', title: `${book?.title || 'Job'} queued again`, body: 'It starts when the converter is free', action: 'Watch', href: '#/queue', dest: 'queue', jobId, at: Date.now() });
    await refresh({ fresh: true });
  } catch (error) { reportError(error, 'Couldn’t retry the job'); }
}

/** Inline cancel confirmation or the Cancel button. */
export function cancelControl(jobId, ctx, { label = 'Cancel', size = 'md', question = 'Stop this job?' } = {}) {
  if (ctx.ui.confirm === `cancel:${jobId}`) return confirmRow({ question, keepAct: 'confirm-keep', confirmAct: 'confirm-cancel', confirmLabel: 'Cancel job', arg: jobId });
  return serverButton({ label, act: 'ask-cancel', arg: jobId, size });
}

export const cancelActions = {
  'ask-cancel': (el, ev, ctx) => askCancel(el.dataset.arg, ctx),
  'confirm-keep': (el, ev, ctx) => { ctx.ui.confirm = null; ctx.rerender(); },
  'confirm-cancel': (el, ev, ctx) => cancelJob(el.dataset.arg, ctx),
  retry: el => retryJob(el.dataset.arg),
};

/**
 * Activity rows: one per job from the server list, plus this device's own actions
 * and notifications. DESIGN-GAP: G-010 — a server event log would replace this.
 */
export function activityRows() {
  const fromJobs = activityFromJobs(state.jobs).map(r => ({ ...r, at: typeof r.at === 'number' && r.at < 1e12 ? r.at * 1000 : r.at }));
  const local = readLog().filter(r => r.own).map(r => ({ ...r, kind: 'you' }));
  return [...fromJobs, ...local].sort((a, b) => (b.at || 0) - (a.at || 0));
}

export const needsServer = (label, gap) => html`<span class="meta">${label} <span class="mono">(${gap})</span></span>`;
