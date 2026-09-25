// Book (SCREENS.md → Book). Primary action depends on state: Clean up source
// MP3s while they remain (G-015), otherwise Open in BookOrbit (G-021).
// Audio is 15-second spot checks only (G-048 keeps an opt-in to the chapter end).

import { html, clock, shortDate, bool } from '../format.js';
import { icon } from '../icons.js';
import { api, needsServer } from '../api.js';
import { state, bookById, touch } from '../store.js';
import { reportOf } from '../status.js';
import { cover, button, iconButton, collapsible, checklistRow, kv, historyList, statusPill, spotButton, field, selectField, REGIONS, regionName, skeletonRows, emptyState } from '../ui.js';
import { open as openOverlay, head, actionSheet, confirmSheet, isPhone } from '../overlay.js';
import { notify } from '../notify.js';
import { ownAction } from '../events.js';
import { historyFor } from '../history.js';
import { readLog } from '../prefs.js';
import * as audio from '../audio.js';
import { checksOf, checkTimeline, gatesDetail, playCheck, durationOf } from './evidence.js';
import { serverButton, reportError, retryJob } from './common.js';

const chapters = new Map(); // jobId → { list, error, loading, updated }
const SHOW = 11;

function loadChapters(book, ctx) {
  const entry = chapters.get(book.id);
  if (entry && entry.updated === book.updatedAt) return entry;
  const next = { list: null, error: '', loading: true, updated: book.updatedAt };
  chapters.set(book.id, next);
  api.chapters(book.id)
    .then(data => { next.list = data.chapters || []; next.duration = data.duration_seconds; })
    .catch(error => { next.error = error.message; })
    .finally(() => { next.loading = false; ctx.rerender(); });
  return next;
}

function facts(book) {
  const report = reportOf(book.job);
  const rows = checksOf(book.job);
  const passed = rows.filter(r => r.passed).length;
  const saved = book.job.finished_at ? shortDate(book.job.finished_at) : '';
  return { report, rows, passed, saved };
}

function statusCard(book, ctx) {
  const { report, rows, passed, saved } = facts(book);
  const optimized = book.status.key === 'optimized';
  const mp3 = book.mp3;
  const epub = book.epub === 'paired';
  const items = [
    { done: true, label: 'M4B verified', note: saved },
    { done: rows.length > 0 && passed === rows.length, label: 'Chapters aligned', note: rows.length ? `${passed} of ${rows.length} checks` : '—' },
    { done: epub, label: 'EPUB paired', note: epub ? 'Same folder' : 'Not found next to the M4B' },
    { done: mp3 === 'removed' || mp3 === 'none', label: 'Source MP3s removed', note: { removed: `${report.mp3s_deleted} removed`, none: 'No MP3s involved', present: 'Still on disk', unknown: '—' }[mp3] },
  ];
  const remaining = items.filter(i => !i.done).length;
  const title = report.recovery_acceptance ? 'Finalized with accepted exceptions' : optimized ? 'Optimized' : `Verified · ${remaining} ${remaining === 1 ? 'step' : 'steps'} from optimized`;
  const sub = optimized ? 'One verified M4B and one EPUB, paired, with source MP3s removed.' : report.recovery_acceptance ? 'Some sections were accepted as exceptions; see Details.' : 'The goal is one verified M4B and one EPUB, paired, with source MP3s removed.';
  const now = audio.current();
  const evOpen = ctx.ui.open?.evidence ?? false;
  const evidence = rows.length ? html`
    ${checkTimeline(rows, durationOf(book.job, chapters.get(book.id)?.duration), { small: true, label: 'Checked chapters across the book' })}
    <h3 class="ghh"><button type="button" class="gh top-line" data-act="toggle" data-arg="evidence" aria-expanded="${bool(evOpen)}" aria-controls="evidence-body"><span class="chev">${icon('chevronRight', 18, { stroke: 2 })}</span><span style="font-size:14px;font-weight:650">Chapter check evidence</span><span class="summary">${passed} of ${rows.length}</span></button></h3>
    <div id="evidence-body" ${evOpen ? '' : 'hidden'}>${rows.map(r => html`<div class="row gap12" style="min-height:52px;border-top:1px solid var(--line)"><span class="ldot ${r.passed ? 'ok' : 'warn'}" style="width:22px;height:22px">${icon(r.passed ? 'check' : 'warn', 12, { stroke: 2.4 })}</span><span class="grow ell" style="font-size:14px;font-weight:650">${r.name}</span><span class="meta tabular">${r.seconds != null ? clock(r.seconds) : '—'}</span>${spotButton({ playing: now?.key === `chk:${book.id}:${r.n}`, label: r.name, act: 'evidence-play', arg: r.n, disabled: !r.excerpt, disabledReason: 'No saved audio for this check' })}</div>`)}</div>` : html`<p class="meta" style="padding:6px 0 12px">No chapter check evidence was recorded for this book.</p>`;
  return html`<section class="panel col gap8" style="padding:20px 22px 10px" aria-label="Status">
    <div class="row gap12"><span class="circ tone-ok" style="width:38px;height:38px">${icon('check', 20, { stroke: 2.2 })}</span><div class="col gap4"><span style="font-size:16px;font-weight:750">${title}</span><span class="meta">${sub}</span></div></div>
    <div class="col">${items.map(checklistRow)}</div>
    ${evidence}</section>`;
}

