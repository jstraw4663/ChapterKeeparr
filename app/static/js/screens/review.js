// Needs review (SCREENS.md → Needs review): What happened → What to do next → Evidence.
// Build-only features with a home here: Finalize with accepted exceptions (G-029),
// Resume checks and Review markers from audio (G-030), diagnostics (G-032).

import { html, bool, clock, relative, folderName, stripAudioExt, minutes } from '../format.js';
import { icon } from '../icons.js';
import { api } from '../api.js';
import { state, refresh, expect, jobDetail, bookById } from '../store.js';
import { reportOf, reviewTitle, reviewDetail } from '../status.js';
import { cover, button, iconButton, menuButton, confirmRow, choices, collapsible, field, selectField, historyList, techDetails, REGIONS, regionName, skeletonRows, emptyState } from '../ui.js';
import { notify } from '../notify.js';
import { historyFor } from '../history.js';
import { readLog } from '../prefs.js';
import { confirmSheet } from '../overlay.js';
import { checksOf, checkTimeline, checkRows, playCheck, durationOf, gatesDetail, technical, alignmentPlot, bestDiagnostics } from './evidence.js';
import { serverButton, offline, OFFLINE_REASON, reportError, cancelActions, cancelJob } from './common.js';

const forms = new Map();     // jobId → form state; survives polling and navigation
const details = new Map();   // jobId → full job record (with recovery_acceptance_preview)
const sources = new Map();   // jobId → current file duration in seconds (G-042)

// What happened, in plain words, per pause reason. The server's own sentence is under "Details from the server".
const HAPPENED = {
  identity: ['We couldn’t tell which edition this is', 'The details in your file didn’t match a published edition closely enough to check the chapters.'],
  chapters: ['The chapters didn’t line up with the edition', 'Your audio was compared with this edition’s published chapter timeline, and they didn’t match closely enough to save.'],
  draft: ['A chapter draft is ready for you', 'ChapterKeeparr listened at each chapter marker already in your file and identified {supported} of {total}. You decide whether to save it.'],
  source_inventory: ['Some source files may be missing', 'The track numbers in the folder have gaps, duplicates or odd totals, so processing stopped before matching.'],
  source_changed: ['The source files changed', 'Files changed while they were being checked, so the results can’t be trusted.'],
  service: ['The metadata service didn’t answer', 'The edition lookup failed. This is usually temporary.'],
  operational: ['Processing stopped', 'Something went wrong while processing this book.'],
};

// When "Run the checks again" is the right choice, per pause reason.
const RESUME = {
  identity: 'Only if something changed outside ChapterKeeparr, like the files. With the same edition, the result will be the same.',
  chapters: 'Only if something changed outside ChapterKeeparr. With the same edition and markers, the result will be the same.',
  source_inventory: 'Fix the folder first (add missing tracks or correct the numbering), then run the checks again.',
  source_changed: 'Once the files have stopped changing, run the checks again from the start.',
  service: 'Try again in a few minutes. Nothing else changes.',
  operational: 'Once the problem is fixed, run the checks again.',
  other: 'Runs the required checks again. Nothing else changes.',
};

const nextRegion = code => { const codes = REGIONS.map(([c]) => c); return codes[(codes.indexOf(code) + 1) % codes.length]; };


const waiting = () => state.books.filter(b => b.status.key === 'review').sort((a, b) => b.updatedAt - a.updatedAt);
const categoryOf = job => job.workflow?.review_category || reportOf(job).review_reason?.category || 'identity';

function formFor(book) {
  if (!forms.has(book.id)) {
    const report = reportOf(book.job);
    const answer = book.job.review_answer || {};
    forms.set(book.id, {
      title: answer.title || book.title, author: answer.author || book.author, narrator: answer.narrator || book.narrators,
      asin: answer.asin || book.asin, region: (answer.region || report.selected_recording?.region || 'us').toLowerCase(),
      query: '', results: null, searching: false, message: '', note: '', selected: null, busy: false,
    });
  }
  return forms.get(book.id);
}

function ensureLoaded(book, ctx) {
  if (!details.has(book.id)) {
    details.set(book.id, null);
    jobDetail(book.id).then(job => { details.set(book.id, job); ctx.rerender(); }).catch(() => details.delete(book.id));
  }
  if (!sources.has(book.id)) {
    sources.set(book.id, null);
    api.sourceInfo(book.id).then(info => { sources.set(book.id, info.duration_seconds); ctx.rerender(); }).catch(() => {});
  }
}

