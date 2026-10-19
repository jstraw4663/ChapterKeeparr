// Desktop and phone shells (DESIGN.md §6): sidebar with badges and the Activity
// card, top bar with search, phone header / tab bar / FAB / settings sheet,
// offline banner and search overlay (§8 Search).

import { html, bool } from './format.js';
import { icon, logo, ring } from './icons.js';
import { NAV } from './router.js';
import { state, counts, refresh } from './store.js';
import { getPrefs, setPrefs, rememberRecent } from './prefs.js';
import { searchLibrary } from './search.js';
import { routeFor } from './books.js';
import { cover, segmented, toggle } from './ui.js';
import { morphInto } from './morph.js';
import { syncTabbarInk, syncInks } from './transitions.js';
import { open as openOverlay, head } from './overlay.js';
import { hydrateCovers } from './covers.js';

const THEMES = [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']];

export function shellMarkup() {
  return html`
  <a class="skip" href="#view" data-act="skip-content">Skip to content</a>
  <div class="app">
    <aside class="rail" aria-label="Sidebar">
      <a class="brand" href="#/" aria-label="ChapterKeeparr, Library">${logo(30)}<span class="lbl word">ChapterKeeparr</span></a>
      <nav class="nav" aria-label="Primary">
        ${NAV.map(item => html`<a class="side" href="${item.href}" data-nav="${item.name}" aria-label="${item.label}">
          <span class="glyph">${icon(item.icon, 20)}${item.name === 'queue' ? ring('qring', 0) : ''}</span><span class="lbl">${item.label}</span>
          ${item.badge ? html`<span class="nbadge ${item.badge === 'review' ? 'amber' : ''} zero" data-badge="${item.badge}"><span class="halo"></span><span class="n"></span></span>` : ''}
        </a>`)}
      </nav>
      <a class="act" href="#/queue" data-activity-card aria-label="Activity">
        <span class="eyebrow" style="display:block;margin-bottom:12px">Activity</span>
        <span class="row gap12"><span data-act-cover></span><span class="col gap4 grow"><span class="t ell" data-act-title>Queue is idle</span><span class="s" data-act-sub>Nothing converting</span></span></span>
        <span class="bar thin" style="display:block"><span data-act-bar style="width:0%"></span></span>
      </a>
      <div class="rail-foot">
        <button type="button" class="side" data-act="collapse" aria-expanded="true" aria-label="Collapse sidebar"><span class="glyph flip">${icon('collapse', 20)}</span><span class="lbl">Collapse sidebar</span></button>
      </div>
    </aside>
    <main class="main" id="main">
      <div class="topbar" data-topbar>
        <div class="sbox" data-search-box>
          <label for="top-search" class="sr">Search library</label>
          <span class="icon">${icon('search', 18)}</span>
          <input id="top-search" class="search" type="search" placeholder="Search title, series, or ASIN" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="false" aria-controls="top-results" aria-autocomplete="list">
          <span class="kbd" aria-hidden="true">/</span>
          <div id="top-results" class="sdrop hidden" role="listbox" aria-label="Search results"></div>
        </div>
        <a class="btn btn-primary" href="#/new" style="padding:0 20px 0 16px">${icon('plus', 18)}New job</a>
      </div>
      <div id="view" tabindex="-1"></div>
    </main>
  </div>
  <header class="mh" data-mh>
    <a class="mh-brand" href="#/" aria-label="ChapterKeeparr home"><span class="mh-logo">${logo(28)}</span><span class="mh-word">ChapterKeeparr</span></a>
    <div class="mh-search">
      <button type="button" class="mh-sbtn" data-act="msearch-open" aria-label="Search">${icon('search', 22)}</button>
      <label for="m-q" class="sr">Search your library</label>
      <input id="m-q" type="search" placeholder="Search your library" autocomplete="off" spellcheck="false" tabindex="-1">
    </div>
    <button type="button" class="picon mh-gear" data-act="settings-sheet" aria-label="Settings" aria-haspopup="dialog">${icon('gear', 22)}</button>
    <button type="button" class="mh-cancel" data-act="msearch-close">Cancel</button>
  </header>
  <div class="mres hidden" id="m-results" role="listbox" aria-label="Search results"></div>
  <nav class="tabbar" aria-label="Primary">
    ${[NAV[1], NAV[0], NAV[2], NAV[3]].map(item => html`<a class="ptab" href="${item.href}" data-nav="${item.name}"><span class="glyph">${icon(item.icon, 24)}${item.name === 'queue' ? ring('pring', 0) : ''}${item.badge ? html`<span class="pbadge ${item.badge === 'review' ? 'amber' : item.badge === 'suggestions' ? 'neutral' : ''} zero" data-badge="${item.badge}"><span class="halo"></span><span class="n"></span></span>` : ''}</span>${item.label}</a>`)}
  </nav>
  <a class="fab" href="#/new" aria-label="New job">${icon('plus', 26, { stroke: 2 })}</a>
  <div class="offline hidden" role="alert" data-offline><span class="dot lg dot-bad pulse"></span><span><strong>Can’t reach the server.</strong> Showing the last known state.</span><button type="button" class="tbtn" data-act="retry-now">Retry now</button></div>
  <div class="moffline hidden" role="alert" data-moffline><span class="dot dot-bad pulse"></span><span class="grow">Can’t reach the server · last known state</span><button type="button" class="tbtn" data-act="retry-now" style="height:32px">Retry</button></div>
  <div id="player-slot"></div>
  <div id="review-save"></div>
  <div id="notes"></div>
  <div id="overlays"></div>`;
}

// ---------- appearance ----------
export function applyAppearance() {
  const prefs = getPrefs();
  const rootEl = document.documentElement;
  if (prefs.theme === 'system') rootEl.removeAttribute('data-theme'); else rootEl.dataset.theme = prefs.theme;
  const reduce = prefs.reduceMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) rootEl.dataset.motion = 'reduce'; else delete rootEl.dataset.motion;
  const bg = getComputedStyle(rootEl).getPropertyValue('--bg').trim();
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
}

