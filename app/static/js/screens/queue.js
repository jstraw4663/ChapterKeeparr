// Queue (SCREENS.md → Queue): only work in progress (converting, then up next).
// Books waiting for a decision live in Needs review, reached from the banner here.
// Failed jobs show below with Retry. No global primary action; each item has its own.

import { html, bool, relative, dayLabel } from '../format.js';
import { icon } from '../icons.js';
import { state } from '../store.js';
import { cover, stepTracker, progressBar, tabs, button, iconButton, emptyState, collapsible, logRow, skeletonRows, statusLine, statusPill, reviewBanner } from '../ui.js';
import { reportOf } from '../status.js';
import { routeFor } from '../books.js';
import { ACTIVITY_FILTERS, passesActivity } from '../events.js';
import { syncInks } from '../transitions.js';
import { cancelControl, cancelActions, serverButton, activityRows, offline, OFFLINE_REASON, askCancel } from './common.js';

const LOG_PAGE = 30;

function converting(book, ctx) {
  const s = book.status;
  const pct = s.pct ?? 0;
  if (ctx.phone) {
    return html`<div class="panel col gap14" style="padding:16px" id="job-${book.id}">
      <div class="row gap12">${cover(book, { size: 52, radius: 10 })}<div class="col gap4 grow"><span class="ell" style="font-size:16px;font-weight:750">${book.title}</span><span class="meta tabular">${s.cancelling ? s.detail : `${s.stepLabel || 'Starting'} · ${pct}%`}</span></div>
      ${s.canCancel ? iconButton({ icon: 'x', label: 'Cancel job', act: 'ask-cancel', arg: book.id, cls: 'tclose', disabled: offline(), disabledReason: OFFLINE_REASON }) : ''}</div>
      ${stepTracker(s, { compact: true })}${progressBar(pct, { live: !s.cancelling, label: `${book.title} progress` })}
      ${ctx.ui.confirm === `cancel:${book.id}` ? cancelControl(book.id, ctx) : ''}</div>`;
  }
  return html`<div class="panel convcard" id="job-${book.id}">
    ${cover(book, { size: 88, radius: 12 })}
    <div class="col gap16"><div class="col gap4"><span style="font-size:19px;font-weight:750">${book.title}</span><span class="meta ell mono" title="${book.path}">${book.path}</span></div>${stepTracker(s)}<span class="meta">${s.detail}</span></div>
    <div class="col gap12" style="align-items:flex-end"><span class="bigpct tabular">${pct}%</span>${progressBar(pct, { live: !s.cancelling, label: `${book.title} progress` })}
      ${s.canCancel ? cancelControl(book.id, ctx) : html`<span class="meta">${s.cancelling ? 'Cancelling…' : ''}</span>`}</div>
  </div>`;
}

function failedRow(book, ctx) {
  const s = book.status;
  const open = ctx.ui.err?.[book.id];
  const report = reportOf(book.job);
  const output = [book.job.error, report.reason && report.reason !== book.job.error ? report.reason : ''].filter(Boolean).join('\n\n') || 'No error message was recorded.';
  const detail = html`<div class="opened" style="${ctx.phone ? 'margin:0 0 12px' : 'margin:0 16px 16px 94px'}" id="err-${book.id}"><pre class="pre">${output}</pre><p class="meta" style="margin-top:8px">The converter’s full output isn’t available from the server yet. <span class="mono">(G-005)</span></p></div>`;
  if (ctx.phone) {
    return html`<div class="col" style="border-top:1px solid var(--line)" id="job-${book.id}"><div class="row gap12" style="min-height:72px">${cover(book, { size: 52, radius: 9 })}<div class="col gap4 grow"><span class="ell" style="font-size:15px;font-weight:700">${book.title}</span><span class="bad-text" style="font-size:13px">${s.detail.replace(/ · .*$/, '')}</span></div>
      <button type="button" class="picon" data-act="err" data-arg="${book.id}" aria-label="Error details" aria-expanded="${bool(open)}" aria-controls="err-${book.id}">${icon('alert', 22)}</button>
      ${s.canRetry ? iconButton({ icon: 'refresh', label: 'Retry', act: 'retry', arg: book.id, cls: 'picon icb solid', disabled: offline(), disabledReason: OFFLINE_REASON }) : ''}</div>${open ? detail : ''}</div>`;
  }
  return html`<div class="col" style="border-top:1px solid var(--line)" id="job-${book.id}">
    <div class="failrow">${cover(book, { size: 56, radius: 9 })}<div class="col gap4"><span style="font-size:16px;font-weight:700">${book.title}</span><span class="bad-text" style="font-size:13px">${s.detail} · ${relative(book.updatedAt)}</span></div>
    <div class="row gap8">${button({ label: 'Error details', act: 'err', arg: book.id, size: 'sm', extra: { 'aria-expanded': bool(open), 'aria-controls': `err-${book.id}` } })}${s.canRetry ? serverButton({ label: 'Retry', kind: 'primary', icon: 'refresh', act: 'retry', arg: book.id, size: 'sm' }) : ''}</div></div>
    ${open ? detail : ''}</div>`;
}

