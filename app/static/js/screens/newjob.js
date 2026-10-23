// New job (SCREENS.md → New job). Primary action: Start job.
// Everything is a server path; nothing is uploaded from this device.

import { html, folderName, plural } from '../format.js';
import { icon } from '../icons.js';
import { api, needsServer } from '../api.js';
import { state, refresh, expect } from '../store.js';
import { getPrefs } from '../prefs.js';
import { button, collapsible, field, selectField, segmented, settingRow, toggle, REGIONS, gapNote } from '../ui.js';
import { open as openOverlay, head } from '../overlay.js';
import { notify } from '../notify.js';
import { serverButton, offline } from './common.js';

const job = {
  path: '', scan: null, scanning: false, error: '', selected: new Set(), mp3s: null, hasM4b: false,
  verifyAll: null, keepMp3s: null, force: false, busy: false,
};

/** "The Lost World (Arthur Conan Doyle)" → title + author; "05. Emma" → "Emma"; author from the parent folder. */
export function guessFromPath(path) {
  const parts = String(path || '').replace(/\/+$/, '').split('/').filter(Boolean);
  const name = parts.pop() || '';
  const m = name.match(/^(.*) \((.*)\)$/);
  if (m) return { title: m[1].trim(), author: m[2].trim() };
  return { title: name.replace(/^\d+[.\s_-]+/, '').trim(), author: parts.length > 1 ? parts[parts.length - 1] : '' };
}

const defaults = () => getPrefs().jobDefaults;
const verifyAll = () => job.verifyAll ?? defaults().verify_all;
const keepMp3s = () => job.keepMp3s ?? defaults().keep_mp3s;

async function choose(path, ctx) {
  Object.assign(job, { path, scan: null, scanning: true, error: '', selected: new Set(), mp3s: null, hasM4b: false });
  ctx.rerender();
  try {
    const [scan, listing] = await Promise.all([api.discover(path), api.browse(path).catch(() => null)]);
    if (job.path !== path) return;
    job.scan = scan;
    job.selected = new Set((scan.books || []).map(b => b.path));
    const files = (listing?.entries || []).filter(e => e.type === 'file');
    job.mp3s = files.filter(f => /\.mp3$/i.test(f.name)).length;
    job.hasM4b = files.some(f => /\.m4b$/i.test(f.name));
  } catch (error) { job.error = error.message; }
  job.scanning = false;
  ctx.rerender();
}

function summary() {
  if (job.scanning) return html`<p class="meta" role="status">Looking at this folder…</p>`;
  if (job.error) return html`<p class="alert-bad" role="alert">${job.error}</p>`;
  if (!job.scan) return '';
  const books = job.scan.books || [];
  const issues = job.scan.issues || [];
  if (!books.length) return html`<p class="alert-bad" role="status">No audiobook found here. Pick a folder with at least two MP3 files or an M4B.</p>`;
  const issueList = issues.length ? html`<details class="tech"><summary>${plural(issues.length, 'layout note')}</summary><div class="techbody">${issues.map(i => (typeof i === 'string' ? i : JSON.stringify(i))).join('\n')}</div></details>` : '';
  if (books.length === 1) {
    const b = books[0];
    const text = b.kind === 'm4b' ? 'An existing M4B · its chapters will be checked' : job.mp3s ? `${plural(job.mp3s, 'MP3 file')} found · ordered by track number` : 'A folder of MP3s · ordered by track number';
    return html`<div class="okbox opened">${icon('check', 20, { stroke: 2.2 })}<span>${text}</span></div>${issueList}`;
  }
  // DESIGN-GAP: G-033 — the build can queue several books from one folder; the design shows one.
  const all = job.selected.size === books.length;
  return html`<div class="col opened"><div class="okbox">${icon('check', 20, { stroke: 2.2 })}<span>${books.length} audiobooks found in this folder</span></div>
    <label class="checkbox" style="font-weight:650"><input type="checkbox" data-pick="all" ${all ? 'checked' : ''}><span>Select all · ${job.selected.size} of ${books.length} selected</span></label>
    <div class="col" style="max-height:320px;overflow:auto;border-top:1px solid var(--line)">${books.map((b, i) => html`<label class="checkbox" style="border-bottom:1px solid var(--line)"><input type="checkbox" data-pick="${i}" ${job.selected.has(b.path) ? 'checked' : ''}><span class="col"><span style="font-weight:650">${b.name}</span><span class="meta mono wrap-any">${b.path}</span><span class="meta">${b.kind === 'm4b' ? 'Check an existing M4B' : 'Convert an MP3 folder'}</span></span></label>`)}</div>${issueList}</div>`;
}