export function initCollapse() {
  const saved = getPrefs().sidebarCollapsed;
  const collapsed = saved ?? (window.innerWidth >= 768 && window.innerWidth < 1100);
  document.documentElement.classList.toggle('collapsed', collapsed);
  syncCollapseButton();
}
function syncCollapseButton() {
  const collapsed = document.documentElement.classList.contains('collapsed');
  const activity = document.querySelector('[data-activity-card]');
  if (activity) { activity.inert = collapsed; activity.setAttribute('aria-hidden', String(collapsed)); }
  const btn = document.querySelector('[data-act="collapse"]');
  if (!btn) return;
  btn.setAttribute('aria-expanded', String(!collapsed));
  btn.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
  btn.querySelector('.lbl').textContent = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
}
function aimActivityCard() {
  // The Activity card flies into the Queue icon when the sidebar collapses (§7).
  const card = document.querySelector('[data-activity-card]');
  const target = document.querySelector('.rail [data-nav="queue"] .glyph');
  if (!card || !target || document.documentElement.classList.contains('collapsed')) return;
  const c = card.getBoundingClientRect(), t = target.getBoundingClientRect();
  card.style.setProperty('--act-dx', `${Math.round(t.left + t.width / 2 - (c.left + c.width / 2))}px`);
  card.style.setProperty('--act-dy', `${Math.round(t.top + t.height / 2 - (c.top + c.height / 2))}px`);
}