// ---------- sections ----------
function header(book, list, idx, ctx) {
  const pos = list.length ? `${idx + 1} of ${list.length}` : '';
  const eyebrow = book.series ? `${book.series}${book.seriesPos ? ` · Book ${book.seriesPos}` : ''}` : book.author || 'Author unknown';
  const nav = html`<span class="meta tabular" style="font-size:14px;margin-right:4px">${pos}</span>
    ${iconButton({ icon: 'chevronUp', label: 'Previous book', act: 'prev', disabled: idx <= 0, cls: ctx.phone ? 'picon' : 'icb' })}
    ${iconButton({ icon: 'chevronDown', label: 'Next book', act: 'next', disabled: idx >= list.length - 1, cls: ctx.phone ? 'picon' : 'icb' })}`;
  if (ctx.phone) {
    return html`<div class="back-head"><a class="textlink" href="#/review" style="color:var(--ink);font-size:16px">${icon('chevronLeft', 22)}Review</a><div class="row" style="gap:0">${nav}${iconButton({ icon: 'trash', label: 'Cancel job', act: 'phone-cancel', cls: 'picon', disabled: offline(), disabledReason: OFFLINE_REASON })}</div></div>
      <div class="row gap14 page-pad">${cover(book, { size: 84, radius: 12, cls: 'shadow' })}<div class="col gap4"><span class="eyebrow" style="font-size:11px">${eyebrow}</span><h1 class="h1" style="font-size:22px;line-height:1.1;letter-spacing:-.02em" tabindex="-1">${book.title}</h1><span class="meta">${book.author || 'Author unknown'}</span></div></div>`;
  }
  const confirming = ctx.ui.confirm === `cancel:${book.id}`;
  return html`<div class="revhead">${cover(book, { size: 132, radius: 14, cls: 'shadow' })}<div class="col gap8 grow"><span class="eyebrow">${eyebrow}</span><h2>${book.title}</h2><p class="lede" style="font-size:15px">${book.author || 'Author unknown'}${book.narrators ? ` · Narrated by ${book.narrators}` : ''}</p></div><div class="row gap8" style="flex-shrink:0">${nav}${iconButton({ icon: 'trash', label: 'Cancel job', act: 'desk-cancel', disabled: offline(), disabledReason: OFFLINE_REASON })}</div></div>
    ${confirming ? confirmRow({ question: 'Cancel this job? Source files stay put.', keepAct: 'confirm-keep', confirmAct: 'confirm-cancel', confirmLabel: 'Cancel job', arg: book.id }) : ''}`;
}

/** Which situation the book is in; drives the wording and the choices offered. */
function situation(book) {
  const category = categoryOf(book.job);
  const p = details.get(book.id)?.recovery_acceptance_preview;
  if (category === 'chapters' && p?.ready) return { key: 'draft', category, preview: p };
  return { key: category, category, preview: p };
}

