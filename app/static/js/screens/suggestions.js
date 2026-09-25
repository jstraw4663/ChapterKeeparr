// Suggestions (SCREENS.md → Suggestions), partial until the server has a scan
// (DESIGN-GAP: G-020). Built from what exists today:
//   Ready to convert    ← POST /api/discover: MP3 folders with no job yet
//   Chapters need a check ← discover: M4Bs never checked (problems can't be detected before a check)
//   Pair M4B and EPUB   ← verified books with no EPUB beside the M4B (action needs G-021)
//   No audiobook yet    ← needs server scanning for EPUBs (placeholder)

import { html, relative, sortTitle } from '../format.js';
import { icon } from '../icons.js';
import { api } from '../api.js';
import { state, refresh, touch, expect } from '../store.js';
import { getPrefs } from '../prefs.js';
import { button, tabs, skeletonRows, gapNote } from '../ui.js';
import { coverColor } from '../books.js';
import { notify } from '../notify.js';
import { serverButton, reportError } from './common.js';

const IGNORE_KEY = 'chapterkeeparr.ignored-suggestions.v1';
const scan = { at: 0, running: false, items: [], error: '', done: {} };

const GROUPS = {
  convert: { title: 'Ready to convert', desc: 'Folders with several MP3s and no M4B.', icon: 'convert', tone: '' },
  chapters: { title: 'Chapters need a check', desc: 'M4Bs that haven’t been checked yet. Chapter problems show up once they are.', icon: 'chapters', tone: 'tone-warn' },
  pair: { title: 'Pair M4B and EPUB', desc: 'Verified audiobooks with no EPUB next to them.', icon: 'pair', tone: '' },
  epub: { title: 'No audiobook yet', desc: 'You have the EPUB but not the audiobook.', icon: 'epub', tone: '' },
};
const TABS = [['all', 'All'], ['convert', 'Convert'], ['chapters', 'Check chapters'], ['pair', 'Pair files'], ['epub', 'No audiobook']];

function ignored() {
  try { return new Set(JSON.parse(localStorage.getItem(IGNORE_KEY) || '[]')); } catch { return new Set(); }
}
function ignore(id) {
  const set = ignored(); set.add(id);
  try { localStorage.setItem(IGNORE_KEY, JSON.stringify([...set])); } catch { /* keep in memory only */ }
}

const nameOf = path => String(path).replace(/\/+$/, '').split('/').pop().replace(/\.m4b$/i, '');

async function runScan(ctx) {
  if (scan.running) return;
  scan.running = true; scan.error = ''; ctx?.rerender();
  try {
    if (!state.loaded) await refresh();
    const roots = state.settings?.library_roots || (await api.settings()).library_roots || [];
    const items = [];
    for (const root of roots) {
      const found = await api.discover(root);
      for (const b of found.books || []) {
        items.push({ id: `${b.kind}:${b.path}`, kind: b.kind === 'm4b' ? 'chapters' : 'convert', title: nameOf(b.name || b.path), path: b.path,
          detail: b.kind === 'm4b' ? 'M4B not checked by ChapterKeeparr yet' : 'MP3 folder, no M4B' });
      }
    }
    scan.items = items;
    scan.at = Date.now();
  } catch (error) { scan.error = error.message; }
  scan.running = false;
  publish();
  ctx?.rerender();
}

function pairItems() {
  return state.books.filter(b => (b.status.key === 'verified') && b.epub === 'missing')
    .map(b => ({ id: `pair:${b.path}`, kind: 'pair', title: b.title, author: b.author, path: b.path, detail: 'M4B with no EPUB', book: b }));
}

function visible() {
  const hidden = ignored();
  // Anything that has a job since the scan is no longer a suggestion.
  const known = new Set(state.jobs.map(j => j.path));
  // A job may point at the M4B itself or at the folder that holds it.
  const hasJob = x => known.has(x.path) || known.has(x.path.replace(/\/[^/]+\.m4b$/i, ''));
  return [...scan.items.filter(x => !hasJob(x) || scan.done[x.id]), ...pairItems()].filter(x => !hidden.has(x.id));
}

/** Suggestions badge count (open items), shared with the shell. */
function publish() {
  const open = visible().filter(x => !scan.done[x.id]).length;
  const next = scan.at ? open : null;
  if (state.suggestions?.openCount !== next) { state.suggestions = { openCount: next }; queueMicrotask(touch); }
}