function upNext(queued, converting, ctx) {
  if (!queued.length) {
    return emptyState({ cls: ctx.phone ? '' : 'row-style', title: converting ? 'Up next: nothing else queued' : 'Nothing is converting', body: 'New jobs line up here and start when the converter is free.', action: button({ label: 'New job', icon: 'plus', href: '#/new' }) });
  }
  return html`<div class="panel" style="padding:0 8px">${queued.map(b => html`<div class="queuedrow" id="job-${b.id}">${cover(b, { size: 48, radius: 8 })}<span class="col gap4 grow"><span class="ell" style="font-size:15px;font-weight:700">${b.title}</span><span class="meta ell">Queued ${relative(b.createdAt)} · <span class="mono">${b.path}</span></span></span>${cancelControl(b.id, ctx)}</div>`)}</div>`;
}

function activity(ctx) {
  const filter = ctx.ui.logFilter || 'all';
  const rows = activityRows().filter(r => passesActivity(r, filter));
  const limit = ctx.ui.logLimit || LOG_PAGE;
  const shown = rows.slice(0, limit);
  const days = [];
  for (const row of shown) {
    const day = dayLabel(row.at);
    if (!days.length || days[days.length - 1].day !== day) days.push({ day, items: [] });
    days[days.length - 1].items.push(row);
  }
  const chips = html`<div class="row gap8 ${ctx.phone ? 'hscroll' : 'wrap'}" style="padding:4px 0 12px" role="group" aria-label="Filter activity">${ACTIVITY_FILTERS.map(([k, label]) => html`<button type="button" class="btn btn-chip ${k === filter ? 'on' : ''}" data-act="log-filter" data-arg="${k}" aria-pressed="${bool(k === filter)}">${label}</button>`)}</div>`;
  const body = html`${chips}
    ${days.map(d => html`<div class="logday">${d.day}</div>${d.items.map(r => logRow(r))}`)}
    ${!rows.length ? html`<p class="meta" style="margin:12px 4px;font-size:14px">${filter === 'you' ? 'Nothing you’ve done on this device yet.' : 'Nothing here yet.'}</p>` : ''}
    ${rows.length > shown.length ? button({ label: 'Show older activity', act: 'log-more', block: true, cls: 'mt10' }) : ''}
    <p class="meta" style="margin-top:10px">Showing each job’s latest change and what you did on this device. A full history needs server support. <span class="mono">(G-010)</span></p>`;
  const open = ctx.ui.open?.activity ?? true;
  return collapsible({ id: 'activity', title: 'Activity', summary: ctx.phone ? '' : 'Everything processed, newest first', open, body, cls: ctx.phone ? 'col' : 'panel disc', headCls: ctx.phone ? 'top-line' : '' });
}

function focusedJob(book, ctx) {
  const s = book.status;
  return html`<section class="panel focusjob" aria-label="Selected job">${cover(book, { size: 56, radius: 9 })}<div class="col gap4 grow"><span style="font-size:16px;font-weight:700">${book.title}</span>${statusLine(s)}<span class="meta mono ell">${book.path}</span></div>
    <div class="row gap8">${statusPill(s, { size: 'sm' })}${s.key === 'review' ? button({ label: 'Review', kind: 'primary', href: routeFor(book), size: 'sm' }) : ''}${s.canRetry ? serverButton({ label: 'Retry', kind: 'primary', icon: 'refresh', act: 'retry', arg: book.id, size: 'sm' }) : ''}${s.canCancel ? cancelControl(book.id, ctx) : ''}</div></section>`;
}

