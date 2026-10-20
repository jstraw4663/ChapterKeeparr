// App state, polling and change events. No push channel exists yet
// (DESIGN-GAP: G-003), so status changes come from diffing polls.

import { resourceCache } from './resource-cache.js';
import { api } from './api.js';
import { deriveLibrary } from './books.js';
import { isActive } from './status.js';
import { diffJobs, snapshot } from './events.js';

const FAST = 3000, SLOW = 10000, OFFLINE = 10000;

export const state = {
  jobs: [],
  books: [],
  byId: new Map(),
  loaded: false,
  connected: null,        // null = not checked yet
  lastError: '',
  authNeeded: false,       // the server rejected our token (401)
  lastSync: 0,
  settings: null,
  suggestions: null,      // filled by the Suggestions screen (partial, G-020)
  frontendUpdate: false,   // waiting installed shell; never an automatic reload
  capped: false,
  sig: '',                // changes whenever any book's visible state changes
};

const listeners = new Set();
const eventListeners = new Set();
let previous = null;
let timer = 0;
let inflight = null;
let followup = false;
const expected = new Map(); // jobId → status key caused by the user's own action

export const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };
export const onEvents = fn => { eventListeners.add(fn); return () => eventListeners.delete(fn); };
const emit = () => listeners.forEach(fn => { try { fn(state); } catch (error) { console.error(error); } });
/** Re-announce state after a screen changes shared state (e.g. the suggestions count). */
export const touch = () => emit();
export function setFrontendUpdate(ready) {
  if (state.frontendUpdate === ready) return;
  state.frontendUpdate = ready; emit();
}

export function counts() {
  let review = 0, active = 0, converting = null;
  for (const book of state.books) {
    const key = book.status.key;
    if (key === 'review') review++;
    if (isActive(key)) active++;
    if (key === 'converting' && !converting) converting = book;
  }
  return { review, active, converting, suggestions: state.suggestions?.openCount ?? null };
}

export const bookById = id => state.byId.get(id) || null;

/** Tell the diff not to announce a transition the user just caused. */
export function expect(jobId, key) {
  expected.set(jobId, key);
  setTimeout(() => { if (expected.get(jobId) === key) expected.delete(jobId); }, 60_000);
}

function apply(jobs) {
  state.jobs = jobs;
  state.books = deriveLibrary(jobs);
  state.byId = new Map(state.books.map(b => [b.id, b]));
  // Old job ids stay addressable even when a newer job replaced them in the library.
  for (const job of jobs) if (!state.byId.has(job.id)) state.byId.set(job.id, deriveLibrary([job])[0]);
  state.capped = jobs.length >= 1000;
  let h = 0;
  for (const b of state.books) {
    const part = `${b.id}:${b.status.key}:${b.status.pct ?? ''}:${b.updatedAt};`;
    for (let i = 0; i < part.length; i++) h = (Math.imul(h, 31) + part.charCodeAt(i)) | 0;
  }
  state.sig = `${state.books.length}:${h}`;
}

/** A mutation can require one fresh read after an already-started poll. */
export function refresh({ fresh = false } = {}) {
  if (inflight) { if (fresh) followup = true; return inflight; }
  clearTimeout(timer);
  inflight = (async () => {
    do {
      followup = false;
      try {
        const jobs = await api.listJobs(1000);
        if (followup) continue; // A known pre-mutation response must not flash back.
        const events = diffJobs(previous, jobs, expected);
        for (const event of events) if (expected.get(event.jobId)) expected.delete(event.jobId);
        previous = snapshot(jobs);
        apply(jobs);
        state.loaded = true; state.connected = true; state.lastError = ''; state.authNeeded = false; state.lastSync = Date.now();
        emit();
        if (events.length) eventListeners.forEach(fn => fn(events));
      } catch (error) {
        if (followup) continue;
        state.connected = error.offline ? false : state.connected ?? true;
        state.lastError = error.message;
        state.authNeeded = error.status === 401;
        if (!error.offline) state.loaded = true;
        emit();
      }
    } while (followup);
  })().finally(() => {
    inflight = null;
    const busy = state.books.some(b => b.status.key === 'converting' || b.status.key === 'queued');
    timer = setTimeout(refresh, document.hidden ? 60_000 : state.connected === false ? OFFLINE : busy ? FAST : SLOW);
  });
  return inflight;
}

let settingsPending = null;
export function loadSettings() {
  if (settingsPending) return settingsPending;
  const previous = state.settings;
  settingsPending = api.settings().then(value => {
    // A completed settings save owns its newer value over this earlier read.
    if (state.settings === previous) { state.settings = value; emit(); }
    return state.settings;
  }).catch(() => state.settings).finally(() => { settingsPending = null; });
  return settingsPending;
}

/** Read once per job version; pointer prefetch and the screen share the work. */
const detailCache = resourceCache((jobId, options) => api.job(jobId, options));
export function jobDetail(jobId, { force = false } = {}) {
  return detailCache.read(jobId, state.byId.get(jobId)?.job.updated_at, { force }).promise;
}

export const isOffline = () => state.connected === false || (typeof navigator !== 'undefined' && navigator.onLine === false);

export function start() {
  refresh();
  loadSettings();
  window.addEventListener('online', () => refresh());
  window.addEventListener('offline', () => { state.connected = false; emit(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
}