async function act(item, ctx) {
  const d = getPrefs().jobDefaults;
  try {
    const data = await api.submit({ path: item.path, selected_paths: [item.path], keep_mp3s: d.keep_mp3s, verify_all: d.verify_all, force: false });
    for (const j of data.jobs || []) expect(j.id, 'queued');
    scan.done[item.id] = 'Queued';
    notify({ kind: 'info', title: item.kind === 'convert' ? `Queued: ${item.title}` : `Checking ${item.title}`, body: item.kind === 'convert' ? 'Converting MP3s to one M4B' : 'Checking chapters against the edition', action: 'View', href: '#/queue', dest: 'queue', at: Date.now() });
    publish(); ctx.rerender();
    refresh();
  } catch (error) { reportError(error, `Couldn’t queue ${item.title}`); }
}

function row(item, ctx) {
  const done = scan.done[item.id];
  const initial = sortTitle(item.title).charAt(0).toUpperCase();
  const tile = html`<div class="sgtile" style="--c:${coverColor(item.path)}" aria-hidden="true">${initial}</div>`;
  const orbit = api.bookOrbitLink(); // DESIGN-GAP: G-021
  const action = item.kind === 'pair'
    ? button({ label: 'Find EPUB in BookOrbit', disabled: true, disabledReason: orbit.message, size: ctx.phone ? '' : 'md', block: ctx.phone })
    : serverButton({ label: item.kind === 'convert' ? 'Convert' : 'Check chapters', kind: item.kind === 'convert' ? 'primary' : 'ghost', act: 'act', arg: item.id, size: ctx.phone ? '' : 'md', block: ctx.phone });
  const close = html`<button type="button" class="tclose" data-act="ignore" data-arg="${item.id}" aria-label="Ignore ${item.title}" style="margin:0">${icon('x', 18)}</button>`;
  const chip = html`<span class="done-chip">${icon('check', 16, { stroke: 2.2 })}${done}</span>`;
  if (ctx.phone) {
    return html`<div class="col gap8" style="padding:12px 0;border-top:1px solid var(--line)" data-row="${item.id}"><div class="row gap12">${tile}<div class="col gap4 grow"><span style="font-size:15px;font-weight:700">${item.title}</span><span class="meta" style="font-size:12px">${item.author ? `${item.author} · ` : ''}${item.detail}</span></div>${done ? '' : close}</div>${done ? html`<span style="align-self:flex-start">${chip}</span>` : action}</div>`;
  }
  return html`<div class="sgrow" data-row="${item.id}">${tile}<div class="col gap4"><span style="font-size:16px;font-weight:700">${item.title}${item.author ? html` <span class="muted" style="font-weight:500">· ${item.author}</span>` : ''}</span><span class="meta">${item.detail}</span><span class="meta mono ell" style="font-size:12px">${item.path}</span></div><div class="row gap8">${done ? chip : html`${action}${close}`}</div></div>`;
}

