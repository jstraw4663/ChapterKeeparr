// Needs review (SCREENS.md → Needs review): What happened → What to do next → Evidence.
// Build-only features with a home here: Finalize with accepted exceptions (G-029),
// Resume checks and Review markers from audio (G-030), diagnostics (G-032).

import { html, raw, bool, relative, folderName, stripAudioExt, minutes, transcriptPreview } from '../format.js';
import { icon } from '../icons.js';
import { api } from '../api.js';
import * as audio from '../audio.js';
import { state, refresh, expect, jobDetail, bookById, touch } from '../store.js';
import { reportOf, reviewTitle, reviewDetail } from '../status.js';
import { cover, button, iconButton, menuButton, confirmRow, choices, collapsible, field, selectField, historyList, techDetails, REGIONS, regionName, skeletonRows, emptyState } from '../ui.js';
import { notify } from '../notify.js';
import { historyFor } from '../history.js';
import { readLog } from '../prefs.js';
import { loadDraft, saveDraft, clearDraft, acceptedDraft, publishedSeconds } from '../review-drafts.js';
import { markerDecisions, remainingSections, assignmentIssue, recommendations, reviewModel, applyChoice, clearChoice, nextOpen, timelineEnd, hms, percentText, KIND } from '../chapter-review.js';
import { glideTo, glideToTop } from '../scroll.js';
import { confirmSheet } from '../overlay.js';
import { checksOf, checkTimeline, checkRows, playCheck, durationOf, gatesDetail, technical, alignmentPlot, bestDiagnostics } from './evidence.js';
import { serverButton, offline, OFFLINE_REASON, reportError, cancelActions, cancelJob } from './common.js';

const forms = new Map();     // jobId → form state; survives polling and navigation
const details = new Map();   // jobId → full job record (with recovery_acceptance_preview)
const sources = new Map();   // jobId → current file duration in seconds (G-042)
let selectedBook = loadDraft('selection')?.id;

function persist(book, ctx) {
  const form = forms.get(book.id) || {};
  const fields = Object.fromEntries(['title', 'author', 'narrator', 'asin', 'region', 'query'].map(k => [k, form[k]]));
  const saved = saveDraft(book.id, { accept: ctx.ui.accept?.[book.id] || loadDraft(book.id)?.accept, fields });
  ctx.ui.localDraftWarning = saved ? '' : 'Browser storage is unavailable. Edits are retained in this tab only; keep it open until you save.';
}

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
      ...(loadDraft(book.id)?.fields || {}),
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
      <div class="row gap14 page-pad">${cover(book, { size: 84, radius: 12, cls: 'shadow' })}<div class="col gap4"><span class="eyebrow" style="font-size:11px">${eyebrow}</span><h1 class="h1" style="font-size:22px;line-height:1.1;letter-spacing:-.02em" tabindex="-1" data-vt-title="${book.id}">${book.title}</h1><span class="meta">${book.author || 'Author unknown'}</span></div></div>`;
  }
  const confirming = ctx.ui.confirm === `cancel:${book.id}`;
  return html`<div class="revhead">${cover(book, { size: 132, radius: 14, cls: 'shadow' })}<div class="col gap8 grow"><span class="eyebrow">${eyebrow}</span><h2 data-vt-title="${book.id}">${book.title}</h2><p class="lede" style="font-size:15px">${book.author || 'Author unknown'}${book.narrators ? ` · Narrated by ${book.narrators}` : ''}</p></div><div class="row gap8" style="flex-shrink:0">${nav}${iconButton({ icon: 'trash', label: 'Cancel job', act: 'desk-cancel', disabled: offline(), disabledReason: OFFLINE_REASON })}</div></div>
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
    options.push({ id: 'finalize', title: 'Review and save the draft', desc: `Review the ${p.supported} identified names, keep or edit existing names, and optionally remove navigation markers. Audio stays unchanged.`, body: finalizeBody(book, p, ctx) });
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
  if (open !== 'finalize') phoneBars.delete(book.id);
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

// ---------- chapter draft review (CHAPTER_REVIEW.md) ----------
// Ordered cards for what needs a decision; a decided card collapses in place
// into a one-line row. The decision logic is pure (chapter-review.js).
const CLOSE_MS = 300;        // chosen option fills, the card collapses, then the decision commits
const GROW_MS = 300;         // Change reopens a card
const closing = new Map();   // item id → { book, choice, key } while collapsing
const cardUi = new Map();    // `${book}:${item}` → { rename, name, search, q, out }
const shown = new Map();     // book id → open cards rendered so far (very large books)
const phoneBars = new Map(); // book id → phone save bar, while the draft choice is open
let focusedItem = null;      // highlighted by auto-advance, a timeline tick or Next open
let growing = null;          // reopening via Change
let moreObserver = null;
const reduceMotion = () => document.documentElement.dataset.motion === 'reduce';
const itemEl = id => document.getElementById(`cr-item-${id}`);
const uiFor = (book, id) => cardUi.get(`${book.id}:${id}`) || {};
const setCardUi = (book, id, patch) => cardUi.set(`${book.id}:${id}`, { ...uiFor(book, id), ...patch });
/** Where focus lands in a card: its first option, else its first usable button (Change on a row). */
const focusTarget = el => el && (el.querySelector('.opt') || el.querySelector('.cr-change, button:not([disabled])') || el);
const glideOpts = ctx => (ctx.phone ? { top: 76, bar: '.cr-pbar' } : { top: 96, bar: '.savebar' });