// ---------- live shell state ----------
export function updateShell(route) {
  const c = counts();
  const setBadge = (name, n, hideZero = true) => document.querySelectorAll(`[data-badge="${name}"]`).forEach(b => {
    b.querySelector('.n').textContent = n == null ? '' : String(n);
    b.classList.toggle('zero', n == null || (hideZero && n === 0));
  });
  setBadge('review', c.review);
  setBadge('queue', c.active);
  setBadge('suggestions', c.suggestions);
  const nav = route?.nav;
  document.querySelectorAll('[data-nav]').forEach(a => {
    const on = a.dataset.nav === nav;
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  syncTabbarInk();
  const qLabel = `Queue, ${c.active} active`;
  document.querySelectorAll('[data-nav="queue"]').forEach(a => a.setAttribute('aria-label', qLabel));
  document.querySelectorAll('.rail [data-nav="review"]').forEach(a => a.setAttribute('aria-label', `Needs review, ${c.review}`));

  // Activity card + progress rings
  const conv = c.converting;
  const pct = conv?.status.pct ?? 0;
  const card = document.querySelector('[data-activity-card]');
  if (card) {
    card.querySelector('[data-act-title]').textContent = conv ? conv.title : 'Queue is idle';
    const sub = card.querySelector('[data-act-sub]');
    morphInto(sub, String(conv ? html`<span class="dot dot-ink pulse" style="width:6px;height:6px"></span><span class="ell">${conv.status.stepLabel || 'Starting'} · ${pct}%</span>` : html`<span class="ell">Nothing converting</span>`));
    card.querySelector('[data-act-bar]').style.width = `${pct}%`;
    const slot = card.querySelector('[data-act-cover]');
    const key = conv ? conv.id : '';
    if (slot.dataset.key !== key) {
      slot.dataset.key = key;
      slot.innerHTML = String(conv ? cover(conv, { size: 40, radius: 7 }) : html`<span class="cover" style="width:40px;height:40px;border-radius:7px"></span>`);
      hydrateCovers(slot);
    }
    card.setAttribute('aria-label', `Activity: ${conv ? `${conv.title}, ${conv.status.stepLabel || 'starting'}, ${pct}%` : 'queue is idle'}`);
  }
  document.querySelectorAll('.qring, .pring').forEach(svg => {
    svg.classList.toggle('on', Boolean(conv));
    const fg = svg.querySelector('.fg');
    if (fg) fg.style.strokeDashoffset = (94.2 * (1 - pct / 100)).toFixed(1);
  });

  const offline = state.connected === false;
  document.querySelector('[data-offline]')?.classList.toggle('hidden', !offline);
  document.querySelector('[data-moffline]')?.classList.toggle('hidden', !offline);
}

export function setScreenChrome({ topbar = true, detail = false } = {}) {
  document.querySelector('[data-topbar]')?.classList.toggle('hidden', !topbar);
  document.documentElement.classList.toggle('detail-screen', detail);
}

// ---------- search ----------
const search = { q: '', idx: -1, open: false };

function resultMarkup(list, prefix) {
  const { head: title, results } = searchLibrary(state.books, search.q, { recent: getPrefs().recent });
  const rows = results.map((r, i) => {
    const selected = i === search.idx;
    if (r.type === 'series') {
      return html`<a class="sres" id="${prefix}${i}" role="option" aria-selected="${bool(selected)}" href="#/?series=${encodeURIComponent(r.name)}" data-sres="${i}"><span class="tile">${icon('library', 20)}</span><span class="col gap4 grow"><span class="t ell">${r.pre}<b>${r.mid}</b>${r.post}</span><span class="statusline">Series · ${r.count} ${r.count === 1 ? 'book' : 'books'}</span></span></a>`;
    }
    const b = r.book;
    return html`<a class="sres" id="${prefix}${i}" role="option" aria-selected="${bool(selected)}" href="${routeFor(b)}" data-sres="${i}" data-book="${b.id}">${cover(b, { size: 44, radius: 8 })}<span class="col gap4 grow"><span class="t ell">${r.pre}<b>${r.mid}</b>${r.post}</span><span class="statusline"><span class="dot dot-${b.status.tone}"></span><span class="ell">${r.why || b.author || 'Author unknown'} · ${b.status.label}</span></span></span></a>`;
  });
  list.length = results.length;
  const empty = search.q.trim() && !results.length ? html`<p class="meta" style="margin:14px 10px;font-size:14px">No books match “${search.q}”. Try a series or ASIN.</p>` : '';
  return { rows, title, empty };
}

function renderDesktopResults() {
  const box = document.getElementById('top-results');
  const input = document.getElementById('top-search');
  if (!box) return;
  box.classList.toggle('hidden', !search.open);
  input.setAttribute('aria-expanded', String(search.open));
  if (!search.open) { input.removeAttribute('aria-activedescendant'); return; }
  const list = [];
  const { rows, title, empty } = resultMarkup(list, 'sres-d-');
  box.innerHTML = String(html`${title ? html`<div class="shead">${title}</div>` : ''}${rows}${empty}${!state.loaded ? html`<p class="meta" style="margin:14px 10px">Loading your library…</p>` : ''}<div class="sfoot" aria-hidden="true"><span><span class="kbd">↑</span><span class="kbd">↓</span>move</span><span><span class="kbd">Enter</span>open</span><span><span class="kbd">Esc</span>close</span></div>`);
  if (search.idx >= 0) input.setAttribute('aria-activedescendant', `sres-d-${search.idx}`); else input.removeAttribute('aria-activedescendant');
  search.count = list.length;
  hydrateCovers(box);
}

function renderPhoneResults() {
  const box = document.getElementById('m-results');
  const open = document.querySelector('[data-mh]')?.classList.contains('searching');
  box.classList.toggle('hidden', !open);
  document.querySelector('.fab')?.classList.toggle('hide', Boolean(open));
  if (!open) return;
  const list = [];
  const { rows, title, empty } = resultMarkup(list, 'sres-m-');
  box.innerHTML = String(html`${title ? html`<div class="shead">${title}</div>` : ''}${rows}${empty}${!search.q.trim() ? html`<div class="shead" style="margin-top:10px">Jump to</div><a class="sres" href="#/review"><span class="tile tone-warn">${icon('review', 20)}</span><span style="font-size:15px;font-weight:650">Needs review</span></a><a class="sres" href="#/suggestions"><span class="tile">${icon('suggestions', 20)}</span><span style="font-size:15px;font-weight:650">Suggestions</span></a>` : ''}`);
  hydrateCovers(box);
}

export function closeSearch() {
  search.open = false; search.idx = -1;
  renderDesktopResults();
  const mh = document.querySelector('[data-mh]');
  if (mh?.classList.contains('searching')) {
    mh.classList.remove('searching');
    const input = document.getElementById('m-q');
    input.value = ''; input.tabIndex = -1; search.q = '';
    renderPhoneResults();
  }
}

export function refreshSearch() {
  if (search.open) renderDesktopResults();
  if (document.querySelector('[data-mh]')?.classList.contains('searching')) renderPhoneResults();
}

function bindSearch() {
  const input = document.getElementById('top-search');
  input.addEventListener('input', () => { search.q = input.value; search.idx = -1; search.open = true; renderDesktopResults(); });
  input.addEventListener('focus', () => { search.open = true; renderDesktopResults(); });
  input.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== input) { search.open = false; renderDesktopResults(); } }, 160));
  input.addEventListener('keydown', event => {
    const n = search.count || 0;
    if (event.key === 'Escape') { search.open = false; search.idx = -1; renderDesktopResults(); input.blur(); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); search.open = true; search.idx = Math.min(search.idx + 1, n - 1); renderDesktopResults(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); search.idx = Math.max(search.idx - 1, 0); renderDesktopResults(); }
    else if (event.key === 'Enter') {
      event.preventDefault();
      const el = document.getElementById(`sres-d-${search.idx >= 0 ? search.idx : 0}`);
      if (el) { el.click(); input.blur(); }
    }
  });
  document.getElementById('top-results').addEventListener('mousedown', event => event.preventDefault()); // keep focus for clicks
  const m = document.getElementById('m-q');
  m.addEventListener('input', () => { search.q = m.value; renderPhoneResults(); });
  document.addEventListener('click', event => {
    const hit = event.target.closest('[data-book]');
    if (hit) { rememberRecent(hit.dataset.book); }
    if (event.target.closest('.sres')) setTimeout(closeSearch, 0);
  });
  // "/" focuses search anywhere except while typing.
  document.addEventListener('keydown', event => {
    if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
    const t = event.target;
    if (t.closest?.('input,textarea,select,[contenteditable="true"]') || document.documentElement.classList.contains('overlay-open')) return;
    event.preventDefault();
    if (window.matchMedia('(max-width: 767px)').matches) openPhoneSearch(); else input.focus();
  });
}