function sourceSection(ctx) {
  const name = job.path ? folderName(job.path) : 'Choose a folder';
  const sub = job.path || 'Browse your server’s library folders';
  return html`<section class="panel pad col gap16" aria-labelledby="nj-src">
    <div class="row"><span class="stepnum">1</span><h2 class="h3" id="nj-src">Source folder</h2></div>
    <button type="button" class="pickfolder" data-act="browse"><span class="tile">${icon('folder', 20)}</span><span class="col gap4 grow"><span class="ell" style="font-size:15px;font-weight:650">${name}</span><span class="meta mono ell" style="font-size:12px">${sub}</span></span><span style="font-size:14px;font-weight:650;flex-shrink:0">Browse</span></button>
    ${summary()}
    <p class="meta">Folders are browsed on your server. Nothing is uploaded from this device.</p></section>`;
}

function editionSection(ctx) {
  const books = job.scan?.books || [];
  if (books.length > 1) return '';
  const guess = guessFromPath(job.path);
  const reason = needsServer('G-040');
  // DESIGN-GAP: G-040 — POST /api/jobs doesn't accept edition details yet.
  return html`<section class="panel pad col gap16" aria-labelledby="nj-ed">
    <div class="col gap4"><div class="row"><span class="stepnum">2</span><h2 class="h3" id="nj-ed">Edition</h2></div><p class="meta" style="font-size:14px">Filled from the folder name. The server matches the edition itself; if it can’t, the book pauses in Needs review where you can correct it.</p></div>
    <div class="formgrid">
      ${field({ id: 'nj-title', label: 'Title', value: job.path ? guess.title : '', disabled: true, disabledReason: reason })}
      ${field({ id: 'nj-author', label: 'Author', value: job.path ? guess.author : '', disabled: true, disabledReason: reason })}
      ${field({ id: 'nj-asin', label: 'ASIN (optional)', placeholder: 'Leave empty to search by title', disabled: true, disabledReason: reason })}
      ${selectField({ id: 'nj-region', label: 'Region', options: REGIONS, value: 'us', disabled: true })}
    </div>
    ${gapNote('Starting a job with edition details needs server support, so these fields are read-only for now.', 'G-040')}</section>`;
}

function optionsSection(ctx) {
  const checks = segmented({ label: 'Chapter checks', options: [['spot', 'Spot checks'], ['all', 'Every chapter']], value: verifyAll() ? 'all' : 'spot', act: 'checks' });
  const body = html`<div style="padding-bottom:6px">
    ${settingRow({ label: 'Chapter checks', desc: 'Spot checks listen at a sample of chapters. Every chapter is slower but thorough.', control: checks, stack: ctx.phone })}
    ${settingRow({ label: 'Keep source MP3s', desc: 'Off deletes them, but only after the M4B passes verification.', control: toggle({ label: 'Keep source MP3s', checked: keepMp3s(), act: 'keep' }), stack: ctx.phone })}
    ${settingRow({ label: 'Process again', desc: 'Run even if this book already has a matching verified result.', control: toggle({ label: 'Process again even if verified', checked: job.force, act: 'force' }), stack: ctx.phone })}
    ${settingRow({ label: 'Save to', desc: 'The finished M4B is saved next to the source. Choosing another folder needs server support (G-039).', control: html`<span class="val">Next to source</span>`, stack: ctx.phone })}</div>`;
  const summaryText = `${verifyAll() ? 'Every chapter' : 'Spot checks'} · ${keepMp3s() ? 'keep MP3s' : 'delete MP3s after verify'}${job.force ? ' · process again' : ''}`;
  return collapsible({ id: 'options', title: html`<span class="row" style="gap:10px"><span class="stepnum">3</span>Options</span>`, summary: summaryText, open: ctx.ui.open?.options ?? !ctx.phone, body });
}

function startLabel() {
  const n = job.selected.size;
  return n > 1 ? `Start ${n} jobs` : 'Start job';
}

function canStart() {
  return Boolean(job.path && job.scan && job.selected.size && !job.scanning && !job.busy);
}

const startReason = () => (!job.path ? 'Choose a source folder first' : job.scanning ? 'Still looking at the folder' : !job.selected.size ? 'Select at least one audiobook' : 'Working…');

