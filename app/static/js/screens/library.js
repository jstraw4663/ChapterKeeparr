// Library (SCREENS.md → Library). Primary action: Start reviewing, only when
// something needs review. Scales by rendering in pages of PAGE covers.

import { html, bool } from '../format.js';
import { icon } from '../icons.js';
import { FILTERS, countFor, passes, sortBooks, groupBooks, hasSeriesData, routeFor, STANDALONE } from '../books.js';
import { cover, tabs, segmented, button, emptyState, statusPill, skeletonGrid } from '../ui.js';
import { getPrefs, setPrefs } from '../prefs.js';
import { open as openOverlay, head } from '../overlay.js';
import { state } from '../store.js';
import { reviewTitle } from '../status.js';

const PAGE = 120;
const GROUPS = [['none', 'No grouping', 'None'], ['series', 'Group: Series', 'Series'], ['author', 'Group: Author', 'Author'], ['status', 'Group: Status', 'Status']];
const SORTS = [['series', 'Sort: Series order', 'Series'], ['recent', 'Sort: Recently updated', 'Recent'], ['title', 'Sort: Title', 'Title'], ['author', 'Sort: Author', 'Author']];
const VIEWS = [['large', 'Large covers', 'Large', 'gridLarge'], ['grid', 'Grid', 'Grid', 'grid'], ['list', 'List', 'List', 'list']];

function viewPrefs() {
  const lib = getPrefs().library;
  // Series grouping needs series data (GAPS G-007); fall back to author until it exists.
  const group = lib.group ?? (hasSeriesData(state.books) ? 'series' : 'author');
  return { ...lib, group };
}
const setLib = patch => setPrefs({ library: { ...getPrefs().library, ...patch } });

function cardMarkup(book, view, i, enter) {
  const delay = enter ? `animation-delay:${Math.min(0.15 + i * 0.03, 0.8)}s` : '';
  const href = routeFor(book);
  if (view === 'list') {
    return html`<a class="lrow ${enter ? 'rise' : ''}" style="${delay}" href="${href}" data-book="${book.id}">
      ${cover(book, { size: 48, radius: 8 })}
      <span class="col gap4"><span class="t ell">${book.title}</span><span class="meta ell">${book.author || 'Author unknown'} · ${book.status.detail}</span></span>
      <span class="meta ell">${book.series ? `${book.series}${book.seriesPos ? ` #${book.seriesPos}` : ''}` : '—'}</span>
      <span>${statusPill(book.status, { size: 'sm' })}</span>
      <span class="muted icon">${icon('chevronRight', 18)}</span></a>`;
  }
  return html`<a class="card ${enter ? 'rise' : ''}" style="${delay}" href="${href}" data-book="${book.id}" aria-label="${book.title}, ${book.status.label}">
    ${cover(book, { variant: view === 'large' ? 'large' : 'grid', radius: view === 'large' ? 14 : 12, pill: true })}
    <span class="ct clamp2">${book.title}</span><span class="cs ell">${book.status.detail}</span></a>`;
}

function phoneCard(book, view) {
  const href = routeFor(book);
  if (view === 'list') {
    return html`<a class="mrow" href="${href}" style="min-height:64px" data-book="${book.id}">${cover(book, { size: 48, radius: 8 })}<span class="col gap4 grow"><span class="ell" style="font-size:15px;font-weight:700">${book.title}</span><span class="statusline"><span class="dot dot-${book.status.tone}"></span><span class="ell">${book.status.label} · ${book.author || 'Author unknown'}</span></span></span><span class="muted icon">${icon('chevronRight', 18)}</span></a>`;
  }
  return html`<a class="card" href="${href}" data-book="${book.id}" aria-label="${book.title}, ${book.status.label}">
    ${cover(book, { variant: view === 'large' ? 'large' : 'grid-sm', radius: view === 'large' ? 12 : 10, pill: view === 'large', dot: view !== 'large' })}
    <span class="ct clamp2">${book.title}</span><span class="cs ell">${book.status.detail}</span></a>`;
}

function banner(waiting, enter, phone) {
  if (!waiting.length) return '';
  const n = waiting.length;
  const identityOnly = waiting.every(b => reviewTitle(b.job) === 'Edition not confirmed');
  const why = identityOnly ? 'Each paused because its edition couldn’t be confirmed. Nothing is saved until you decide.'
    : 'Each paused because something couldn’t be confirmed. Nothing is saved until you decide.';
  const stack = waiting.slice(0, 4).map((b, i) => html`<span class="${enter ? 'stack-in' : ''}" style="animation-delay:${0.15 + i * 0.08}s;display:flex">${cover(b, { size: phone ? 40 : 54, radius: phone ? 8 : 10 })}</span>`);
  if (phone) {
    return html`<a class="mbanner page-inset ${enter ? 'rise' : ''}" href="#/review"><span class="stack">${stack}</span><span class="col gap4 grow"><span class="row" style="gap:7px;font-size:16px;font-weight:750"><span class="dot dot-warn pulse"></span>${n} ${n === 1 ? 'book needs' : 'books need'} you</span><span class="meta">Tap to start reviewing</span></span><span class="muted icon">${icon('chevronRight', 18)}</span></a>`;
  }
  return html`<section class="panel banner ${enter ? 'rise' : ''}" aria-label="Waiting for review"><span class="stack">${stack}</span><span class="col gap4 grow"><span class="t"><span class="dot lg dot-warn pulse"></span>${n} ${n === 1 ? 'book is' : 'books are'} waiting on you</span><span class="lede" style="font-size:15px">${why}</span></span>${button({ label: 'Start reviewing', kind: 'primary', href: '#/review', iconEnd: 'arrowRight' })}</section>`;
}