/** The book's draft state, reset when the server's draft token changes. */
function draftFor(book, p, ctx) {
  if (ctx.ui.accept?.[book.id]?.token !== p.token) {
    ctx.ui.accept = { ...(ctx.ui.accept || {}), [book.id]: acceptedDraft(book.id, p.token) };
  }
  return ctx.ui.accept[book.id];
}

function setDraft(book, ctx, f) {
  ctx.ui.accept = { ...(ctx.ui.accept || {}), [book.id]: f };
  persist(book, ctx);
}

const previewOf = book => details.get(book.id)?.recovery_acceptance_preview;

// Re-renders (polling, audio, typing) far outnumber decisions; rebuild the model only when the draft changes.
const models = new WeakMap(); // draft state → { p, model }
function modelFor(p, f) {
  const hit = models.get(f);
  if (hit?.p === p) return hit.model;
  const model = reviewModel(p, f);
  models.set(f, { p, model });
  return model;
}

const segbar = (model, thin = false) => html`<div class="segbar ${thin ? 'thin' : ''}" ${thin ? raw('aria-hidden="true"') : html`role="img" aria-label="${model.subline} · ${model.need} need you"`}><span class="ok" style="width:${model.bar.ok}%"></span><span class="done" style="width:${model.bar.done}%"></span><span class="need" style="width:${model.bar.need}%"></span></div>`;

function timeline(p, model, end) {
  const at = s => `${Math.min(100, Math.max(0, (s / end) * 100)).toFixed(3)}%`;
  const missing = new Set((p.sections || []).map(s => s.id));
  const edition = (p.published_sections || p.sections).filter(s => !missing.has(s.id));
  const tick = item => {
    const name = item.type === 'missing' ? item.title : item.original;
    const tone = item.decided ? 'done' : item.type === 'missing' ? 'bad' : 'warn';
    return html`<button type="button" class="stripbtn ${tone}" style="left:${at(item.seconds)}" data-act="cr-jump" data-arg="${item.id}" aria-label="${item.decided ? 'Decided' : 'Needs you'}: ${name} at ${hms(item.seconds)}"><i></i></button>`;
  };
  return html`<div class="cr-tl" role="group" aria-label="Where each marker sits in the book">
    <div class="cr-lane"><span>Edition</span><div class="lane">${edition.map(s => html`<i class="pub" style="left:${at(publishedSeconds(s))}"></i>`)}${model.items.filter(i => i.type === 'missing').map(tick)}</div></div>
    <div class="cr-lane"><span>Your file</span><div class="lane">${model.confirmedRows.map(r => html`<i class="ok" style="left:${at(r.seconds)}"></i>`)}${model.items.filter(i => i.type === 'marker').map(tick)}</div></div>
    <div class="cr-lane foot"><span></span><div><span>Start</span><span>Tap a mark to jump to it</span><span>End</span></div></div>
  </div>`;
}

function blockedNotice(p, model) {
  if (!model.blocked) return '';
  const text = p.supported
    ? html`<strong>${percentText(model.pct)} identified by audio · your minimum is ${percentText(model.min)}.</strong> Saving is blocked until you lower the minimum for this book.`
    : html`<strong>No markers were identified by audio.</strong> This draft can’t be saved; try one of the other choices below.`;
  return html`<div class="cr-blocked opened" role="alert"><div class="cr-blocked-text"><span class="icon">${icon('alert', 20)}</span><span>${text}</span></div>${p.supported ? button({ label: 'Lower for this book', act: 'cr-lower', size: 'md' }) : ''}</div>`;
}

const check = () => html`<span class="cr-check" aria-hidden="true">${icon('check', 13, { stroke: 3 })}</span>`;

/** The decided row's contents; `inert` is the copy inside a collapsing card. */
function rowInner(item, inert = false) {
  return html`${check()}<span class="cr-time">${hms(item.seconds)}</span><span class="cr-final"><span class="ell cr-name">${item.final}</span><span class="ell cr-note">${item.note}</span></span>${inert ? html`<span class="textlink ink cr-change">Change</span>` : html`<button type="button" class="textlink ink cr-change" data-act="cr-change" data-arg="${item.id}" aria-label="Change ${item.final} at ${hms(item.seconds)}">Change</button>`}`;
}

const betweenLine = b => html`<div class="btw" role="img" aria-label="${b.label}"><b>${b.prev}</b><span class="ln"><i class="${b.missing ? 'bad' : 'warn'}"></i></span><b>${b.next}</b></div>`;