function chaptersPanel(book, ctx) {
  const entry = loadChapters(book, ctx);
  const filter = (ctx.ui.chf || '').trim().toLowerCase();
  const now = audio.current();
  let body;
  if (entry.loading) body = skeletonRows(6, 48);
  else if (entry.error) body = html`<p class="gapnote">${entry.error}</p>`;
  else if (!entry.list.length) body = html`<p class="gapnote">This file has no embedded chapters.</p>`;
  else {
    const all = entry.list.map((c, i) => ({ ...c, i, name: c.title || `Untitled chapter ${i + 1}` }));
    const matched = filter ? all.filter(c => c.name.toLowerCase().includes(filter)) : all;
    const shown = filter || ctx.ui.allChapters ? matched : matched.slice(0, SHOW);
    body = html`<div class="col">${shown.map(c => {
      const key = `ch:${book.id}:${c.i}`;
      const playing = now?.key === key;
      return html`<div class="chrow ${playing ? 'on' : ''}">${spotButton({ playing, label: c.name, act: 'chapter-play', arg: c.i })}<span class="name ell">${c.name}</span><time>${clock(c.start_seconds)}</time></div>`;
    })}${!shown.length ? html`<p class="meta" style="padding:12px 6px">No chapter matches “${ctx.ui.chf}”.</p>` : ''}</div>
    ${!filter && !ctx.ui.allChapters && all.length > SHOW ? button({ label: `Show all ${all.length} chapters`, act: 'all-chapters', block: true, cls: 'mt10' }) : ''}`;
  }
  const count = entry.list?.length;
  const search = html`<div class="inputwrap pill" style="${ctx.phone ? 'margin-bottom:6px;width:100%' : 'width:220px'}"><label for="ch-filter" class="sr">Find a chapter</label><span class="icon">${icon('search', 16)}</span><input id="ch-filter" class="input" type="search" placeholder="Find a chapter" value="${ctx.ui.chf || ''}" autocomplete="off"></div>`;
  if (ctx.phone) {
    return collapsible({ id: 'chapters', title: 'Chapters', summary: count ? `${count} · tap for 15s check` : '', open: ctx.ui.open?.chapters ?? true, body: html`${search}${body}` });
  }
  return html`<section class="panel col gap12" style="padding:20px 22px 14px" aria-labelledby="chapters-title">
    <div class="row" style="justify-content:space-between;gap:16px"><div class="col gap4"><h2 class="h3" id="chapters-title">Chapters ${count != null ? html`<span class="muted" style="font-weight:600">${count}</span>` : ''}</h2><span class="meta">Tap play for a 15-second spot check</span></div>${search}</div>
    ${body}</section>`;
}