export default {
  title: 'Queue',
  topbar: true,

  signature(ctx) {
    return [state.loaded, state.connected, state.authNeeded, state.sig, JSON.stringify(ctx.ui), ctx.route.query.toString()].join('|');
  },

  render(ctx) {
    const { enter, phone } = ctx;
    const books = state.books;
    const conv = books.filter(b => b.status.key === 'converting');
    const queued = books.filter(b => b.status.key === 'queued').sort((a, b) => a.createdAt - b.createdAt);
    const failed = books.filter(b => b.status.key === 'failed');
    const review = books.filter(b => b.status.key === 'review').sort((a, b) => b.updatedAt - a.updatedAt);
    const focusId = ctx.route.query.get('job');
    const focus = focusId ? state.byId.get(focusId) : null;
    const focusListed = focus && ['converting', 'failed', 'queued'].includes(focus.status.key);
    const rise = (d = 0) => (enter ? html` rise" style="animation-delay:${d}s` : '');
    const inset = phone ? 'page-inset' : '';

    const head = phone
      ? html`<div class="page-pad ${enter ? 'rise' : ''}"><h1 class="h1" tabindex="-1">Queue</h1><p class="meta" style="margin-top:4px;font-size:14px">Converting now and waiting to start</p></div>`
      : html`<div class="page-head ${enter ? 'rise' : ''}"><h1 class="h1" tabindex="-1">Queue</h1><p class="lede">What’s converting now, what’s waiting to start, and a log of everything processed.</p></div>`;

    if (!state.loaded) return html`${head}<div class="${inset}">${skeletonRows(4, 88)}</div>`;

    // Jump bar: both parts of this page, with the one in view marked (updated on scroll in mount()).
    const jump = html`<div class="jumpwrap ${enter ? 'rise' : ''}" style="animation-delay:.05s"><div class="${inset}">${tabs({ label: 'Jump to', options: [['queue', 'Queue', conv.length + queued.length || null], ['activity', 'Activity']], value: ctx.ui.jump || 'queue', act: 'jump', cls: 'jumpbar' })}</div></div>`;
    const banner = review.length ? html`<div class="${rise(0.05)}">${reviewBanner(review, enter, phone)}</div>` : '';
    return html`${head}${jump}
      ${focus && !focusListed ? html`<div class="${inset}">${focusedJob(focus, ctx)}</div>` : ''}
      ${conv.length ? '' : banner}
      ${conv.length ? html`<section class="col gap14 ${inset}${rise(0.1)}">${phone ? html`<span class="eyebrow">Converting</span>` : html`<div class="row"><span class="dot lg dot-ink pulse"></span><h2 class="h2">Converting</h2></div>`}${conv.map(b => converting(b, ctx))}</section>` : ''}
      <section class="col gap8 ${inset}${rise(0.16)}">${queued.length ? html`<h2 class="${phone ? 'eyebrow' : 'h2'}">Up next</h2>` : ''}${upNext(queued, conv.length > 0, ctx)}</section>
      ${conv.length ? banner : ''}
      ${failed.length ? html`<section class="col gap8 ${inset}${rise(0.22)}">
          ${phone ? html`<span class="eyebrow" style="margin-bottom:6px">Didn’t finish · ${failed.length}</span>` : html`<div class="row"><span class="dot lg dot-bad"></span><h2 class="h2">Didn’t finish</h2><span class="meta" style="font-size:15px;font-weight:600">${failed.length}</span></div>`}
          <div class="${phone ? 'col' : 'panel'}" style="${phone ? '' : 'padding:0 8px;overflow:hidden'}">${failed.map(b => failedRow(b, ctx))}</div></section>` : ''}
      <div id="q-activity" class="jumptarget ${inset}${rise(0.3)}">${activity(ctx)}</div>`;
  },

  mount(root, ctx) {
    // Mark the jump bar's current part as the page scrolls (no re-render needed).
    const target = root.querySelector('#q-activity');
    let io = null;
    if (target && typeof IntersectionObserver === 'function') {
      io = new IntersectionObserver(([entry]) => {
        const part = entry.isIntersecting || entry.boundingClientRect.top < 0 ? 'activity' : 'queue';
        ctx.ui.jump = part;
        root.querySelectorAll('.jumpbar .tab').forEach(tab => tab.setAttribute('aria-pressed', String(tab.dataset.arg === part)));
        syncInks(root);
      }, { rootMargin: '0px 0px -55% 0px' });
      io.observe(target);
    }
    const id = ctx.route.query.get('job');
    const focusTimer = id && ctx.enter ? setTimeout(() => { if (ctx.isCurrent?.() !== false) root.querySelector(`#job-${CSS.escape(id)}`)?.scrollIntoView({ block: 'center' }); }) : null;
    return () => { clearTimeout(focusTimer); io?.disconnect(); };
  },

  actions: {
    ...cancelActions,
    jump: (el, ev, ctx) => {
      const part = el.dataset.arg;
      ctx.ui.jump = part;
      document.querySelectorAll('.jumpbar .tab').forEach(tab => tab.setAttribute('aria-pressed', String(tab.dataset.arg === part)));
      syncInks(document.getElementById('view'));
      if (part === 'activity' && !(ctx.ui.open?.activity ?? true)) { ctx.ui.open = { ...(ctx.ui.open || {}), activity: true }; ctx.rerender(); }
      const smooth = document.documentElement.dataset.motion === 'reduce' ? 'auto' : 'smooth';
      if (part === 'activity') document.getElementById('q-activity')?.scrollIntoView({ behavior: smooth, block: 'start' });
      else window.scrollTo({ top: 0, behavior: smooth });
    },
    'ask-cancel': (el, ev, ctx) => askCancel(el.dataset.arg, ctx),
    err: (el, ev, ctx) => { ctx.ui.err = { ...(ctx.ui.err || {}), [el.dataset.arg]: !ctx.ui.err?.[el.dataset.arg] }; ctx.rerender(); },
    'log-filter': (el, ev, ctx) => { ctx.ui.logFilter = el.dataset.arg; ctx.ui.logLimit = LOG_PAGE; ctx.rerender(); },
    'log-more': (el, ev, ctx) => { ctx.ui.logLimit = (ctx.ui.logLimit || LOG_PAGE) + LOG_PAGE; ctx.rerender(); },
  },
};