function optionRows(item, chosen) {
  const label = item.type === 'missing' ? `What happens to ${item.title}` : `Choose what the marker at ${hms(item.seconds)} becomes`;
  return html`<div class="opts ${chosen ? 'picking' : ''}" role="group" aria-label="${label}">${item.options.map(o => html`<button type="button" class="opt ${o.key === chosen ? 'chosen' : o.rec ? 'rec' : ''}" data-act="cr-pick" data-arg="${item.id}" data-choice="${o.key}" aria-pressed="${bool(o.key === chosen)}"><span class="rd" aria-hidden="true"></span><span class="col" style="gap:1px;min-width:0"><span class="nm">${o.label}</span><span class="sub ${o.warn ? 'warn' : ''}">${o.sub}</span></span>${o.rec ? html`<span class="tag">Suggested</span>` : ''}</button>`)}</div>`;
}

function listenBar(book, m) {
  const playing = audio.current()?.key === `review:${book.id}:${m.index}`;
  const quote = transcriptPreview(m.transcript);
  return html`<button type="button" class="listen ${playing ? 'on' : ''}" data-act="cr-play" data-arg="${m.index}" aria-pressed="${bool(playing)}" ${m.excerpt ? '' : raw('disabled')}><span class="pb" aria-hidden="true">${playing ? html`<span class="eq"><span></span><span></span><span></span></span>` : icon('play', 16)}</span><span class="sr">${!m.excerpt ? 'No audio saved for this marker. ' : playing ? 'Stop listening. ' : `Listen to 15 seconds at ${hms(m.seconds)}. `}</span><q>${quote || 'No spoken text saved for this marker.'}</q></button>`;
}

function allChapters(item, ui) {
  const q = (ui.q || '').trim().toLowerCase();
  const match = o => !q || o.label.toLowerCase().includes(q);
  const pick = o => html`<button type="button" class="pick" data-act="cr-pick" data-arg="${item.id}" data-choice="${o.key}"><span class="ell">${o.label}</span><span class="meta">${o.sub}</span></button>`;
  const all = item.allChoices();
  const inOrder = all.inOrder.filter(match);
  return html`<div class="more opened">
    <div class="inputwrap"><label for="cr-q-${item.id}" class="sr">Find a chapter</label><span class="icon">${icon('search', 18)}</span><input id="cr-q-${item.id}" class="input" type="search" placeholder="Find a chapter" value="${ui.q || ''}" data-cr-q="${item.id}" autocomplete="off" enterkeyhint="search"></div>
    <span class="eyebrow" style="padding:6px 10px 0">In order here</span>
    ${inOrder.length ? inOrder.map(pick) : html`<span class="meta" style="padding:4px 10px">${q ? 'No chapters here match your search.' : 'No unassigned chapters fit between the neighbours.'}</span>`}
    ${item.outCount ? html`<button type="button" class="textlink ink" data-act="cr-out" data-arg="${item.id}" aria-expanded="${bool(ui.out)}" style="align-self:flex-start;margin-left:8px">${ui.out ? 'Hide' : 'Show'} ${item.outCount} ${item.outCount === 1 ? 'chapter' : 'chapters'} outside the usual order</button>` : ''}
    ${ui.out ? html`<p class="cr-outwarn">These break the published order. Only use one if you’ve listened and you’re sure.</p>${all.outOrder.filter(match).map(pick)}` : ''}
  </div>`;
}

function markerBody(book, item, chosen, ui) {
  const [kind, tone] = KIND[item.kind];
  return html`<div class="cr-head"><span class="cr-time">${hms(item.seconds)}</span><span class="cr-kind ${tone}">${kind}</span><span class="cr-file">In your file: <strong>${item.original}</strong></span></div>
    ${betweenLine(item.between)}
    ${listenBar(book, item.marker)}
    ${item.options.length ? optionRows(item, chosen) : ''}
    <div class="alts">
      ${item.showKeep ? html`<button type="button" class="textlink ink" data-act="cr-pick" data-arg="${item.id}" data-choice="keep">Keep “${item.original}”</button>` : ''}
      <button type="button" class="textlink ink" data-act="cr-rename" data-arg="${item.id}" aria-expanded="${bool(ui.rename)}">Rename</button>
      ${item.canRemove ? html`<button type="button" class="textlink ink" data-act="cr-pick" data-arg="${item.id}" data-choice="remove">Remove marker</button>` : ''}
      <button type="button" class="textlink ink" data-act="cr-all" data-arg="${item.id}" aria-expanded="${bool(ui.search)}">${icon('search', 16)}All chapters</button>
    </div>
    ${ui.rename ? html`<div class="cr-rename opened"><label for="cr-rn-${item.id}" class="sr">Chapter name</label><input id="cr-rn-${item.id}" class="input" type="text" maxlength="200" value="${ui.name ?? item.original}" data-cr-name="${item.id}" autocomplete="off" enterkeyhint="done">${button({ label: 'Use name', kind: 'primary', act: 'cr-use-name', arg: item.id })}</div>` : ''}
    ${ui.search ? allChapters(item, ui) : ''}`;
}

function missingBody(item, chosen) {
  return html`<div class="cr-head"><span class="cr-time">${hms(item.seconds)}</span><span class="cr-kind bad">In the edition, not in your file</span></div>
    <span class="cr-title">${item.title}</span>
    ${betweenLine(item.between)}
    ${optionRows(item, chosen)}`;
}