function filesPanel(book, ctx) {
  const report = reportOf(book.job);
  const m4b = report.output || book.path;
  const mp3Line = { removed: `${report.mp3s_deleted} source MP3s were removed after verification.`, none: 'This book started from an M4B; no MP3s were involved.', present: 'Source MP3s are still next to the M4B.', unknown: '—' }[book.mp3];
  const body = html`<div class="col gap12" style="padding-bottom:12px">
    <div class="filepath"><span class="k">M4B</span><span class="v">${m4b}</span>${iconButton({ icon: ctx.ui.copied ? 'check' : 'copy', label: 'Copy file path', act: 'copy' })}</div>
    <div class="filepath"><span class="k">EPUB</span><span class="v">${report.epub?.path || '—'}</span></div>
    <div class="filepath"><span class="k">MP3s</span><span class="meta" style="font-size:13px">${mp3Line}</span></div></div>`;
  return collapsible({ id: 'files', title: 'Files', open: ctx.ui.open?.files ?? !ctx.phone, body });
}

function detailsPanel(book, ctx) {
  const { report, rows } = facts(book);
  const acc = report.recovery_acceptance;
  const body = html`<div class="col gap16" style="padding:4px 0 14px">${kv([
    ['ASIN', book.asin],
    ['Narrator', book.narrators],
    ['Series', book.series ? `${book.series}${book.seriesPos ? ` · Book ${book.seriesPos}` : ''}` : null],
    ['Region', regionName(book.region)],
    ['Edition match', report.alignment?.matching_boundaries != null ? `${report.alignment.matching_boundaries} matching boundaries` : null],
    ['Chapter checks', book.job.options?.verify_all ? 'Every chapter' : rows.length ? 'Spot checks' : null],
    ['Attempts', book.job.attempts],
    ...(acc ? [['Accepted exceptions', `${Number(acc.supported_percent).toFixed(1)}% identified · ${acc.minimum_percent}% required · ${(acc.sections || []).map(s => s.title).join(', ') || 'no sections'}`]] : []),
  ])}
  <details class="tech"><summary>Checks the server ran</summary><div style="margin-top:10px">${gatesDetail(book.job)}</div></details>
  <div>${serverButton({ label: 'Download report (JSON)', icon: 'download', act: 'report', size: 'md' })}</div></div>`;
  return collapsible({ id: 'details', title: 'Details', open: ctx.ui.open?.details ?? false, body });
}

function historyPanel(book, ctx) {
  const entries = historyFor(book.job, readLog());
  return collapsible({ id: 'history', title: 'History', summary: ctx.phone ? '' : `${entries.length} ${entries.length === 1 ? 'event' : 'events'}`, open: ctx.ui.open?.history ?? !ctx.phone, body: historyList(entries) });
}