export default {
  title: 'Suggestions',
  topbar: true,

  signature(ctx) {
    return [state.sig, state.connected, scan.at, scan.running, scan.error, JSON.stringify(scan.done), JSON.stringify(ctx.ui), ignored().size].join('|');
  },

  mount(root, ctx) {
    if (!scan.at && !scan.running && state.connected !== false) runScan(ctx);
  },

  render(ctx) {
    const { phone, enter } = ctx;
    publish();
    const items = visible();
    const f = ctx.ui.filter || 'all';
    const open = items.filter(x => !scan.done[x.id]);
    const count = k => open.filter(x => x.kind === k).length;
    const scanLabel = scan.running ? 'Scanning your library…' : scan.at ? `Last scan ${relative(scan.at).replace(/^Just now$/, 'just now')}` : 'Not scanned yet';
    const heading = phone
      ? html`<div class="page-pad ${enter ? 'rise' : ''}"><h1 class="h1" tabindex="-1">Suggestions</h1><p class="meta" style="margin-top:4px;font-size:14px">${scanLabel}</p></div>`
      : html`<div class="page-head split ${enter ? 'rise' : ''}"><div class="col gap4"><h1 class="h1" tabindex="-1">Suggestions</h1><p class="lede">The goal: one verified M4B and one EPUB, paired, for every book. Nothing changes until you act.</p></div><div class="row gap14"><span class="meta">${scanLabel}</span>${serverButton({ label: scan.running ? 'Scanning…' : 'Scan again', icon: 'refresh', act: 'scan', disabled: scan.running, disabledReason: 'Scanning…' })}</div></div>`;
    const tabOpts = TABS.map(([k, label]) => [k, label, k === 'all' ? open.length : count(k)]);
    const tabRow = phone
      ? html`<div class="row page-inset" style="align-items:flex-end;gap:6px">${tabs({ label: 'Filter suggestions', options: tabOpts, value: f, act: 'filter', scroll: true, cls: 'grow' })}<button type="button" class="picon" data-act="scan" aria-label="Scan again" ${scan.running ? 'disabled' : ''}>${icon('refresh', 22)}</button></div>`
      : html`<div class="${enter ? 'rise' : ''}" style="animation-delay:.05s">${tabs({ label: 'Filter suggestions', options: tabOpts, value: f, act: 'filter' })}</div>`;

    const groups = ['convert', 'chapters', 'pair', 'epub'].filter(k => f === 'all' || f === k).map((k, gi) => {
      const g = GROUPS[k];
      const rows = items.filter(x => x.kind === k);
      const openRows = rows.filter(x => !scan.done[x.id]);
      const isOpen = !ctx.ui.closed?.[k];
      if (k !== 'epub' && !rows.length) return '';
      const body = k === 'epub'
        ? gapNote('Finding EPUBs without an audiobook needs the server to scan for EPUBs.', 'G-020')
        : html`${k === 'convert' && openRows.length > 1 ? html`<div class="row" style="justify-content:flex-end;padding-bottom:8px">${serverButton({ label: `Convert all ${openRows.length}`, act: 'bulk', size: 'sm' })}</div>` : ''}${rows.map(r => row(r, ctx))}`;
      const head = html`<h2 class="ghh"><button type="button" class="gh" data-act="group" data-arg="${k}" aria-expanded="${isOpen ? 'true' : 'false'}" aria-controls="sg-${k}" style="min-height:${phone ? 56 : 64}px"><span class="chev">${icon('chevronRight', 18, { stroke: 2 })}</span><span class="sgicon ${g.tone}">${icon(g.icon, 20)}</span><span class="col"><span style="font-size:${phone ? 16 : 18}px;font-weight:750">${g.title} <span class="muted" style="font-weight:600">${k === 'epub' ? '—' : openRows.length}</span></span><span class="meta" style="font-size:${phone ? 12 : 14}px">${g.desc}</span></span></button></h2>`;
      return html`<section class="${phone ? 'col page-inset' : 'panel'} ${enter ? 'rise' : ''}" style="${phone ? '' : 'padding:8px 24px'};animation-delay:${0.1 + gi * 0.06}s">${head}<div id="sg-${k}" ${isOpen ? '' : 'hidden'}>${body}</div></section>`;
    });

    let status = '';
    if (scan.error) status = html`<p class="alert-bad ${phone ? 'page-inset' : ''}" role="alert">${scan.error}</p>`;
    else if (scan.running && !scan.at) status = html`<div class="${phone ? 'page-inset' : ''}">${skeletonRows(4, 64)}</div>`;
    const tidy = scan.at && !open.length ? html`<div class="panel bigempty ${phone ? 'page-inset' : ''}"><span class="t">Your library looks tidy</span><span class="lede" style="font-size:15px">We’ll list anything new after the next scan.</span></div>` : '';
    const note = html`<p class="meta ${phone ? 'page-inset' : ''}">Scanning here is partial: it finds MP3 folders and M4Bs with no job yet, and verified books without an EPUB. Ignoring hides a suggestion on this device only. <span class="mono">(G-020)</span></p>`;
    return html`${heading}${tabRow}${status}${scan.at || !scan.running ? groups : ''}${tidy}${note}`;
  },

  actions: {
    scan: (el, ev, ctx) => runScan(ctx),
    filter: (el, ev, ctx) => { ctx.ui.filter = el.dataset.arg; ctx.rerender(); },
    group: (el, ev, ctx) => { ctx.ui.closed = { ...(ctx.ui.closed || {}), [el.dataset.arg]: !ctx.ui.closed?.[el.dataset.arg] }; ctx.rerender(); },
    act: (el, ev, ctx) => { const item = visible().find(x => x.id === el.dataset.arg); if (item) act(item, ctx); },
    bulk: async (el, ev, ctx) => {
      const rows = visible().filter(x => x.kind === 'convert' && !scan.done[x.id]);
      for (const item of rows) await act(item, ctx);
    },
    ignore: (el, ev, ctx) => {
      const id = el.dataset.arg;
      const node = el.closest('[data-row]');
      const finish = () => { ignore(id); publish(); ctx.rerender(); };
      if (node && document.documentElement.dataset.motion !== 'reduce') { node.classList.add('leaving'); setTimeout(finish, 350); } else finish();
    },
  },
};