function card(book, item, after) {
  const c = closing.get(item.id);
  const sum = c && after?.items.find(i => i.id === item.id);
  const cls = ['cc', item.type === 'missing' && 'missing', c && 'closing', !c && focusedItem === item.id && 'focus', !c && growing === item.id && 'grow'].filter(Boolean).join(' ');
  const body = item.type === 'missing' ? missingBody(item, c?.key) : markerBody(book, item, c?.key, uiFor(book, item.id));
  return html`<div class="${cls}" id="cr-item-${item.id}" data-item="${item.id}">
    <div class="cc-sum" aria-hidden="true"><div><div class="cc-row">${sum ? rowInner(sum, true) : ''}</div></div></div>
    <div class="cc-body"${c ? raw(' inert') : ''}><div><div class="cc-in">${body}</div></div></div>
  </div>`;
}

function itemList(book, model, after) {
  const open = model.items.filter(i => !i.decided).length;
  const limit = open > 60 ? shown.get(book.id) || 30 : Infinity;
  const rows = [];
  let count = 0, i = 0;
  for (; i < model.items.length; i++) {
    const item = model.items[i];
    if (!item.decided && ++count > limit) break;
    rows.push(item.decided ? html`<div class="cc-done" id="cr-item-${item.id}" data-item="${item.id}">${rowInner(item)}</div>` : card(book, item, after));
  }
  const rest = model.items.length - i;
  return html`<div class="cr-list">${rows}${rest ? html`<button type="button" class="cr-more" id="cr-more" data-act="cr-more">${rest} more</button>` : ''}</div>`;
}

/** Make sure the item's card is rendered (very large books render open cards in batches). */
function reveal(book, model, id) {
  const idx = model.items.findIndex(i => i.id === id);
  const open = model.items.slice(0, idx + 1).filter(i => !i.decided).length;
  if (open > (shown.get(book.id) || 30)) shown.set(book.id, open + 10);
}

function finalizeBody(book, p, ctx) {
  const f = draftFor(book, p, ctx);
  const model = modelFor(p, f);
  const mine = [...closing.values()].filter(c => c.book === book.id);
  const after = mine.length ? modelFor(p, mine.reduce((acc, c) => applyChoice(acc, c.choice), f)) : null;
  const stale = loadDraft(book.id)?.accept && loadDraft(book.id).accept.token !== p.token;
  const gapBox = html`<label class="checkbox cr-gap"><input type="checkbox" name="gap" ${f.gap ? 'checked' : ''}><span>I accept possible gaps or edition differences. Matching chapters doesn’t prove the audio is complete.</span></label>`;
  const save = serverButton({ label: f.busy ? 'Saving…' : 'Accept and save', kind: 'primary', act: 'accept', size: ctx.phone ? 'lg' : '', block: ctx.phone, disabled: f.busy || !model.canSave, disabledReason: f.busy ? 'Working…' : model.status });
  const pctLine = `${percentText(model.pct)} identified by audio · your minimum is ${model.validMin ? percentText(model.min) : '—'}`;
  const advanced = html`<div class="col gap12" style="padding-bottom:12px">
    ${field({ id: 'accept-min', label: 'Minimum for this book (%)', type: 'number', value: f.min ?? p.default_minimum_percent, hint: `The share of markers that must be confirmed by audio before this book can be saved. Your decisions don’t count toward it. Default from Settings: ${p.default_minimum_percent}%.`, extra: { min: 1, max: 100, step: 0.1, inputmode: 'decimal' } })}
    ${p.coverage_warnings.length ? html`<div class="col gap4"><span style="font-size:14px;font-weight:650">Content coverage</span>${p.coverage_warnings.map(w => html`<span class="meta">${w}</span>`)}</div>` : ''}
    <p class="meta">Edits are saved in this browser as you go. The audiobook changes only after Accept and save.${ctx.ui.localDraftWarning ? ` ${ctx.ui.localDraftWarning}` : ''}${stale ? ' The server draft has changed; edits from the previous draft were not applied.' : ''}</p>
    <p class="meta">The audio must be unchanged and the output must validate. An existing M4B is backed up first. Source MP3s are kept.</p>
  </div>`;
  // Phone: the bar is fixed above the tab bar, so it renders outside the animated page column (see render()).
  if (ctx.phone) phoneBars.set(book.id, html`<div class="pbar cr-pbar" role="region" aria-label="Save chapters"><div class="row gap10"><div class="col grow" style="gap:6px;min-width:0"><span class="cr-status" role="status">${model.status}</span>${segbar(model, true)}</div>${model.need ? iconButton({ icon: 'chevronDown', label: 'Next open marker', act: 'cr-next', cls: 'icb cr-next' }) : ''}</div>${gapBox}${save}</div>`);
  return html`<form class="accept cr ${ctx.phone ? 'with-pbar' : ''}" data-form="accept" novalidate>
    <div class="cr-summary"><div class="col gap4"><span class="cr-headline">${model.headline}</span><span class="meta" style="font-size:14px">${model.subline}</span></div>
      ${model.recs.length && !f.bulkNote ? button({ label: `Accept ${model.recs.length} suggestions`, icon: 'check', act: 'cr-accept-recs' }) : ''}</div>
    ${f.bulkNote && f.bulk?.length ? html`<div class="bulknote opened" role="status"><span class="grow">Applied ${f.bulk.length} suggestions. Each one is marked in the list.</span>${button({ label: 'Undo', act: 'cr-undo-bulk', size: 'sm' })}</div>` : ''}
    ${segbar(model)}
    <div class="legend"><span><i class="ok"></i>Confirmed by audio</span><span><i class="done"></i>Decided by you</span><span><i class="need"></i>Needs you</span><span><i class="bad"></i>Missing from your file</span></div>
    ${timeline(p, model, timelineEnd(p, sources.get(book.id)))}
    ${blockedNotice(p, model)}
    ${itemList(book, model, after)}
    <div class="cr-discs">
      ${collapsible({ id: 'cr-confirmed', title: `${model.confirmed} ${model.confirmed === 1 ? 'marker' : 'markers'} confirmed by audio`, summary: 'No action needed', open: ctx.ui.open?.['cr-confirmed'] ?? false, cls: 'cr-disc', headCls: 'top-line', level: 'h3', body: html`<div class="cr-confirmed">${model.confirmedRows.map(r => html`<div><span class="ok">${icon('check', 14, { stroke: 3 })}</span><span class="cr-time">${hms(r.seconds)}</span><span class="ell">${r.name}</span></div>`)}</div>` })}
      ${collapsible({ id: 'cr-advanced', title: 'Advanced', summary: ctx.phone ? '' : pctLine, open: ctx.ui.open?.['cr-advanced'] ?? false, cls: 'cr-disc', headCls: 'top-line', level: 'h3', body: advanced })}
    </div>
    ${f.message ? html`<p class="alert-bad" role="alert">${f.message}</p>` : ''}
    ${ctx.phone ? '' : html`<div class="savebar" role="region" aria-label="Save chapters"><div class="col grow" style="gap:6px;min-width:0"><span class="cr-status" role="status">${model.status}</span>${gapBox}</div>${model.need ? button({ label: 'Next open', iconEnd: 'chevronDown', act: 'cr-next' }) : ''}${save}</div>`}
  </form>`;
}