function openPhoneSearch() {
  const mh = document.querySelector('[data-mh]');
  mh.classList.add('searching');
  const input = document.getElementById('m-q');
  input.tabIndex = 0;
  renderPhoneResults();
  setTimeout(() => input.focus(), 380);
}

// ---------- settings sheet (phone gear) ----------
function openSettingsSheet() {
  const h = openOverlay({
    label: 'Settings', kind: 'sheet',
    render: ({ asSheet }) => {
      const p = getPrefs();
      return html`${head('Settings', asSheet)}
        <div class="col gap12" style="padding:8px 0 16px"><span style="font-size:14px;font-weight:650">Appearance</span>${segmented({ label: 'Appearance', options: THEMES, value: p.theme, act: 'theme', full: true })}</div>
        <div class="sheetrow"><div class="col gap4"><span style="font-size:15px;font-weight:600">Status notifications</span><span class="meta">Pop up briefly, then tuck into a tab</span></div>${toggle({ label: 'Status notifications', checked: p.notifications, act: 'notif' })}</div>
        <a class="sheetrow" href="#/settings" data-act="all-settings" style="font-size:15px;font-weight:600">All settings<span class="muted icon">${icon('chevronRight', 18)}</span></a>`;
    },
    actions: {
      theme: el => { setPrefs({ theme: el.dataset.arg }); applyAppearance(); h.update(); },
      notif: () => { setPrefs({ notifications: !getPrefs().notifications }); h.update(); },
      // The sheet's action handler cancels the link, so navigate explicitly.
      'all-settings': () => { h.close(); location.hash = '#/settings'; },
    },
  });
}

// ---------- shell actions (delegated from main.js) ----------
export const shellActions = {
  'skip-content'(el, event) {
    event.preventDefault();
    document.getElementById('view')?.focus();
  },
  collapse() {
    const rootEl = document.documentElement;
    if (!rootEl.classList.contains('collapsed')) aimActivityCard();
    const collapsed = !rootEl.classList.contains('collapsed');
    rootEl.classList.toggle('collapsed', collapsed);
    setPrefs({ sidebarCollapsed: collapsed });
    syncCollapseButton();
  },
  'retry-now': () => refresh(),
  'msearch-open': () => openPhoneSearch(),
  'msearch-close': () => closeSearch(),
  'settings-sheet': () => openSettingsSheet(),
};

export function initShell() {
  bindSearch();
  initCollapse();
  aimActivityCard();
  const sidebarQuery = window.matchMedia('(min-width: 768px) and (max-width: 1099px)');
  sidebarQuery.addEventListener?.('change', initCollapse);
  window.addEventListener('resize', () => aimActivityCard());
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyAppearance);
  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', applyAppearance);
}