/** "What happened": plain words, the facts that matter, and one Details link for the rest. */
function whatHappened(book, form, sit, ctx) {
  const job = book.job;
  const [title, text] = HAPPENED[sit.key] || [reviewTitle(job), reviewDetail(job)];
  const p = sit.preview;
  const said = text.replace('{supported}', p?.supported ?? '—').replace('{total}', p?.total ?? '—');
  const rows = checksOf(job);
  const facts = [];
  if (form.asin && (sit.key === 'chapters' || sit.key === 'draft')) facts.push(['Edition', `${reportOf(job).edition?.title || book.title} · ${form.asin} · ${regionName(form.region)}`]);
  if (rows.length && sit.key !== 'draft') facts.push([rows[0].draft ? 'Markers identified' : 'Chapter checks', `${rows.filter(r => r.passed).length} of ${rows.length} ${rows[0].draft ? 'heard' : 'passed'}`]);
  const diag = bestDiagnostics(job);
  const serverSaid = reviewDetail(job);
  const more = html`${serverSaid ? html`<p style="font-size:14px;line-height:1.55;margin:8px 0 0">${serverSaid}</p>` : ''}
    ${techDetails(technical(job))}${diag ? html`<details class="tech"><summary>Timing diagnostics</summary>${alignmentPlot(diag)}</details>` : ''}<details class="tech"><summary>Checks the server ran</summary><div style="margin-top:10px">${gatesDetail(job)}</div></details>`;
  return html`<section class="alert-warn happened ${ctx.phone ? 'page-inset' : ''}" aria-labelledby="problem-${book.id}">
    ${ctx.phone ? '' : html`<span class="icon">${icon('alert', 22)}</span>`}
    <div class="col gap10 grow" style="min-width:0">
      <span class="eyebrow" style="color:var(--warn)">What happened</span>
      <span id="problem-${book.id}" style="font-size:17px;font-weight:750;letter-spacing:-.01em">${title}</span>
      <span style="font-size:15px;line-height:1.55">${said} Nothing was saved and your file hasn’t changed.</span>
      ${facts.length ? html`<dl class="facts">${facts.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>` : ''}
      <details class="tech more"><summary>Details from the server</summary><div class="col gap8">${more}</div></details>
    </div></section>`;
}

/** "What to do next": a short list of choices, each explaining itself, one open at a time, one button each. */
function nextSteps(book, form, sit, ctx) {
  const p = sit.preview;
  const options = [];
  if (sit.key === 'draft') {
    options.push({ id: 'finalize', title: 'Save using the draft', desc: `Keeps the chapter times already in your file and applies the ${p.supported} names that were identified. You confirm each exception first.`, body: finalizeBody(book, p, ctx) });
  }
  if (sit.category === 'chapters') {
    options.push({ id: 'draft', title: sit.key === 'draft' ? 'Draft the chapters again' : 'Draft chapters from the audio', desc: 'For when this is the right edition but the chapter markers are off. ChapterKeeparr listens at each marker already in your file and drafts names. Your file isn’t changed.', body: draftBody(book, form) });
  }
  if (sit.category === 'chapters' || sit.category === 'identity') {
    options.push({ id: 'edition', title: sit.category === 'identity' ? 'Choose the right edition' : 'Choose a different edition', desc: sit.category === 'identity' ? 'Search by title or ASIN, pick the edition you have, and the checks run again.' : 'If this isn’t the edition you have, pick the right one and the checks run again.', body: editionBody(book, form, ctx) });
  }
  options.push({ id: 'resume', title: 'Run the checks again', desc: RESUME[sit.category] || RESUME.other, body: html`<div>${serverButton({ label: 'Run checks again', kind: 'primary', act: 'resume', size: 'md' })}</div>` });

  const chosen = ctx.ui.path?.[book.id] ?? (ctx.route.query.has('match') ? 'edition' : undefined);
  const open = options.some(o => o.id === chosen) ? chosen : options[0].id;
  const heading = html`<h2 class="eyebrow" style="padding:0 4px">What to do next</h2>`;
  if (options.length === 1) {
    const [only] = options;
    return html`<section class="col gap8 ${ctx.phone ? 'page-inset' : ''}" aria-label="What to do next">${heading}<div class="panel col gap12" style="padding:18px"><span class="meta" style="font-size:14px">${only.desc}</span>${only.body}</div></section>`;
  }
  return html`<section class="col gap8 ${ctx.phone ? 'page-inset' : ''}" aria-label="What to do next">${heading}${choices({ label: 'What to do next', act: 'choose', open, items: options })}</section>`;
}

function draftBody(book, form) {
  if (!form.asin) {
    return html`<p class="meta" style="font-size:14px">This needs the edition’s ASIN, and none is set yet. Choose the edition first.</p><div>${button({ label: 'Choose an edition', act: 'choose', arg: 'edition', size: 'md' })}</div>`;
  }
  return html`<p class="meta" style="font-size:14px">Uses ${form.asin} (${regionName(form.region)}). The book goes back to the queue for a few minutes and returns here with the draft for you to review.</p>
    ${form.message ? html`<p class="alert-bad" role="alert">${form.message}</p>` : ''}
    <div>${serverButton({ label: form.busy ? 'Starting…' : 'Draft chapters', kind: 'primary', act: 'markers', size: 'md', disabled: form.busy, disabledReason: 'Working…' })}</div>`;
}

function editionResults(form) {
  if (form.searching) return html`<p class="meta" role="status">Searching editions…</p>`;
  if (!form.results) return '';
  if (!form.results.length) return html`<p class="meta" role="status">No editions found. Try another title, ASIN or region.</p>`;
  return html`<div class="edresults" role="list" aria-label="Edition results">${form.results.map((e, i) => html`<button type="button" class="edrow" role="listitem" data-act="pick-edition" data-arg="${i}" aria-pressed="${bool(form.selected === i)}">
    ${e.cover_url ? html`<img alt="" loading="lazy" referrerpolicy="no-referrer" src="${e.cover_url}">` : html`<span class="cover" style="width:52px;height:52px;border-radius:8px"></span>`}
    <span class="col gap4"><span style="font-weight:700" class="clamp2">${e.title || 'Untitled edition'}</span><span class="meta ell">${(e.authors || []).map(a => a.name).join(', ') || 'Author unknown'}${e.narrators?.length ? ` · ${e.narrators.map(n => n.name).join(', ')}` : ''}</span><span class="meta">${[e.runtime_length_min ? `${Math.round(e.runtime_length_min).toLocaleString()} min` : '', e.publisher_name, e.language].filter(Boolean).join(' · ')}</span></span>
    <span class="mono meta">${e.asin}</span></button>`)}</div>`;
}

function editionBody(book, form, ctx) {
  const seconds = sources.get(book.id);
  const identity = reportOf(book.job).identity || {};
  const embedded = identity.asin && identity.asin !== form.asin ? identity.asin : '';
  return html`<form class="col gap14" data-form="fix">
    ${seconds ? html`<p class="meta" style="font-size:14px">Your file runs ${minutes(seconds)}. Pick the edition whose runtime matches.</p>` : ''}
    <div class="row gap8">
      <div class="inputwrap grow"><label for="rv-find" class="sr">Search editions by title or ASIN</label><span class="icon">${icon('search', 18)}</span><input id="rv-find" class="input" type="search" style="height:48px;border-radius:14px" placeholder="${ctx.phone ? 'Search editions' : 'Search editions by title or ASIN'}" value="${form.query}" enterkeyhint="search" autocomplete="off"></div>
      ${menuButton({ id: 'rv-fill', label: 'Fill the search from this book', text: ctx.phone ? '' : 'Fill from', open: ctx.ui.menu === 'rv-fill', items: [
        { label: 'Use filename', icon: 'file', act: 'use-filename' },
        { label: 'Use tags', icon: 'tag', act: 'use-tags' },
      ] })}
      ${ctx.phone
        ? iconButton({ icon: 'search', label: 'Search editions', act: 'find', cls: 'icb solid', disabled: form.searching })
        : button({ label: form.searching ? 'Searching…' : 'Search', icon: 'search', act: 'find', disabled: form.searching, extra: { style: 'height:44px' } })}
    </div>
    ${editionResults(form)}
    <div class="row gap16 wrap"><button type="button" class="textlink" data-act="next-region">Try the ${regionName(nextRegion(form.region))} store</button>${embedded ? html`<button type="button" class="textlink" data-act="use-embedded">Use the ID in the file (${embedded})</button>` : ''}</div>
    ${form.note ? html`<p class="note opened" role="status">${form.note}</p>` : ''}
    <details class="tech plain" ${form.selected == null && !form.asin ? 'open' : ''}><summary>Edition details${form.asin ? `: ${form.asin} · ${regionName(form.region)}` : ''}</summary>
      <div class="col gap14" style="margin-top:12px"><div class="formgrid">
        ${field({ id: 'rv-title', label: 'Title', value: form.title })}
        ${field({ id: 'rv-author', label: 'Author', value: form.author })}
        ${field({ id: 'rv-asin', label: 'ASIN', value: form.asin, placeholder: 'Leave empty to search by title', extra: { maxlength: 10, autocapitalize: 'characters' } })}
        ${selectField({ id: 'rv-region', label: 'Region', options: REGIONS, value: form.region })}
      </div>${field({ id: 'rv-narrator', label: 'Narrators', value: form.narrator })}</div></details>
    ${form.message ? html`<p class="alert-bad" role="alert">${form.message}</p>` : ''}
    <div class="col gap8"><div>${serverButton({ label: form.busy ? 'Saving…' : 'Save and re-verify', kind: 'primary', size: 'md', act: 'save', disabled: form.busy, disabledReason: 'Working…' })}</div><span class="meta">The checks run again against this edition. Nothing is saved unless they pass.</span></div>
  </form>`;
}

function finalizeBody(book, p, ctx) {
  const f = ctx.ui.accept?.[book.id] || {};
  return html`<form class="accept" data-form="accept">
      <p style="font-size:14px">That’s ${p.supported_percent.toFixed(1)}% of the markers. Nothing is moved and no missing chapter is invented. You can listen to what was heard under Chapter checks below.</p>
      ${field({ id: 'accept-min', label: 'Minimum identified markers for this book (%)', type: 'number', value: f.min ?? p.default_minimum_percent, hint: `Default from Settings: ${p.default_minimum_percent}%. Applies to this book only.`, extra: { min: 1, max: 100, step: 0.1, inputmode: 'decimal' } })}
      ${p.sections.length ? html`<div class="col"><span style="font-size:14px;font-weight:650">Sections that couldn’t be located</span><span class="meta">Tick each one to accept it as optional for this book. Named chapters aren’t assumed optional.</span>${p.sections.map(s => html`<label class="checkbox"><input type="checkbox" name="optional_section" value="${s.id}" ${f.sections?.includes(s.id) ? 'checked' : ''}><span>Accept “${s.title}” as optional</span></label>`)}</div>` : ''}
      ${p.unresolved_markers.length ? html`<details class="tech"><summary>${p.unresolved_markers.length} original ${p.unresolved_markers.length === 1 ? 'marker keeps' : 'markers keep'} its name and time</summary><ul class="meta" style="margin:8px 0 0;padding-left:18px">${p.unresolved_markers.map(m => html`<li>${m.index}. ${m.title} · ${clock(m.seconds)}</li>`)}</ul></details><label class="checkbox"><input type="checkbox" name="preserve" ${f.preserve ? 'checked' : ''}><span>Keep these unidentified markers as they are</span></label>` : ''}
      ${p.coverage_warnings.length ? html`<div class="col gap4"><span style="font-size:14px;font-weight:650">Content coverage</span>${p.coverage_warnings.map(w => html`<span class="meta">${w}</span>`)}</div>` : ''}
      <label class="checkbox"><input type="checkbox" name="gap" ${f.gap ? 'checked' : ''}><span>I accept possible content gaps or edition differences in this recording. Matching chapters doesn’t prove the audio is complete.</span></label>
      <p class="meta">The audio must be unchanged and the output must validate. An existing M4B is backed up first. Source MP3s are kept.</p>
      ${f.message ? html`<p class="note" role="status">${f.message}</p>` : ''}
      <div>${serverButton({ label: 'Accept and save', kind: 'primary', act: 'accept', size: 'md', disabled: f.busy, disabledReason: 'Working…' })}</div></form>`;
}

function checksSection(book, ctx) {
  const rows = checksOf(book.job);
  const passed = rows.filter(r => r.passed).length;
  const summary = rows.length ? `${passed} of ${rows.length} ${rows[0].draft ? 'heard' : 'passed'}` : 'Not run yet';
  const body = rows.length
    ? html`<div class="col gap14" style="padding-bottom:8px">${ctx.phone ? '' : checkTimeline(rows, durationOf(book.job, sources.get(book.id)))}${checkRows(book.job, rows, ctx)}</div>`
    : html`<p class="gapnote" style="margin-bottom:12px">Chapter checks haven’t run yet. They start once the edition is confirmed.</p>`;
  return collapsible({ id: 'checks', title: 'Chapter checks', summary, open: ctx.ui.open?.checks ?? false, body });
}

function historySection(book, ctx) {
  const entries = historyFor(details.get(book.id) || book.job, readLog());
  return collapsible({ id: 'history', title: 'History', summary: ctx.phone ? '' : 'Everything recorded for this book', open: ctx.ui.open?.history ?? false, body: html`${historyList(entries)}<p class="meta" style="padding:6px 0 12px">Built from what the server records today. A full event history needs server support. <span class="mono">(G-011)</span></p>` });
}

function detail(book, list, idx, ctx) {
  ensureLoaded(book, ctx);
  const form = formFor(book);
  const sit = situation(book);
  const inset = ctx.phone ? 'page-inset' : '';
  return html`<div class="col ${ctx.phone ? 'gap16' : 'gap20'} ${ctx.enter ? (ctx.phone ? 'pushin' : 'rise') : ''}" style="animation-delay:.12s;min-width:0">
    ${header(book, list, idx, ctx)}
    ${whatHappened(book, form, sit, ctx)}
    ${nextSteps(book, form, sit, ctx)}
    <div class="col ${ctx.phone ? 'gap12' : 'gap16'} ${inset}" style="margin-top:8px"><h2 class="eyebrow" style="padding:0 4px">Evidence</h2>${checksSection(book, ctx)}${historySection(book, ctx)}</div>
  </div>`;
}

function listItem(book, current, ctx) {
  const reason = reviewTitle(book.job);
  if (ctx.phone) return html`<a class="mrow" href="#/review/${encodeURIComponent(book.id)}">${cover(book, { size: 56, radius: 10 })}<span class="col gap4 grow"><span class="ell" style="font-size:16px;font-weight:700">${book.title}</span><span class="meta ell">${reason} · ${relative(book.updatedAt)}</span></span><span class="muted icon">${icon('chevronRight', 18)}</span></a>`;
  return html`<a class="irow" role="listitem" href="#/review/${encodeURIComponent(book.id)}" aria-current="${bool(current)}">${cover(book, { size: 52, radius: 9 })}<span class="col gap4 grow"><span class="ell" style="font-size:15px;font-weight:700">${book.title}</span><span class="meta ell">${reason}</span></span><span class="meta tabular" style="font-size:12px;flex-shrink:0">${relative(book.updatedAt)}</span></a>`;
}

function allClear(ctx) {
  return html`<div class="panel bigempty ${ctx.phone ? 'page-inset' : ''} ${ctx.enter ? 'rise' : ''}"><span class="circ tone-ok">${icon('check', 26, { stroke: 2.2 })}</span><span class="t">You’re all caught up</span><span class="lede" style="font-size:15px">Nothing needs your review right now.</span>${button({ label: 'Open queue', href: '#/queue' })}</div>`;
}

function resumedPanel(book, list, ctx) {
  return html`<div class="panel bigempty ${ctx.enter ? 'rise' : ''}" style="animation-delay:.1s"><span class="circ tone-ok">${icon('check', 26, { stroke: 2.2 })}</span><span class="t">${book ? `${book.title} is back in the queue` : 'Sent back to the queue'}</span><span class="lede" style="font-size:15px">Nothing is saved until its checks pass. If it needs you again, it comes back here.</span><div class="row gap8" style="flex-wrap:wrap;justify-content:center">${book ? button({ label: 'Watch in queue', href: `#/queue?job=${encodeURIComponent(book.id)}` }) : ''}${button({ label: 'Review next', kind: 'primary', href: `#/review/${encodeURIComponent(list[0].id)}`, iconEnd: 'arrowRight' })}</div></div>`;
}

// ---------- actions ----------
function current(ctx) {
  const list = waiting();
  const id = ctx.route.id;
  const book = id ? bookById(id) : list[0];
  return { list, book, idx: book ? list.findIndex(b => b.id === book.id) : -1 };
}

function readForm(book) {
  const form = formFor(book);
  for (const [key, id] of [['title', 'rv-title'], ['author', 'rv-author'], ['asin', 'rv-asin'], ['region', 'rv-region'], ['narrator', 'rv-narrator'], ['query', 'rv-find']]) {
    const el = document.getElementById(id);
    if (el) form[key] = el.value;
  }
  return form;
}

/**
 * A book left Needs review and went back to the queue: tell the user (the
 * notification opens it in the Queue) and return to the list rather than
 * jumping to the next book.
 */
function sentToQueue(book, body) {
  notify({ kind: 'info', title: `${book.title} is back in the queue`, body, action: 'Watch', href: `#/queue?job=${encodeURIComponent(book.id)}`, dest: 'queue', jobId: book.id, at: Date.now() });
  location.hash = `#/review?resumed=${encodeURIComponent(book.id)}`;
}

async function submit(book, ctx, recovery) {
  const form = readForm(book);
  form.message = '';
  const asin = form.asin.trim().toUpperCase();
  if (asin && !/^[A-Z0-9]{10}$/.test(asin)) { form.message = 'ASIN must be 10 letters or digits.'; ctx.rerender(); return; }
  if (recovery === 'local_markers' && !asin) { form.message = 'Enter the ASIN of a matching edition before reviewing markers.'; ctx.rerender(); return; }
  form.busy = true; ctx.rerender();
  try {
    await api.answerReview(book.id, { title: form.title, author: form.author, narrator: form.narrator, asin, region: form.region, recovery });
    expect(book.id, 'queued');
    forms.delete(book.id); details.delete(book.id);
    await refresh();
    sentToQueue(book, recovery === 'local_markers' ? 'Listening near each marker for a draft' : 'Re-checking chapter audio with your changes');
  } catch (error) {
    form.busy = false; form.message = error.message; ctx.rerender();
  }
}

async function searchEditions(book, ctx) {
  const form = readForm(book);
  const q = form.query.trim();
  if (q.length < 2) { form.message = 'Enter a title or ASIN to search.'; ctx.rerender(); return; }
  form.searching = true; form.results = null; form.selected = null; form.message = ''; ctx.rerender();
  try {
    const data = await api.editions(q, form.region);
    form.results = data.editions || [];
  } catch (error) { form.results = null; form.message = error.message; }
  form.searching = false; ctx.rerender();
}

/** Open one "What to do next" choice for this book (they're exclusive). */
const choose = (ctx, book, id) => { ctx.ui.path = { ...(ctx.ui.path || {}), [book.id]: id }; };

const move = (ctx, delta) => {
  const { list, idx } = current(ctx);
  const target = list[idx + delta];
  if (target) location.hash = `#/review/${encodeURIComponent(target.id)}`;
};

export default {
  title: 'Needs review',
  topbar: true,
  detail: ctx => Boolean(ctx.phone && ctx.route.id),

  signature(ctx) {
    const { book } = current(ctx);
    const audioKey = book ? JSON.stringify(ctx.ui) + (details.get(book.id) ? 'd' : '') + (sources.get(book.id) || '') : '';
    return [state.loaded, state.connected, state.sig, ctx.route.id, audioKey, book && JSON.stringify(forms.get(book.id) || {})].join('|');
  },

  render(ctx) {
    const { phone, enter } = ctx;
    const { list, book, idx } = current(ctx);
    if (!state.loaded) return html`<div class="${phone ? 'page-inset' : ''}">${skeletonRows(5, 72)}</div>`;
    if (ctx.route.id && !book) return emptyState({ title: 'This book isn’t waiting for review', body: 'It may have been resumed or cancelled.', action: button({ label: 'Open queue', href: '#/queue' }) });
    if (ctx.route.id && book && book.status.key !== 'review') {
      return html`<div class="${phone ? 'page-inset' : ''}">${emptyState({ title: `${book.title} is no longer waiting`, body: book.status.detail, action: button({ label: 'Open', href: book.status.key === 'verified' || book.status.key === 'optimized' ? `#/books/${encodeURIComponent(book.id)}` : `#/queue?job=${encodeURIComponent(book.id)}` }) })}</div>`;
    }
    const heading = phone
      ? html`<div class="page-pad ${enter ? 'rise' : ''}"><h1 class="h1" tabindex="-1">Needs review</h1><p class="meta" style="margin-top:4px;font-size:14px">${list.length ? `${list.length} ${list.length === 1 ? 'book' : 'books'} paused for a decision` : 'Nothing waiting'}</p></div>`
      : html`<div class="page-head ${enter ? 'rise' : ''}"><h1 class="h1" tabindex="-1">Needs review</h1><p class="lede">Books paused because something couldn’t be confirmed. Work through them one at a time.</p></div>`;
    if (phone) {
      if (ctx.route.id) return detail(book, list, idx, ctx);
      return html`<div style="height:0"></div>${heading}${list.length ? html`<div class="col page-inset ${enter ? 'rise' : ''}">${list.map(b => listItem(b, false, ctx))}</div>` : allClear(ctx)}`;
    }
    if (!list.length) return html`${heading}${allClear(ctx)}`;
    const resumed = !ctx.route.id && ctx.route.query.get('resumed');
    if (resumed) return html`${heading}<div class="revgrid"><div class="revlist ${enter ? 'rise' : ''}" role="list" aria-label="Books waiting for review" style="animation-delay:.05s">${list.map(b => listItem(b, false, ctx))}</div>${resumedPanel(bookById(resumed), list, ctx)}</div>`;
    return html`${heading}<div class="revgrid"><div class="revlist ${enter ? 'rise' : ''}" role="list" aria-label="Books waiting for review" style="animation-delay:.05s">${list.map(b => listItem(b, b.id === book.id, ctx))}</div>${detail(book, list, idx, ctx)}</div>`;
  },

  onInput(el, ev, ctx) {
    const { book } = current(ctx);
    if (!book) return;
    if (el.name === 'optional_section' || el.name === 'preserve' || el.name === 'gap' || el.id === 'accept-min') {
      const form = el.closest('form');
      ctx.ui.accept = { ...(ctx.ui.accept || {}), [book.id]: { ...(ctx.ui.accept?.[book.id] || {}), min: form.querySelector('#accept-min')?.value, sections: [...form.querySelectorAll('[name="optional_section"]:checked')].map(x => x.value), preserve: form.querySelector('[name="preserve"]')?.checked, gap: form.querySelector('[name="gap"]')?.checked } };
      return;
    }
    readForm(book);
  },

  onSubmit(form, ev, ctx) {
    const { book } = current(ctx);
    if (!book) return;
    if (form.dataset.form === 'fix') {
      if (document.activeElement?.id === 'rv-find') searchEditions(book, ctx); else submit(book, ctx, 'verify');
    }
  },

  mount(root, ctx) {
    const find = root.querySelector('#rv-find');
    // Re-renders keep this element (morph.js), so assign rather than add a listener.
    if (find) find.onkeydown = ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); const { book } = current(ctx); if (book) searchEditions(book, ctx); }
    };
    if (ctx.enter && ctx.route.query.has('match')) setTimeout(() => find?.focus());
  },

  actions: {
    ...cancelActions,
    choose: (el, ev, ctx) => { const { book } = current(ctx); if (book) { choose(ctx, book, el.dataset.arg); ctx.rerender(); } },
    prev: (el, ev, ctx) => move(ctx, -1),
    next: (el, ev, ctx) => move(ctx, 1),
    'check-open': (el, ev, ctx) => { const n = Number(el.dataset.arg); ctx.ui.check = ctx.ui.check === n ? null : n; ctx.rerender(); },
    'check-play': (el, ev, ctx) => { const { book } = current(ctx); if (book) playCheck(book.job, el.dataset.arg, checksOf(book.job)).catch(error => reportError(error, 'Couldn’t play this check')); },
    'next-region': (el, ev, ctx) => {
      const { book } = current(ctx); if (!book) return;
      const form = readForm(book);
      const from = form.region;
      form.region = nextRegion(from);
      form.note = `Region changed from ${regionName(from)} to ${regionName(form.region)}. Search again, or Save and re-verify to try it.`;
      choose(ctx, book, 'edition');
      ctx.rerender();
    },
    'use-embedded': (el, ev, ctx) => {
      const { book } = current(ctx); if (!book) return;
      const form = readForm(book);
      const asin = reportOf(book.job).identity?.asin;
      if (!asin) return;
      form.note = `ASIN changed from ${form.asin || 'empty'} to ${asin}, the ID embedded in the file.`;
      form.asin = asin;
      choose(ctx, book, 'edition');
      ctx.rerender();
    },
    'use-filename': (el, ev, ctx) => {
      const { book } = current(ctx); if (!book) return;
      const form = readForm(book);
      form.query = stripAudioExt(folderName(book.path)).replace(/^\d+[.\s_-]+/, '');
      form.note = 'Filled the search from the filename. Edit it if needed, then search.';
      ctx.rerender();
      setTimeout(() => document.getElementById('rv-find')?.focus());
    },
    'use-tags': (el, ev, ctx) => {
      // DESIGN-GAP: G-014 — raw embedded tags aren't exposed; report.identity mixes tags, EPUB and answers.
      const { book } = current(ctx); if (!book) return;
      const form = readForm(book);
      const id = reportOf(book.job).identity || {};
      form.title = id.title || form.title; form.author = id.author || form.author; form.narrator = id.narrator || form.narrator; form.asin = id.asin || form.asin;
      form.query = id.asin || id.title || form.query;
      form.note = 'Filled from the file’s details as the server read them (tags, EPUB or earlier answers). Edit the search if needed, then search. Raw tags need server support (G-014).';
      ctx.rerender();
      setTimeout(() => document.getElementById('rv-find')?.focus());
    },
    'pick-edition': (el, ev, ctx) => {
      const { book } = current(ctx); if (!book) return;
      const form = readForm(book);
      const e = form.results?.[Number(el.dataset.arg)];
      if (!e) return;
      form.selected = Number(el.dataset.arg);
      form.asin = e.asin; form.title = e.title || form.title;
      form.author = (e.authors || []).map(a => a.name).join(', ') || form.author;
      form.narrator = (e.narrators || []).map(n => n.name).join(', ') || form.narrator;
      form.region = e.region || form.region;
      form.note = `${e.title || e.asin} selected. It’s checked against your audio when you save.`;
      ctx.rerender();
    },
    find: (el, ev, ctx) => { const { book } = current(ctx); if (book) searchEditions(book, ctx); },
    save: (el, ev, ctx) => { const { book } = current(ctx); if (book) submit(book, ctx, 'verify'); },
    markers: (el, ev, ctx) => { const { book } = current(ctx); if (book) submit(book, ctx, 'local_markers'); },
    resume: async (el, ev, ctx) => {
      const { book } = current(ctx); if (!book) return;
      try {
        await api.resumeChecks(book.id);
        expect(book.id, 'queued');
        await refresh();
        sentToQueue(book, 'Running the required checks again');
      } catch (error) { reportError(error, 'Couldn’t resume checks'); }
    },
    accept: async (el, ev, ctx) => {
      const { book } = current(ctx); if (!book) return;
      const p = details.get(book.id)?.recovery_acceptance_preview;
      const f = { ...(ctx.ui.accept?.[book.id] || {}) };
      if (!p) return;
      const min = Number(f.min ?? p.default_minimum_percent);
      const missing = p.sections.filter(s => !(f.sections || []).includes(s.id));
      const problemText = !(min >= 1 && min <= 100) ? 'The minimum must be between 1 and 100%.'
        : missing.length ? `Tick each section you accept as optional (${missing.map(s => s.title).join(', ')}).`
          : p.unresolved_markers.length && !f.preserve ? 'Confirm that unresolved markers keep their labels and times.'
            : !f.gap ? 'Confirm that you accept possible content gaps.' : '';
      const setAccept = patch => { ctx.ui.accept = { ...(ctx.ui.accept || {}), [book.id]: { ...f, ...patch } }; ctx.rerender(); };
      if (problemText) { setAccept({ message: problemText }); return; }
      setAccept({ busy: true, message: '' });
      try {
        await api.acceptRecovery(book.id, { draft_token: p.token, minimum_percent: min, optional_sections: f.sections || [], preserve_unresolved: Boolean(f.preserve), accept_possible_gap: true });
        expect(book.id, 'queued');
        details.delete(book.id);
        await refresh();
        sentToQueue(book, 'Exceptions accepted; finalizing now');
      } catch (error) { setAccept({ busy: false, message: error.message }); }
    },
    'desk-cancel': (el, ev, ctx) => { const { book } = current(ctx); if (book) { ctx.ui.confirm = `cancel:${book.id}`; ctx.rerender(); } },
    'phone-cancel': async (el, ev, ctx) => {
      const { book } = current(ctx); if (!book) return;
      const ok = await confirmSheet({ title: 'Cancel this job?', body: `${book.title} leaves the queue. Your source files stay where they are.`, confirmLabel: 'Cancel job' });
      if (ok) { await cancelJob(book.id); location.hash = '#/review'; }
    },
  },
};
