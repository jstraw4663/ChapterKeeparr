// 15-second spot checks (DESIGN.md §7, §8 ChapterRow). Not a media player.
// Book chapters stream from the verified M4B with a short-lived ticket;
// Needs review checks play the server's saved excerpt for that boundary (G-012).

import { api } from './api.js';

export const SPOT_SECONDS = 15;

const player = typeof Audio === 'function' ? new Audio() : null;
if (player) player.preload = 'metadata';
const listeners = new Set();
const tickets = new Map(); // jobId → { url, expires }
let now = null;            // { key, label, from, until, jobId, full }
let stopTimer = 0;
let blobUrl = '';
let generation = 0;

export const current = () => now;
export const onPlayer = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach(fn => fn(now));

export function stop() {
  generation++;
  clearTimeout(stopTimer);
  if (player) player.pause();
  if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = ''; }
  if (now) { now = null; emit(); }
}

async function ticketUrl(jobId) {
  const cached = tickets.get(jobId);
  if (cached && cached.expires - Date.now() > 30_000) return cached.url;
  const t = await api.mediaTicket(jobId);
  const url = api.audioUrl(jobId, t.token);
  tickets.set(jobId, { url, expires: Date.now() + (t.expires_in || 300) * 1000 });
  return url;
}

function seekAndPlay(from, gen) {
  return new Promise((resolve, reject) => {
    const go = () => {
      if (gen !== generation) return resolve();
      try { player.currentTime = from; } catch { /* seek after metadata */ }
      player.play().then(resolve, reject);
    };
    if (player.readyState >= 1) go();
    else player.addEventListener('loadedmetadata', go, { once: true });
  });
}

/** Chapter spot check from the verified M4B. `end` bounds "play to chapter end" (G-048). */
export async function playChapter({ key, jobId, label, start, end }) {
  if (now?.key === key) { stop(); return; }
  stop();
  const gen = generation;
  now = { key, label, from: start, until: Math.min(end ?? Infinity, start + SPOT_SECONDS), chapterEnd: end ?? null, jobId, full: false, startedAt: Date.now() };
  emit();
  try {
    const url = await ticketUrl(jobId);
    if (gen !== generation) return;
    if (player.getAttribute('src') !== url) player.src = url;
    await seekAndPlay(start, gen);
    if (gen !== generation) return;
    stopTimer = setTimeout(() => { if (gen === generation) stop(); }, SPOT_SECONDS * 1000);
  } catch (error) {
    if (gen === generation) { stop(); throw error; }
  }
}

/** DESIGN-GAP: G-048 — keep the pre-redesign full-chapter playback until Jeremy decides. */
export function continueToChapterEnd() {
  if (!now || now.full || now.chapterEnd == null) return;
  clearTimeout(stopTimer);
  now = { ...now, full: true, until: now.chapterEnd };
  emit();
}

/** Needs review check: the saved boundary excerpt (starts ~2 s before the boundary). */
export async function playExcerpt({ key, jobId, label, excerpt }) {
  if (now?.key === key) { stop(); return; }
  stop();
  const gen = generation;
  now = { key, label, from: 0, until: SPOT_SECONDS, jobId, full: false, startedAt: Date.now(), excerpt: true };
  emit();
  try {
    const blob = await api.artifactBlob(jobId, excerpt);
    if (gen !== generation) return;
    blobUrl = URL.createObjectURL(blob);
    player.src = blobUrl;
    await seekAndPlay(0, gen);
    stopTimer = setTimeout(() => { if (gen === generation) stop(); }, SPOT_SECONDS * 1000);
  } catch (error) {
    if (gen === generation) { stop(); throw error; }
  }
}

if (player) {
  player.addEventListener('timeupdate', () => { if (now && now.full && player.currentTime >= now.until) stop(); });
  player.addEventListener('ended', stop);
  player.addEventListener('error', () => { if (now) stop(); });
}