/** Turn a rendered option key into the choice it stands for. */
function choiceFor(item, key) {
  if (key === 'keep') return { type: 'keep', index: item.index };
  if (key === 'remove') return { type: 'remove', index: item.index };
  const option = (item.options || []).find(o => o.key === key);
  if (option) return option.choice;
  const all = item.allChoices?.();
  return all ? [...all.inOrder, ...all.outOrder].find(o => o.key === key)?.choice || null : null;
}

/** After a decision commits: phone moves on to the next open card; desktop stays put. */
function afterCommit(book, ctx, ids) {
  const p = previewOf(book);
  const model = modelFor(p, ctx.ui.accept[book.id]);
  const last = ids[ids.length - 1];
  if (!ctx.phone) {
    if (focusedItem && ids.includes(focusedItem)) focusedItem = null;
    ctx.rerender();
    const active = document.activeElement;
    if (!active || active === document.body || active.closest?.('[inert]')) itemEl(last)?.querySelector('.cr-change')?.focus({ preventScroll: true });
    return;
  }
  const next = nextOpen(model.items, last);
  focusedItem = next?.id || null;
  if (next) reveal(book, model, next.id);
  ctx.rerender();
  if (!next) return;
  const el = itemEl(next.id);
  focusTarget(el)?.focus({ preventScroll: true });
  glideTo(el, { force: false, ...glideOpts(ctx) });
}

/** Decide one or more items: fill the chosen option, collapse in place, then commit (spec §4). */
function decide(book, ctx, picks, { bulk = false } = {}) {
  if (picks.some(([id]) => closing.has(id))) return;
  const commit = () => {
    picks.forEach(([id]) => { closing.delete(id); cardUi.delete(`${book.id}:${id}`); });
    let f = ctx.ui.accept[book.id];
    for (const [, choice] of picks) f = applyChoice(f, choice);
    f = bulk ? { ...f, bulk: picks.map(([, c]) => c.index), bulkNote: true } : { ...f, bulkNote: false };
    setDraft(book, ctx, f);
    afterCommit(book, ctx, picks.map(([id]) => id));
  };
  if (reduceMotion()) { commit(); return; }
  picks.forEach(([id, choice, key]) => closing.set(id, { book: book.id, choice, key }));
  ctx.rerender();
  setTimeout(commit, CLOSE_MS);
}

/** Glide to an item and highlight it (timeline ticks, Next open). */
function jumpTo(book, ctx, id) {
  const p = previewOf(book);
  const model = modelFor(p, ctx.ui.accept[book.id]);
  reveal(book, model, id);
  focusedItem = id;
  ctx.rerender();
  const el = itemEl(id);
  if (!el) return;
  focusTarget(el).focus({ preventScroll: true });
  glideTo(el, { force: true, ...glideOpts(ctx) });
}