async function start(ctx) {
  if (!canStart()) return;
  job.busy = true; ctx.rerender();
  try {
    const books = job.scan.books || [];
    const data = await api.submit({ path: job.path, selected_paths: [...job.selected], keep_mp3s: keepMp3s(), verify_all: verifyAll(), force: job.force });
    const created = (data.jobs || []).filter(j => j.created !== false);
    for (const j of data.jobs || []) expect(j.id, 'queued');
    const title = books.length === 1 ? guessFromPath(books[0].path).title : `${created.length || data.jobs?.length || 0} books`;
    notify({ kind: 'info', title: `Queued: ${title}`, body: created.length ? 'It starts when the converter is free' : 'Already in the queue', action: 'View', href: '#/queue', dest: 'queue', jobId: data.jobs?.[0]?.id, at: Date.now() });
    Object.assign(job, { path: '', scan: null, selected: new Set(), busy: false, force: false });
    await refresh({ fresh: true });
    if (ctx.isCurrent?.() !== false) location.hash = '#/queue';
  } catch (error) {
    job.busy = false; job.error = error.message; ctx.rerender();
  }
}

// ---------- folder browser ----------
function openBrowser(ctx) {
  const b = { path: null, roots: [], entries: [], files: [], loading: true, error: '' };
  const load = async path => {
    b.loading = true; b.error = ''; h.update();
    try {
      const data = await api.browse(path);
      b.path = data.path; b.roots = data.roots || [];
      b.entries = (data.entries || []).filter(e => e.type === 'directory');
      b.files = (data.entries || []).filter(e => e.type === 'file');
    } catch (error) { b.error = error.message; }
    b.loading = false; h.update();
    h.el.querySelector('.fbrow, [data-act="use"]')?.focus({ preventScroll: true });
  };
  const crumbs = () => {
    if (!b.path) return [{ name: 'Library', path: null }];
    const root = b.roots.find(r => b.path === r || b.path.startsWith(`${r}/`)) || '';
    const rel = b.path.slice(root.length).split('/').filter(Boolean);
    return [{ name: 'Library', path: null }, ...(root ? [{ name: folderName(root) || root, path: root }] : []), ...rel.map((part, i) => ({ name: part, path: `${root}/${rel.slice(0, i + 1).join('/')}` }))];
  };
  const here = () => {
    if (!b.path) return '';
    const mp3 = b.files.filter(f => /\.mp3$/i.test(f.name)).length;
    const m4b = b.files.some(f => /\.m4b$/i.test(f.name));
    const text = m4b ? 'This folder has an M4B · its chapters will be checked' : mp3 ? `This folder has ${plural(mp3, 'MP3 file')}` : b.entries.length ? `${plural(b.entries.length, 'folder')} inside · pick one, or use this folder to find every book below it` : 'No audio files here';
    return html`<p class="meta" style="margin:0 0 8px">${text}</p>`;
  };
  const h = openOverlay({
    label: 'Choose a folder', tall: true,
    render: ({ asSheet }) => {
      const cs = crumbs();
      const nav = html`<nav aria-label="Folder path" class="row wrap" style="gap:2px;margin-bottom:10px">${cs.map((c, i) => html`<button type="button" class="crumb" data-act="go" data-arg="${c.path ?? ''}" ${i === cs.length - 1 ? html`aria-current="true"` : ''}>${c.name}</button>${i < cs.length - 1 ? html`<span class="muted" aria-hidden="true">›</span>` : ''}`)}</nav>`;
      const rows = b.loading ? html`<p class="meta" role="status" style="padding:12px">Loading folders…</p>`
        : b.error ? html`<p class="alert-bad" role="alert">${b.error}</p>`
          : html`<div role="list" aria-label="Folders" class="col" style="gap:2px">${b.entries.map(e => html`<button type="button" class="fbrow" role="listitem" data-act="go" data-arg="${e.path}"><span class="tile">${icon('folder', 20)}</span><span class="col gap4 grow"><span class="ell" style="font-size:15px;font-weight:650">${e.name}</span><span class="meta" style="font-size:12px">${b.path ? 'Folder' : e.path}</span></span><span class="muted icon">${icon('chevronRight', 18)}</span></button>`)}${!b.entries.length && b.path ? html`<p class="meta" style="padding:8px 12px">No folders inside.</p>` : ''}${!b.entries.length && !b.path ? html`<p class="meta" style="padding:8px 12px">No library folders are available on the server.</p>` : ''}</div>`;
      const selected = b.path ? `${b.path}/` : 'Open a folder to use it';
      const use = button({ label: 'Use this folder', kind: 'primary', act: 'use', disabled: !b.path || b.loading, disabledReason: 'Open a folder first', block: asSheet, size: asSheet ? 'lg' : '' });
      // DESIGN-GAP: G-022 — per-folder MP3 counts and has-M4B flags aren't in the listing.
      if (asSheet) {
        return html`${head('Choose a folder', true, { center: true, left: html`<button type="button" class="plain" data-act="overlay-close">Cancel</button>` })}<div style="flex:1 1 auto;overflow-y:auto">${nav}${here()}${rows}</div><div style="margin-top:12px">${use}</div>`;
      }
      return html`${head('Choose a folder', false)}<p class="meta" style="margin:-8px 0 14px;font-size:14px">Browsing your server. Pick a folder that holds a book’s MP3s or M4B.</p>${nav}${here()}${rows}
        <div class="row" style="justify-content:space-between;gap:12px;margin-top:18px;padding-top:16px;border-top:1px solid var(--line)"><span class="meta ell mono">${selected}</span><div class="row gap8" style="flex-shrink:0">${button({ label: 'Cancel', act: 'overlay-close' })}${use}</div></div>`;
    },
    actions: {
      go: el => load(el.dataset.arg || null),
      use: () => { const path = b.path; h.close(); if (path) choose(path, ctx); },
    },
  });
  load(null);
}

