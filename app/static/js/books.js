// Books derived from jobs. The server has no book entity yet (GAPS G-008, G-047):
// a book is the latest job for a canonical source path. Pure; no DOM access.

import { folderName, stripAudioExt, sortTitle, toMillis } from './format.js';
import { reportOf, toStatus, mp3State, epubState, isAttention, STATUS, STATUS_ORDER } from './status.js';

const list = value => (Array.isArray(value) ? value : value ? [value] : []);
const names = value => list(value).map(v => (typeof v === 'string' ? v : v?.name || '')).filter(Boolean).join(', ');

export function bookFromJob(job) {
  const report = reportOf(job);
  const edition = report.edition || {};
  const identity = report.identity || {};
  const answer = job.review_answer || {};
  // DESIGN-GAP: G-007 — series is read if the server ever provides it; today it never does.
  const series = edition.series?.name || report.series?.name || null;
  const seriesPos = edition.series?.position ?? report.series?.position ?? null;
  const title = edition.title || identity.title || answer.title || stripAudioExt(folderName(job.path)) || 'Untitled';
  return {
    id: job.id,
    path: job.path,
    title,
    author: names(edition.authors) || identity.author || answer.author || '',
    narrators: names(edition.narrators) || identity.narrator || answer.narrator || '',
    series,
    seriesPos: seriesPos == null || seriesPos === '' ? null : String(seriesPos),
    asin: edition.asin || report.selected_recording?.asin || identity.asin || answer.asin || '',
    region: (report.selected_recording?.region || answer.region || job.options?.region || '').toUpperCase(),
    coverUrl: edition.cover_url || null,
    status: toStatus(job),
    mp3: mp3State(job),
    epub: epubState(job),
    updatedAt: toMillis(job.updated_at || job.created_at),
    createdAt: toMillis(job.created_at),
    job,
  };
}

/** Latest job per path, newest first. */
export function deriveLibrary(jobs) {
  const latest = new Map();
  for (const job of jobs || []) {
    if (!job?.id || !job.path) continue;
    const seen = latest.get(job.path);
    if (!seen || toMillis(job.created_at) > toMillis(seen.created_at)) latest.set(job.path, job);
  }
  const books = [];
  for (const job of latest.values()) {
    // One unexpected report shape must not take the whole library down.
    try { books.push(bookFromJob(job)); } catch (error) { console.error(`Couldn't read job ${job.id}`, error); }
  }
  return books.sort((a, b) => b.updatedAt - a.updatedAt);
}

export const FILTERS = [
  ['all', 'All'],
  ['attention', 'Needs attention'],
  ['converting', 'Converting'],
  ['verified', 'Verified'],
  ['optimized', 'Optimized'],
];

export function passes(book, filter) {
  if (!filter || filter === 'all') return true;
  if (filter === 'attention') return isAttention(book.status.key);
  return book.status.key === filter;
}

export const countFor = (books, filter) => books.filter(b => passes(b, filter)).length;

const seriesNumber = b => {
  const n = parseFloat(b.seriesPos);
  return Number.isFinite(n) ? n : Infinity;
};

export const SORTS = {
  series: (a, b) => (a.series || '￿').localeCompare(b.series || '￿') || seriesNumber(a) - seriesNumber(b)
    || sortTitle(a.title).localeCompare(sortTitle(b.title)),
  recent: (a, b) => b.updatedAt - a.updatedAt,
  title: (a, b) => sortTitle(a.title).localeCompare(sortTitle(b.title)),
  author: (a, b) => (a.author || '￿').localeCompare(b.author || '￿') || sortTitle(a.title).localeCompare(sortTitle(b.title)),
};

export const sortBooks = (books, sort) => books.slice().sort(SORTS[sort] || SORTS.recent);

export const STANDALONE = 'Standalone';
export const UNKNOWN_AUTHOR = 'Unknown author';

function groupKey(book, group) {
  if (group === 'series') return book.series || STANDALONE;
  if (group === 'author') return book.author || UNKNOWN_AUTHOR;
  if (group === 'status') return book.status.label;
  return 'All books';
}

/** → [{ key, title, items, attention, optimized, sub }] in display order. */
export function groupBooks(books, group) {
  const groups = new Map();
  for (const book of books) {
    const key = groupKey(book, group);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(book);
  }
  const statusRank = label => STATUS_ORDER.findIndex(k => STATUS[k].label === label);
  const last = new Set([STANDALONE, UNKNOWN_AUTHOR]);
  const keys = [...groups.keys()].sort((a, b) => {
    if (group === 'status') return statusRank(a) - statusRank(b);
    if (last.has(a) !== last.has(b)) return last.has(a) ? 1 : -1;
    return sortTitle(a).localeCompare(sortTitle(b));
  });
  return keys.map(key => {
    const items = groups.get(key);
    const attention = items.filter(b => isAttention(b.status.key)).length;
    const optimized = items.filter(b => b.status.key === 'optimized').length;
    const bits = [];
    if (group === 'series' && key !== STANDALONE && items[0].author) bits.push(items[0].author);
    if (attention) bits.push(`${attention} need${attention === 1 ? 's' : ''} attention`);
    if (optimized) bits.push(`${optimized} optimized`);
    return { key, title: key, items, attention, optimized, sub: bits.join(' · ') };
  });
}

export const hasSeriesData = books => books.some(b => b.series);

/** Where a book opens, by status (DESIGN.md §8 Search, SCREENS.md Library). */
export function routeFor(book) {
  const key = book.status?.key;
  if (key === 'review') return `#/review/${encodeURIComponent(book.id)}`;
  if (key === 'verified' || key === 'optimized') return `#/books/${encodeURIComponent(book.id)}`;
  return `#/queue?job=${encodeURIComponent(book.id)}`;
}

/** Big faint numeral on generated covers: series number, else first letter of the title. */
export const coverMark = book => book.seriesPos || sortTitle(book.title).charAt(0).toUpperCase() || '·';

// Muted cover placeholder colours (DESIGN.md §8 Cover). Cover code is the only
// place raw hex values are allowed (RULES.md).
const COVER_COLORS = ['#3E4A61', '#7A3B2E', '#56613C', '#5B3F6B', '#8A5A2B', '#6B2F45', '#35505E', '#9A4A1F',
  '#4B2E3F', '#3C4A5C', '#5A4632', '#6A4B5E', '#445A48', '#6B5238', '#2F3D57', '#51402F', '#3A4A3A', '#27465A',
  '#6B4A2A', '#4F2F2F'];

export function coverColor(seed) {
  let h = 2166136261;
  for (const ch of String(seed || '')) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return COVER_COLORS[(h >>> 0) % COVER_COLORS.length];
}