function actionsRow(book, ctx) {
  const mp3Present = book.mp3 === 'present';
  const bookOrbit = api.bookOrbitLink(book); // DESIGN-GAP: G-021
  const clean = serverButton({ label: ctx.phone ? 'Clean up MP3s' : 'Clean up source MP3s', kind: 'primary', icon: 'trash', act: 'ask-clean', size: ctx.phone ? 'lg' : '', cls: ctx.phone ? 'grow' : '' });
  const orbitPrimary = button({ label: 'Open in BookOrbit', kind: 'primary', iconEnd: 'external', disabled: true, disabledReason: bookOrbit.message, size: ctx.phone ? 'lg' : '', cls: ctx.phone ? 'grow' : '' });
  const orbitGhost = button({ label: 'Open in BookOrbit', iconEnd: 'external', disabled: true, disabledReason: bookOrbit.message });
  const confirm = ctx.ui.askClean ? html`<div class="confirm opened"><span>Delete the source MP3s? The verified M4B stays.</span>${button({ label: 'Keep', act: 'keep-mp3', size: 'md' })}${serverButton({ label: 'Delete MP3s', kind: 'danger', act: 'confirm-clean', size: 'md' })}</div>` : '';
  if (ctx.phone) {
    return html`<div class="row gap8">${mp3Present ? clean : orbitPrimary}${iconButton({ icon: 'refresh', label: 'Re-verify', act: 'reverify', cls: 'icb lg' })}${mp3Present ? iconButton({ icon: 'external', label: 'Open in BookOrbit', cls: 'icb lg', disabled: true, disabledReason: bookOrbit.message }) : ''}</div>${confirm}`;
  }
  return html`<div class="row gap8 wrap" style="margin-top:6px">${mp3Present ? html`${clean}${orbitGhost}` : orbitPrimary}${serverButton({ label: 'Re-verify', icon: 'refresh', act: 'reverify' })}${button({ label: 'Edit details', icon: 'edit', act: 'edit' })}</div>${confirm}`;
}

function openEdit(book) {
  const report = reportOf(book.job);
  openOverlay({
    label: 'Edit details',
    render: ({ asSheet }) => {
      const save = button({ label: 'Save changes', kind: 'primary', disabled: true, disabledReason: needsServer('G-018') });
      const fields = html`<div class="formgrid">
        ${field({ id: 'ed-title', label: 'Title', value: book.title, cls: 'span2' })}
        ${field({ id: 'ed-author', label: 'Author', value: book.author })}
        ${field({ id: 'ed-narr', label: 'Narrators', value: book.narrators })}
        ${field({ id: 'ed-series', label: 'Series', value: book.series || '' })}
        ${field({ id: 'ed-sn', label: 'Book number', value: book.seriesPos || '', extra: { inputmode: 'decimal' } })}
        ${field({ id: 'ed-asin', label: 'ASIN', value: book.asin })}
        ${selectField({ id: 'ed-region', label: 'Region', options: REGIONS, value: (report.selected_recording?.region || 'us').toLowerCase() })}</div>
        <p class="meta" style="margin-top:16px">Changing the ASIN or region re-verifies the book. For covers, descriptions and everything else, edit in BookOrbit.</p>
        <p class="gapnote" style="margin-top:12px">Saving edits needs server support, so changes can’t be saved yet. <span class="mono">(G-018)</span></p>`;
      if (asSheet) return html`${head('Edit details', true, { center: true, left: html`<button type="button" class="plain" data-act="overlay-close">Cancel</button>`, right: html`<button type="button" class="plain strong" disabled title="${needsServer('G-018')}" style="opacity:.4">Save</button>` })}${fields}`;
      return html`${head('Edit details', false)}${fields}<div class="modal-foot">${button({ label: 'Cancel', act: 'overlay-close' })}${save}</div>`;
    },
  });
}

async function copyPath(book, ctx) {
  const path = reportOf(book.job).output || book.path;
  try {
    await navigator.clipboard.writeText(path);
    ctx.ui.copied = true; ctx.rerender();
    notify(ownAction('File path copied', path, book.id));
    setTimeout(() => { ctx.ui.copied = false; ctx.rerender(); }, 2000);
  } catch { reportError(new Error('Copying isn’t allowed here. Select the path to copy it.')); }
}