export default {
  title: 'New job',
  topbar: false,
  detail: true,

  signature(ctx) {
    return [state.connected, JSON.stringify({ ...job, selected: [...job.selected] }), JSON.stringify(ctx.ui), JSON.stringify(defaults())].join('|');
  },

  render(ctx) {
    const { phone, enter } = ctx;
    const start = serverButton({ label: job.busy ? 'Starting…' : startLabel(), kind: 'primary', act: 'start', size: 'lg', block: !phone, cls: phone ? 'grow' : '', disabled: !canStart(), disabledReason: startReason() });
    const steps = [['Inspect', 'the files and read their tags'], ['Match', 'the edition and its chapter timeline'], ['Check', 'chapter audio against that timeline'], ['Save', 'the M4B, only if every check passes']];
    if (phone) {
      return html`<div class="back-head" style="padding:0 8px"><a class="textlink" href="#/" style="color:var(--ink);font-size:16px">${icon('chevronLeft', 22)}Back</a></div>
        <div class="page-inset col gap14"><h1 class="h1" tabindex="-1" style="margin:0 4px">New job</h1>${sourceSection(ctx)}${editionSection(ctx)}${optionsSection(ctx)}</div>
        <div class="pbar">${start}</div>`;
    }
    return html`<div class="page-head ${enter ? 'rise' : ''}"><h1 class="h1" tabindex="-1">New job</h1><p class="lede">Pick a folder on your server. We’ll match the edition, build one M4B with chapters, and verify it.</p></div>
      <div class="twocol newjob-grid">
        <div class="col gap20 ${enter ? 'rise' : ''}" style="animation-delay:.05s">${sourceSection(ctx)}${editionSection(ctx)}${optionsSection(ctx)}</div>
        <aside class="panel pad col gap16 ${enter ? 'rise' : ''}" style="animation-delay:.12s;position:sticky;top:24px" aria-label="What happens next"><span class="eyebrow">What happens next</span>
          <ol class="col gap14" style="margin:0;padding:0;list-style:none">${steps.map(([b, t], i) => html`<li class="row" style="align-items:flex-start;gap:12px"><span class="meta" style="font-weight:800;width:18px">${i + 1}</span><span style="font-size:14px;line-height:1.45"><strong>${b}</strong> ${t}</span></li>`)}</ol>
          <div style="height:1px;background:var(--line)"></div>
          <p class="meta" style="line-height:1.5">If anything can’t be confirmed, the book pauses in Needs review instead of saving.</p>
          ${start}</aside></div>`;
  },

  onInput(el, ev, ctx) {
    if (el.dataset.pick == null) return;
    const books = job.scan?.books || [];
    if (el.dataset.pick === 'all') job.selected = el.checked ? new Set(books.map(b => b.path)) : new Set();
    else { const b = books[Number(el.dataset.pick)]; if (b) { if (el.checked) job.selected.add(b.path); else job.selected.delete(b.path); } }
    ctx.rerender();
  },

  actions: {
    browse: (el, ev, ctx) => { if (offline()) return; openBrowser(ctx); },
    checks: (el, ev, ctx) => { job.verifyAll = el.dataset.arg === 'all'; ctx.rerender(); },
    keep: (el, ev, ctx) => { job.keepMp3s = !keepMp3s(); ctx.rerender(); },
    force: (el, ev, ctx) => { job.force = !job.force; ctx.rerender(); },
    start: (el, ev, ctx) => start(ctx),
  },
};