export default {
  title: 'Library',
  nav: 'library',
  topbar: true,

  signature(ctx) {
    const p = viewPrefs();
    return [state.loaded, state.connected, state.sig, JSON.stringify(p), ctx.ui.limit, ctx.route.query.toString(), Boolean(state.settings)].join('|');
  },

  render(ctx) {
    const { enter, ui, phone } = ctx;
    const p = viewPrefs();
    const series = ctx.route.query.get('series');
    const filter = ctx.route.query.get('filter') && FILTERS.some(([k]) => k === ctx.route.query.get('filter')) && !ui.filterTouched ? ctx.route.query.get('filter') : p.filter;
    const all = state.books;
    const scoped = series ? all.filter(b => b.series === series) : all;
    const visible = sortBooks(scoped.filter(b => passes(b, filter)), p.sort);
    const limit = ui.limit || PAGE;
    const shown = visible.slice(0, limit);
    const groups = groupBooks(shown, p.group === 'none' ? 'none' : p.group);
    const waiting = all.filter(b => b.status.key === 'review');
    const groupedBy = { none: '', series: ' · grouped by series', author: ' · grouped by author', status: ' · grouped by status' }[p.group];
    const countLine = `${visible.length === scoped.length ? `${scoped.length.toLocaleString()} ${scoped.length === 1 ? 'book' : 'books'}` : `${visible.length.toLocaleString()} of ${scoped.length.toLocaleString()} books`}${groupedBy}`;
    const seriesGap = p.group === 'series' && !hasSeriesData(all);
    const tabOpts = FILTERS.map(([k, label]) => [k, label, countFor(scoped, k)]);
    const roots = state.settings?.library_roots;

    const heading = phone
      ? html`<div class="page-pad ${enter ? 'rise' : ''}"><h1 class="h1" tabindex="-1">Library</h1><p class="meta" style="margin-top:4px;font-size:14px">${state.loaded ? countLine : 'Loading your library…'}</p></div>`
      : html`<h1 class="sr" tabindex="-1">Library</h1>`;

    const toolbar = phone
      ? html`<div class="row page-inset ${enter ? 'rise' : ''}" style="align-items:flex-end;gap:6px;animation-delay:.1s">${tabs({ label: 'Filter library', options: tabOpts, value: filter, act: 'filter', scroll: true, cls: 'grow' })}<button type="button" class="picon" data-act="view-sheet" aria-label="Sort, group and view" aria-haspopup="dialog">${icon('sliders', 22)}</button></div>`
      : html`<div class="toolbar">${tabs({ label: 'Filter library', options: tabOpts, value: filter, act: 'filter' })}
          <div class="tools">
            <label for="lib-group" class="sr">Group by</label><select id="lib-group" class="sel" data-input="group">${GROUPS.map(([v, text]) => html`<option value="${v}" ${v === p.group ? 'selected' : ''}>${text}</option>`)}</select>
            <label for="lib-sort" class="sr">Sort by</label><select id="lib-sort" class="sel" data-input="sort">${SORTS.map(([v, text]) => html`<option value="${v}" ${v === p.sort ? 'selected' : ''}>${text}</option>`)}</select>
            ${segmented({ label: 'View', options: VIEWS.map(([v, text, , ic]) => [v, text, '', ic]), value: p.view, act: 'view', iconOnly: true })}
          </div></div>`;

    let body;
    if (!state.loaded) body = skeletonGrid(phone ? 9 : 12);
    else if (!all.length && state.connected === false) body = emptyState({ title: 'Can’t reach the server', body: 'Your library will appear once the connection is back.', action: button({ label: 'Retry now', act: 'retry-now' }) });
    else if (!all.length && roots && !roots.length) body = emptyState({ title: 'No library folder is set up', body: 'Set LIBRARY_ROOTS on the server to point at your audiobooks.', action: button({ label: 'Open Settings', href: '#/settings/library' }) });
    else if (!all.length) body = emptyState({ title: 'Your library is empty', body: 'Start a job from a folder of MP3s or an existing M4B on your server.', action: button({ label: 'New job', kind: 'primary', href: '#/new', icon: 'plus' }) });
    else if (!visible.length) body = emptyState({ title: 'No books match this filter.' });
    else {
      body = html`<div class="groups">${groups.map(g => {
        const open = !p.closed?.[`${p.group}:${g.key}`];
        const items = g.items;
        const content = p.view === 'list'
          ? html`<div class="liblist">${items.map((b, i) => (phone ? phoneCard(b, 'list') : cardMarkup(b, 'list', i, enter)))}</div>`
          : html`<div class="libgrid ${p.view}">${items.map((b, i) => (phone ? phoneCard(b, p.view) : cardMarkup(b, p.view, i, enter)))}</div>`;
        if (p.group === 'none') return html`<section class="group">${content}</section>`;
        const gid = `g-${p.group}-${encodeURIComponent(g.key).replace(/%/g, '')}`;
        return html`<section class="group"><h2 class="ghh"><button type="button" class="gh top-line" data-act="group-toggle" data-arg="${p.group}:${g.key}" aria-expanded="${bool(open)}" aria-controls="${gid}"><span class="chev">${icon('chevronRight', 18, { stroke: 2 })}</span><span class="title">${g.title}</span><span class="count">${g.items.length}</span>${g.sub ? html`<span class="summary">${g.sub}</span>` : ''}</button></h2><div id="${gid}" ${open ? '' : 'hidden'}>${content}</div></section>`;
      })}</div>
      ${visible.length > shown.length ? html`<div class="row" style="justify-content:center;padding:8px 0" data-more>${button({ label: `Show ${Math.min(PAGE, visible.length - shown.length)} more of ${visible.length - shown.length}`, act: 'more' })}</div>` : ''}
      ${state.capped ? html`<p class="meta center">Showing the latest 1,000 jobs. Older books need server paging (G-008).</p>` : ''}`;
    }

    return html`${heading}${banner(waiting, enter, phone)}
      <section class="col gap14 ${phone ? '' : enter ? 'rise' : ''}" style="animation-delay:.12s">
        ${toolbar}
        ${phone ? '' : html`<span class="meta">${state.loaded ? countLine : 'Loading your library…'}</span>`}
        ${series ? html`<span class="filterchip ${phone ? 'page-inset' : ''}" style="align-self:flex-start">Series: ${series}<button type="button" class="tclose" data-act="clear-series" aria-label="Show all series">${icon('x', 16)}</button></span>` : ''}
        ${seriesGap ? html`<p class="meta ${phone ? 'page-inset' : ''}">Series info isn’t available from the server yet, so every book is under ${STANDALONE}. <span class="mono">(G-007)</span></p>` : ''}
        <div class="${phone ? 'page-inset' : ''}">${body}</div>
      </section>`;
  },

  mount(root, ctx) {
    // Load the next page automatically as the "Show more" row scrolls into view.
    const more = root.querySelector('[data-more]');
    if (!more || typeof IntersectionObserver !== 'function') return;
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { io.disconnect(); ctx.ui.limit = (ctx.ui.limit || PAGE) + PAGE; ctx.rerender(); }
    }, { rootMargin: '600px' });
    io.observe(more);
    return () => io.disconnect();
  },

  actions: {
    filter: (el, ev, ctx) => { ctx.ui.filterTouched = true; ctx.ui.limit = PAGE; setLib({ filter: el.dataset.arg }); ctx.rerender(); },
    view: (el, ev, ctx) => { setLib({ view: el.dataset.arg }); ctx.rerender(); },
    more: (el, ev, ctx) => { ctx.ui.limit = (ctx.ui.limit || PAGE) + PAGE; ctx.rerender(); },
    'clear-series': () => { location.hash = '#/'; },
    'group-toggle': (el, ev, ctx) => {
      const key = el.dataset.arg;
      const closed = { ...(getPrefs().library.closed || {}) };
      if (closed[key]) delete closed[key]; else closed[key] = true;
      setLib({ closed });
      ctx.rerender();
    },
    'view-sheet': (el, ev, ctx) => {
      const h = openOverlay({
        label: 'Sort, group and view', kind: 'sheet',
        render: ({ asSheet }) => {
          const p = viewPrefs();
          const block = (title, label, opts, value, act) => html`<div class="col gap8" style="padding:10px 0"><span style="font-size:14px;font-weight:650">${title}</span>${segmented({ label, options: opts, value, act, full: true })}</div>`;
          return html`${head('Library view', asSheet)}
            ${block('Group by', 'Group by', GROUPS.map(([v, , s]) => [v, s]), p.group, 'set-group')}
            ${block('Sort', 'Sort', SORTS.map(([v, , s]) => [v, s]), p.sort, 'set-sort')}
            ${block('View', 'View', VIEWS.map(([v, , s]) => [v, s]), p.view, 'set-view')}`;
        },
        actions: {
          'set-group': b => { setLib({ group: b.dataset.arg }); h.update(); ctx.rerender(); },
          'set-sort': b => { setLib({ sort: b.dataset.arg }); h.update(); ctx.rerender(); },
          'set-view': b => { setLib({ view: b.dataset.arg }); h.update(); ctx.rerender(); },
        },
      });
    },
  },

  onInput(el, ev, ctx) {
    if (el.dataset.input === 'group') { setLib({ group: el.value }); ctx.rerender(); }
    if (el.dataset.input === 'sort') { setLib({ sort: el.value }); ctx.rerender(); }
  },
};