const draftActions = {
  'cr-pick': (el, ev, ctx) => {
    const { book } = current(ctx); const p = book && previewOf(book); if (!p) return;
    const item = modelFor(p, draftFor(book, p, ctx)).items.find(i => i.id === el.dataset.arg);
    const choice = item && !item.decided && choiceFor(item, el.dataset.choice);
    if (choice) decide(book, ctx, [[item.id, choice, el.dataset.choice]]);
  },
  'cr-change': (el, ev, ctx) => {
    const { book } = current(ctx); const p = book && previewOf(book); if (!p) return;
    const id = el.dataset.arg;
    setDraft(book, ctx, { ...clearChoice(p, draftFor(book, p, ctx), id), bulkNote: false });
    growing = reduceMotion() ? null : id;
    focusedItem = null;
    ctx.rerender();
    setTimeout(() => { if (growing === id) growing = null; }, GROW_MS);
    focusTarget(itemEl(id))?.focus({ preventScroll: true });
  },
  'cr-rename': (el, ev, ctx) => {
    const { book } = current(ctx); if (!book) return;
    const ui = uiFor(book, el.dataset.arg);
    setCardUi(book, el.dataset.arg, { rename: !ui.rename, search: false });
    ctx.rerender();
    if (!ui.rename) { const input = document.getElementById(`cr-rn-${el.dataset.arg}`); input?.focus(); input?.select(); }
  },
  'cr-use-name': (el, ev, ctx) => useName(ctx, el.dataset.arg),
  'cr-all': (el, ev, ctx) => {
    const { book } = current(ctx); if (!book) return;
    const ui = uiFor(book, el.dataset.arg);
    setCardUi(book, el.dataset.arg, { search: !ui.search, rename: false });
    ctx.rerender();
    if (!ui.search) document.getElementById(`cr-q-${el.dataset.arg}`)?.focus();
  },
  'cr-out': (el, ev, ctx) => {
    const { book } = current(ctx); if (!book) return;
    setCardUi(book, el.dataset.arg, { out: !uiFor(book, el.dataset.arg).out });
    ctx.rerender();
  },
  'cr-play': (el, ev, ctx) => {
    const { book } = current(ctx);
    const m = book && previewOf(book)?.markers?.find(m => m.index === Number(el.dataset.arg));
    if (m?.excerpt) audio.playExcerpt({ key: `review:${book.id}:${m.index}`, jobId: book.id, label: m.title || `Marker ${m.index}`, excerpt: m.excerpt }).catch(error => reportError(error, 'Couldn’t play marker'));
  },
  'cr-jump': (el, ev, ctx) => { const { book } = current(ctx); if (book) jumpTo(book, ctx, el.dataset.arg); },
  'cr-next': (el, ev, ctx) => {
    const { book } = current(ctx); const p = book && previewOf(book); if (!p) return;
    const from = focusedItem || document.activeElement?.closest?.('[data-item]')?.dataset.item || null;
    const next = nextOpen(modelFor(p, draftFor(book, p, ctx)).items, from);
    if (next) jumpTo(book, ctx, next.id);
  },
  'cr-lower': (el, ev, ctx) => {
    const { book } = current(ctx); const p = book && previewOf(book); if (!p) return;
    const f = draftFor(book, p, ctx);
    setDraft(book, ctx, { ...f, min: String(modelFor(p, f).lowerTo), message: '' });
    ctx.rerender();
  },
  'cr-more': (el, ev, ctx) => { const { book } = current(ctx); if (book) { shown.set(book.id, (shown.get(book.id) || 30) + 30); ctx.rerender(); } },
  'cr-accept-recs': (el, ev, ctx) => {
    const { book } = current(ctx); const p = book && previewOf(book); if (!p) return;
    const f = draftFor(book, p, ctx);
    const proposals = recommendations(p, f);
    // Recheck the combined plan as well as each original recommendation.
    const combined = { ...f, decisions: { ...f.decisions, ...Object.fromEntries(proposals.map(d => [d.index, d])) } };
    const safe = proposals.filter(d => !assignmentIssue(p, combined, d.index, (p.published_sections || p.sections).find(s => s.id === d.section_id)));
    if (safe.length) decide(book, ctx, safe.map(d => [`m${d.index}`, { type: 'section', index: d.index, sectionId: d.section_id }, `sec:${d.section_id}`]), { bulk: true });
  },
  'cr-undo-bulk': (el, ev, ctx) => {
    const { book } = current(ctx); const p = book && previewOf(book); if (!p) return;
    const f = draftFor(book, p, ctx);
    const decisions = { ...f.decisions };
    for (const index of f.bulk || []) if (decisions[index]?.action === 'published') delete decisions[index];
    setDraft(book, ctx, { ...f, decisions, bulk: [], bulkNote: false });
    ctx.rerender();
  },
};