async function downloadReport(book) {
  try {
    const report = await api.report(book.id);
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'chapterkeeparr-report.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) { reportError(error, 'Couldn’t download the report'); }
}

const bookOf = ctx => bookById(ctx.route.id);

async function cleanUp(ctx) {
  const result = await api.cleanupSources(bookOf(ctx)?.id); // DESIGN-GAP: G-015
  if (result?.available === false) reportError(new Error(`${result.message} (${result.gap})`), 'Source MP3s were not removed');
}

export default {
  title: ctx => bookOf(ctx)?.title || 'Book',

  /** Start the chapter request as soon as a link to this book is pressed. */
  prefetch(route) {
    const book = route.id && bookById(route.id);
    if (book) loadChapters(book, { rerender: () => touch() });
  },
  topbar: true,
  detail: true,

  signature(ctx) {
    const b = bookOf(ctx);
    const c = b && chapters.get(b.id);
    return [state.loaded, state.sig, ctx.route.id, JSON.stringify(ctx.ui), c && `${c.loading}${c.error}${c.list?.length}`, audio.current()?.key].join('|');
  },

  render(ctx) {
    const { phone, enter } = ctx;
    const book = bookOf(ctx);
    if (!state.loaded) return skeletonRows(6, 64);
    if (!book) return html`<div class="${phone ? 'page-inset' : ''}">${emptyState({ title: 'This book isn’t in the library', body: 'It may have been replaced by a newer job.', action: button({ label: 'Library', href: '#/' }) })}</div>`;
    if (!['verified', 'optimized'].includes(book.status.key)) {
      return html`<div class="${phone ? 'page-inset' : ''}">${emptyState({ title: `${book.title} isn’t verified yet`, body: book.status.detail, action: button({ label: book.status.key === 'review' ? 'Review it' : 'Open in Queue', href: book.status.key === 'review' ? `#/review/${encodeURIComponent(book.id)}` : `#/queue?job=${encodeURIComponent(book.id)}` }) })}</div>`;
    }
    const { rows, passed, saved } = facts(book);
    const chapterCount = chapters.get(book.id)?.list?.length;
    const line = [chapterCount != null ? `${chapterCount} chapters` : '', rows.length ? `${passed} of ${rows.length} checks passed` : '', saved ? `Saved ${saved}` : ''].filter(Boolean).join(' · ');
    const eyebrow = book.series ? `${book.series}${book.seriesPos ? ` · Book ${book.seriesPos}` : ''}` : book.author || '';
    if (phone) {
      return html`<div class="back-head"><a class="textlink" href="#/" style="color:var(--ink);font-size:16px">${icon('chevronLeft', 22)}Library</a><div class="row" style="gap:0">${iconButton({ icon: 'edit', label: 'Edit details', act: 'edit', cls: 'picon' })}<button type="button" class="picon" data-act="more" aria-label="More actions" aria-haspopup="dialog">${icon('more', 22)}</button></div></div>
        <section class="col gap12 page-pad ${enter ? 'rise' : ''}">
          <div class="bookhero">${cover(book, { size: 128, radius: 16, cls: 'shadow' })}<div class="col gap4"><span class="eyebrow" style="font-size:11px">${eyebrow}</span><h1 tabindex="-1" data-vt-title="${book.id}">${book.title}</h1><span class="meta" style="font-size:14px">${book.author}</span></div></div>
          <div class="row gap8 wrap">${statusPill(book.status)}<span class="meta">${[chapterCount != null ? `${chapterCount} chapters` : '', rows.length ? `${passed}/${rows.length} checks` : ''].filter(Boolean).join(' · ')}</span></div>
          ${actionsRow(book, ctx)}</section>
        <div class="page-inset">${chaptersPanel(book, ctx)}</div>
        <div class="page-inset col gap12">${statusCard(book, ctx)}${filesPanel(book, ctx)}${historyPanel(book, ctx)}${detailsPanel(book, ctx)}</div>`;
    }
    return html`<a class="textlink" href="#/" style="align-self:flex-start;margin-bottom:-8px">${icon('chevronLeft', 18)}Library</a>
      <section class="bookhero ${enter ? 'rise' : ''}">${cover(book, { size: 220, radius: 16, cls: 'shadow' })}<div class="col gap12 grow"><span class="eyebrow">${eyebrow}</span><h1 tabindex="-1" data-vt-title="${book.id}">${book.title}</h1><p class="lede">${book.author}${book.narrators ? ` · Narrated by ${book.narrators}` : ''}</p><div class="row gap12 wrap">${statusPill(book.status)}<span class="meta" style="font-size:14px">${line}</span></div>${actionsRow(book, ctx)}</div></section>
      <div class="twocol"><div class="${enter ? 'rise' : ''}" style="animation-delay:.08s">${chaptersPanel(book, ctx)}</div>
        <div class="col gap16 ${enter ? 'rise' : ''}" style="animation-delay:.14s">${statusCard(book, ctx)}${filesPanel(book, ctx)}${historyPanel(book, ctx)}${detailsPanel(book, ctx)}</div></div>`;
  },

  onInput(el, ev, ctx) {
    if (el.id === 'ch-filter') { ctx.ui.chf = el.value; ctx.rerender(); }
  },

  actions: {
    'chapter-play': (el, ev, ctx) => {
      const book = bookOf(ctx);
      const entry = chapters.get(book?.id);
      const c = entry?.list?.[Number(el.dataset.arg)];
      if (!c) return;
      audio.playChapter({ key: `ch:${book.id}:${el.dataset.arg}`, jobId: book.id, label: c.title || `Chapter ${Number(el.dataset.arg) + 1}`, start: c.start_seconds, end: c.end_seconds })
        .catch(error => reportError(error, 'Couldn’t play this chapter'));
    },
    'evidence-play': (el, ev, ctx) => { const book = bookOf(ctx); if (book) playCheck(book.job, el.dataset.arg, checksOf(book.job)).catch(error => reportError(error, 'Couldn’t play this check')); },
    'all-chapters': (el, ev, ctx) => { ctx.ui.allChapters = true; ctx.rerender(); },
    'ask-clean': async (el, ev, ctx) => {
      if (!isPhone()) { ctx.ui.askClean = true; ctx.rerender(); return; }
      const ok = await confirmSheet({ title: 'Delete the source MP3s?', body: 'The verified M4B stays.', confirmLabel: 'Delete MP3s', keepLabel: 'Keep them' });
      if (ok) cleanUp(ctx);
    },
    'keep-mp3': (el, ev, ctx) => { ctx.ui.askClean = false; ctx.rerender(); },
    'confirm-clean': (el, ev, ctx) => { ctx.ui.askClean = false; ctx.rerender(); cleanUp(ctx); },
    reverify: (el, ev, ctx) => {
      const book = bookOf(ctx); if (!book) return;
      // DESIGN-GAP: G-019 — retry without force may end as "Unchanged" when nothing changed.
      retryJob(book.id);
    },
    edit: (el, ev, ctx) => { const book = bookOf(ctx); if (book) openEdit(book); },
    copy: (el, ev, ctx) => { const book = bookOf(ctx); if (book) copyPath(book, ctx); },
    report: (el, ev, ctx) => { const book = bookOf(ctx); if (book) downloadReport(book); },
    more: (el, ev, ctx) => {
      const book = bookOf(ctx); if (!book) return;
      const orbit = api.bookOrbitLink(book);
      actionSheet('Book actions', [
        { label: 'Re-verify', icon: 'refresh', onSelect: () => retryJob(book.id) },
        { label: 'Edit details', icon: 'edit', onSelect: () => openEdit(book) },
        { label: 'Open in BookOrbit', icon: 'external', disabled: true, reason: orbit.message },
        { label: 'Copy file path', icon: 'copy', onSelect: () => copyPath(book, ctx) },
        { label: 'Download report', icon: 'download', onSelect: () => downloadReport(book) },
        ...(book.mp3 === 'present' ? [{ label: 'Clean up source MP3s', icon: 'trash', danger: true, onSelect: async () => { if (await confirmSheet({ title: 'Delete the source MP3s?', body: 'The verified M4B stays.', confirmLabel: 'Delete MP3s', keepLabel: 'Keep them' })) cleanUp(ctx); } }] : []),
      ]);
    },
  },
};