function useName(ctx, id) {
  const { book } = current(ctx); const p = book && previewOf(book); if (!p) return;
  const title = (document.getElementById(`cr-rn-${id}`)?.value ?? uiFor(book, id).name ?? '').trim();
  if (!title) { document.getElementById(`cr-rn-${id}`)?.focus(); return; }
  const item = modelFor(p, draftFor(book, p, ctx)).items.find(i => i.id === id);
  if (item && !item.decided) decide(book, ctx, [[id, { type: 'rename', index: item.index, title }, 'rename']]);
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
  return html`<div class="rv-book bk col ${ctx.phone ? 'gap16' : 'gap20'} ${ctx.enter ? (ctx.phone ? 'pushin' : 'rise') : ''}" data-key="rv-${book.id}" style="animation-delay:.12s;min-width:0">
    ${header(book, list, idx, ctx)}
    ${whatHappened(book, form, sit, ctx)}
    ${nextSteps(book, form, sit, ctx)}
    <div class="col ${ctx.phone ? 'gap12' : 'gap16'} ${inset}" style="margin-top:8px"><h2 class="eyebrow" style="padding:0 4px">Evidence</h2>${checksSection(book, ctx)}${historySection(book, ctx)}</div>
  </div>`;
}

function listItem(book, current, ctx) {
  const reason = reviewTitle(book.job);
  if (ctx.phone) return html`<a class="mrow" href="#/review/${encodeURIComponent(book.id)}">${cover(book, { size: 56, radius: 10 })}<span class="col gap4 grow"><span class="ell" style="font-size:16px;font-weight:700" data-vt-title="${book.id}">${book.title}</span><span class="meta ell">${reason} · ${relative(book.updatedAt)}</span></span><span class="muted icon">${icon('chevronRight', 18)}</span></a>`;
  return html`<a class="irow" role="listitem" href="#/review/${encodeURIComponent(book.id)}" aria-current="${bool(current)}">${cover(book, { size: 52, radius: 9 })}<span class="col gap4 grow"><span class="ell" style="font-size:15px;font-weight:700" data-vt-title="${book.id}">${book.title}</span><span class="meta ell">${reason}</span></span><span class="meta tabular" style="font-size:12px;flex-shrink:0">${relative(book.updatedAt)}</span></a>`;
}

const sentBack = new Set();  // books sent back to the queue from here (spec §6)

function allClear(ctx, finished = sentBack.size > 0) {
  return html`<div class="panel bigempty ${ctx.phone ? 'page-inset' : ''} ${finished ? 'bk-in' : ctx.enter ? 'rise' : ''}"><span class="circ tone-ok">${icon('check', 26, { stroke: 2.2 })}</span><span class="t">${finished ? 'Nothing left to review' : 'You’re all caught up'}</span><span class="lede" style="font-size:15px">${finished ? 'Everything you saved is in the queue.' : 'Nothing needs your review right now.'}</span>${button({ label: 'Open queue', kind: finished ? 'primary' : 'ghost', href: '#/queue' })}</div>`;
}

// ---------- actions ----------
function current(ctx) {
  const list = waiting();
  const id = ctx.route.id;
  const book = id ? bookById(id) : list.find(b => b.id === selectedBook) || list[0];
  if (book && selectedBook !== book.id) { selectedBook = book.id; saveDraft('selection', { id: book.id }); }
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
 * A book left Needs review and went back to the queue (spec §6): say so (the
 * notification opens it in the Queue), fade this book out and open the next one
 * in place, or "Nothing left to review" when none are left.
 */
async function sentToQueue(book, body, ctx, idx) {
  sentBack.add(book.id);
  notify({ kind: 'info', title: `${book.title} went back to the queue`, body, action: 'Open queue', href: `#/queue?job=${encodeURIComponent(book.id)}`, dest: 'queue', jobId: book.id, at: Date.now() });
  const list = waiting().filter(b => b.id !== book.id);
  const next = list[Math.min(Math.max(idx, 0), list.length - 1)];
  if (next) ensureLoaded(next, ctx);
  const hash = location.hash;
  if (!reduceMotion()) {
    document.querySelector('.rv-book')?.classList.add('bk-out');
    glideToTop();
    await new Promise(resolve => setTimeout(resolve, 190));
  }
  if (location.hash !== hash) return; // the user went somewhere else meanwhile
  if (next) location.hash = `#/review/${encodeURIComponent(next.id)}`;
  else ctx.rerender();
}

async function submit(book, ctx, recovery) {
  const form = readForm(book);
  const { idx } = current(ctx);
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
    sentToQueue(book, recovery === 'local_markers' ? 'Listening near each marker for a draft' : 'Re-checking chapter audio with your changes', ctx, idx);
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

  /** Start loading the full record and file length as soon as a link to this book is pressed. */
  prefetch(route) {
    const book = route.id && bookById(route.id);
    if (book) ensureLoaded(book, { rerender: () => touch() });
  },
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
      if (sentBack.has(book.id) && !list.length) {
        return phone ? html`<div class="back-head"><a class="textlink" href="#/review" style="color:var(--ink);font-size:16px">${icon('chevronLeft', 22)}Review</a></div>${allClear(ctx, true)}`
          : html`<div class="page-head"><h1 class="h1" tabindex="-1">Needs review</h1></div>${allClear(ctx, true)}`;
      }
      return html`<div class="${phone ? 'page-inset' : ''}">${emptyState({ title: `${book.title} is no longer waiting`, body: book.status.detail, action: button({ label: 'Open', href: book.status.key === 'verified' || book.status.key === 'optimized' ? `#/books/${encodeURIComponent(book.id)}` : `#/queue?job=${encodeURIComponent(book.id)}` }) })}</div>`;
    }
    const heading = phone
      ? html`<div class="page-pad ${enter ? 'rise' : ''}"><h1 class="h1" tabindex="-1">Needs review</h1><p class="meta" style="margin-top:4px;font-size:14px">${list.length ? `${list.length} ${list.length === 1 ? 'book' : 'books'} paused for a decision` : 'Nothing waiting'}</p></div>`
      : html`<div class="page-head ${enter ? 'rise' : ''}"><h1 class="h1" tabindex="-1">Needs review</h1><p class="lede">Books paused because something couldn’t be confirmed. Work through them one at a time.</p></div>`;
    if (phone) {
      if (ctx.route.id) { phoneBars.delete(book.id); return html`${detail(book, list, idx, ctx)}${phoneBars.get(book.id) || ''}`; }
      return html`<div style="height:0"></div>${heading}${list.length ? html`<div class="col page-inset ${enter ? 'rise' : ''}">${list.map(b => listItem(b, false, ctx))}</div>` : allClear(ctx)}`;
    }
    if (!list.length) return html`${heading}${allClear(ctx)}`;
    return html`${heading}<div class="revgrid"><div class="revlist ${enter ? 'rise' : ''}" role="list" aria-label="Books waiting for review" style="animation-delay:.05s">${list.map(b => listItem(b, b.id === book.id, ctx))}</div>${detail(book, list, idx, ctx)}</div>`;
  },

  onInput(el, ev, ctx) {
    const { book } = current(ctx);
    if (!book) return;
    if (el.dataset.crName) { setCardUi(book, el.dataset.crName, { name: el.value }); return; }
    if (el.dataset.crQ) { setCardUi(book, el.dataset.crQ, { q: el.value }); queueMicrotask(() => ctx.rerender()); return; }
    const p = previewOf(book);
    if (p && (el.name === 'gap' || el.id === 'accept-min')) {
      const f = draftFor(book, p, ctx);
      setDraft(book, ctx, { ...f, ...(el.name === 'gap' ? { gap: el.checked } : { min: el.value }), message: '' });
      queueMicrotask(() => ctx.rerender());
      return;
    }
    readForm(book);
    persist(book, ctx);
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
    // Enter in a card's name field uses the name (the draft form has several fields, so it won't submit by itself).
    root.querySelectorAll('[data-cr-name]').forEach(input => {
      input.onkeydown = ev => { if (ev.key === 'Enter') { ev.preventDefault(); useName(ctx, input.dataset.crName); } };
    });
    root.querySelectorAll('[data-cr-q]').forEach(input => {
      input.onkeydown = ev => { if (ev.key === 'Enter') ev.preventDefault(); };
    });
    // Very large books: the next batch of cards loads as the "N more" row scrolls into view.
    moreObserver?.disconnect();
    moreObserver = null;
    const more = root.querySelector('#cr-more');
    if (more && 'IntersectionObserver' in window) {
      moreObserver = new IntersectionObserver(entries => {
        if (!entries.some(e => e.isIntersecting)) return;
        moreObserver?.disconnect();
        draftActions['cr-more'](more, null, ctx);
      }, { rootMargin: '600px 0px' });
      moreObserver.observe(more);
    }
  },

  actions: {
    ...draftActions,
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
      const { book, idx } = current(ctx); if (!book) return;
      try {
        await api.resumeChecks(book.id);
        expect(book.id, 'queued');
        await refresh();
        sentToQueue(book, 'Running the required checks again', ctx, idx);
      } catch (error) { reportError(error, 'Couldn’t resume checks'); }
    },
    accept: async (el, ev, ctx) => {
      const { book, idx } = current(ctx); if (!book) return;
      const p = previewOf(book);
      if (!p) return;
      const f = draftFor(book, p, ctx);
      // The button stays disabled until every item is decided, the minimum is met and the gap box is ticked.
      if (f.busy || !modelFor(p, f).canSave) return;
      const setAccept = patch => { ctx.ui.accept = { ...(ctx.ui.accept || {}), [book.id]: { ...ctx.ui.accept[book.id], ...patch } }; ctx.rerender(); };
      setAccept({ busy: true, message: '' });
      try {
        await api.acceptRecovery(book.id, { draft_token: p.token, minimum_percent: Number(f.min ?? p.default_minimum_percent), optional_sections: remainingSections(p, f).filter(s => f.sections?.includes(s.id)).map(s => s.id), marker_decisions: markerDecisions(p, f), accept_possible_gap: true });
        clearDraft(book.id);
        expect(book.id, 'queued');
        details.delete(book.id);
        await refresh();
        sentToQueue(book, 'Saving new chapter names · audio unchanged', ctx, idx);
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
