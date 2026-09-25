// Shared components (DESIGN.md §8). Each returns an html`` fragment. Interactions
// are declared with data-act="name" and handled by the screen or shell (main.js).
// Don't hand-roll variants in screens: extend these.

import { html, raw, esc, bool, dash, relative, timeOfDay, dayLabel } from './format.js';
import { icon, countdownRing, ICON_FOR_KIND } from './icons.js';
import { STEPS, reviewTitle } from './status.js';
import { coverColor, coverMark } from './books.js';

const attrs = obj => raw(Object.entries(obj || {})
  .filter(([, v]) => v !== undefined && v !== null && v !== false)
  .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${esc(v)}"`)).join(''));

// ---------- Buttons ----------
/** kind: primary | ghost | danger | danger-fill | warn | chip. `disabledReason` shows as a tooltip. */
export function button({ label, kind = 'ghost', icon: ic, iconEnd, act, arg, href, size = '', block = false, disabled = false, disabledReason = '', cls = '', extra = {} }) {
  const classes = ['btn', kind !== 'ghost' && `btn-${kind}`, size && `btn-${size}`, block && 'btn-block', cls].filter(Boolean).join(' ');
  const inner = html`${ic ? icon(ic, 18) : ''}${label}${iconEnd ? icon(iconEnd, 18, { stroke: 2 }) : ''}`;
  const common = { class: classes, 'data-act': act, 'data-arg': arg, title: disabled && disabledReason ? disabledReason : undefined, ...extra };
  if (href && !disabled) return html`<a${attrs({ ...common, href })}>${inner}</a>`;
  return html`<button type="button"${attrs({ ...common, disabled, 'aria-disabled': disabled && disabledReason ? 'true' : undefined })}>${inner}</button>`;
}

export function iconButton({ icon: ic, label, act, arg, cls = 'icb', disabled = false, disabledReason = '', size = 20, extra = {} }) {
  return html`<button type="button"${attrs({ class: cls, 'aria-label': label, title: disabled && disabledReason ? disabledReason : label, 'data-act': act, 'data-arg': arg, disabled, ...extra })}>${icon(ic, size)}</button>`;
}

/**
 * A button that opens a short list of choices below it (search-style drop-down, SEARCH §edition).
 * Open state lives in the screen's ui.menu; main.js closes it on pick, outside click and Esc.
 * items: [{ label, icon, act, arg }]. With `text`, the toggle is a labelled button; otherwise icon only.
 */
export function menuButton({ id, label, text = '', icon: ic = 'chevronDown', open = false, items = [] }) {
  const toggle = { 'aria-haspopup': 'menu', 'aria-expanded': bool(open), 'aria-controls': `${id}-menu` };
  return html`<div class="menuwrap" data-key="${id}">
    ${text ? button({ label: text, iconEnd: ic, act: 'menu-toggle', arg: id, extra: { ...toggle, 'aria-label': label, style: 'height:44px' } })
      : iconButton({ icon: ic, label, act: 'menu-toggle', arg: id, extra: toggle })}
    ${open ? html`<div class="menu" id="${id}-menu" role="menu" aria-label="${label}">${items.map(item => html`<button type="button" class="menuitem" role="menuitem" data-act="${item.act}" ${item.arg != null ? html`data-arg="${item.arg}"` : ''}>${item.icon ? icon(item.icon, 18) : ''}${item.label}</button>`)}</div>` : ''}
  </div>`;
}

/**
 * Exclusive choices, each with a title, a one-line explanation and its own body
 * (one primary button inside). Only the open choice shows its body.
 * items: [{ id, title, desc, body }]; `act` receives the choice id as data-arg.
 */
export function choices({ label, act, open, items }) {
  return html`<div class="choices" role="group" aria-label="${label}">${items.map(item => {
    const on = item.id === open;
    return html`<section class="choice ${on ? 'on' : ''}" data-key="choice-${item.id}">
      <button type="button" class="choicehead" data-act="${act}" data-arg="${item.id}" aria-expanded="${bool(on)}" aria-controls="choice-${item.id}-body">
        <span class="radio" aria-hidden="true"></span><span class="col gap4 grow" style="min-width:0"><span class="ct">${item.title}</span><span class="cd">${item.desc}</span></span>
      </button>
      ${on ? html`<div class="choicebody opened" id="choice-${item.id}-body">${item.body}</div>` : ''}
    </section>`;
  })}</div>`;
}

/** "N books need you": the way into Needs review from Library and Queue. */
export function reviewBanner(waiting, enter, phone) {
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

/** Destructive actions never fire on one click: first click shows this row (desktop) or a sheet (phone). */
export function confirmRow({ question, keepAct, confirmAct, confirmLabel, arg }) {
  return html`<div class="confirm opened" role="group" aria-label="${question}"><span class="muted">${question}</span>${button({ label: 'Keep', act: keepAct, arg, size: 'md' })}${button({ label: confirmLabel, kind: 'danger', act: confirmAct, arg, size: 'md' })}</div>`;
}

// ---------- Status ----------
export const statusPill = (status, { size = '' } = {}) => html`<span class="pill ${size} tone-${status.tone}">${status.key === 'verified' || status.key === 'optimized' ? icon('check', 16, { stroke: 2.2 }) : html`<span class="dot dot-${status.tone}"></span>`}${status.label}</span>`;

export const statusLine = (status, text = status.detail) => html`<span class="statusline"><span class="dot dot-${status.tone}${status.live ? ' pulse' : ''}" aria-hidden="true"></span><span class="ell">${status.label}${text && text !== status.label ? html` · ${text}` : ''}</span></span>`;

export function stepTracker(status, { compact = false } = {}) {
  const step = status.step;
  const idx = step.index;
  const fillState = step.state === 'paused' ? 'paused' : step.state === 'failed' ? 'failed' : '';
  const width = idx <= 1 ? 0 : step.state === 'done' ? 100 : ((idx - 1) / 3) * 100;
  const label = idx ? `Step ${idx} of 4: ${STEPS[idx - 1]}${step.sub ? `, ${step.sub}` : ''}${step.state === 'paused' ? ', paused' : step.state === 'failed' ? ', failed' : ''}` : 'Not started';
  return html`<div class="steps ${compact ? 'compact' : ''}" role="img" aria-label="${label}"><span class="track"><span class="trackfill ${fillState}" style="width:${width}%"></span></span>${STEPS.map((name, i) => {
    const n = i + 1;
    const cls = n < idx || step.state === 'done' ? 'done' : n === idx ? (step.state === 'current' ? 'current' : step.state === 'paused' ? 'paused' : step.state === 'failed' ? 'failed' : '') : '';
    const text = n === idx && step.sub && !compact ? `${name} · ${step.sub}` : name;
    return html`<div class="st"><span class="st-dot ${cls}"></span><span class="st-lbl ${n === idx ? 'on' : ''}">${text}</span></div>`;
  })}</div>`;
}

export const progressBar = (pct, { live = false, thin = false, label = 'Progress' } = {}) => html`<div class="bar ${thin ? 'thin' : ''}" role="progressbar" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct ?? 0}"><span class="fill ${live ? 'live' : ''}" style="width:${pct ?? 0}%"></span></div>`;

// ---------- Cover ----------
/**
 * Square cover: real art when known, otherwise a flat colour from the book id with a
 * faint numeral and the title. variant: large | grid | list | thumb | hero.
 */
export function cover(book, { size = 48, radius = 8, variant = 'thumb', pill = false, dot = false, cls = '' } = {}) {
  const mark = coverMark(book);
  const conv = book.status?.key === 'converting';
  const pct = book.status?.pct ?? 0;
  const style = `--c:${coverColor(book.path || book.id)};${['large', 'grid', 'grid-sm'].includes(variant) ? '' : `width:${size}px;height:${size}px;`}border-radius:${radius}px;${varsFor(variant, size)}`;
  // data-art lets re-renders keep an already loaded image (morph.js).
  const art = book.coverUrl ? html`<img alt="" loading="lazy" referrerpolicy="no-referrer" src="${book.coverUrl}" data-cover-fallback="${book.id}" data-art="${book.id}:${book.coverUrl}">`
    : book.id ? html`<img alt="" loading="lazy" data-cover-id="${book.id}" data-art="${book.id}">` : '';
  const showTitle = variant !== 'thumb' || size >= 84;
  return html`<div class="cover ${(variant === 'thumb' || variant === 'list') && size < 84 ? 'corner' : ''} ${cls}" style="${style}" aria-hidden="true">
    ${art}<span class="mark">${mark}</span>
    ${showTitle ? html`<span class="ctitle">${variant === 'large' ? html`<span class="ceyebrow">${book.series ? `${book.series}${book.seriesPos ? ` · ${book.seriesPos}` : ''}` : book.author || ''}</span>` : ''}${book.title}</span>` : ''}
    ${pill ? html`<span class="cpill ${book.status.key}">${book.status.label}</span>` : ''}
    ${dot ? html`<span class="cdot ${book.status.key}"></span>` : ''}
    ${conv ? html`<span class="cbar"><span class="fill" style="width:${pct}%"></span></span>` : ''}
  </div>`;
}
function varsFor(variant, size) {
  if (variant === 'large') return '--mark:88px;--ct:21px;--cpad:16px;';
  if (variant === 'grid') return '--mark:56px;--ct:14px;--cpad:12px;';
  if (variant === 'grid-sm') return '--mark:32px;--ct:11px;--cpad:8px;';
  const mark = Math.round(size * 0.4);
  return `--mark:${mark}px;--ct:${Math.max(11, Math.round(size / 10))}px;--cpad:${Math.max(6, Math.round(size / 14))}px;`;
}

// ---------- Containers ----------
/** Collapsible panel: full-width header button with rotating chevron. Open state is owned by the caller. */
export function collapsible({ id, title, count, summary, open, body, cls = 'panel disc', headCls = '', level = 'h2' }) {
  const bodyId = `${id}-body`;
  return html`<section class="${cls}" data-collapsible="${id}">
    <${raw(level)} class="ghh"><button type="button" class="gh ${headCls}" data-act="toggle" data-arg="${id}" aria-expanded="${open ? 'true' : 'false'}" aria-controls="${bodyId}">
      <span class="chev">${icon('chevronRight', 18, { stroke: 2 })}</span><span class="title">${title}</span>${count != null && count !== '' ? html`<span class="count">${count}</span>` : ''}${summary ? html`<span class="summary">${summary}</span>` : ''}
    </button></${raw(level)}>
    <div id="${bodyId}" ${open ? '' : raw('hidden')}>${body}</div>
  </section>`;
}

export function emptyState({ title, body = '', action = '', cls = '' }) {
  return html`<div class="empty ${cls}"><span class="t">${title}</span>${body ? html`<span>${body}</span>` : ''}${action}</div>`;
}

export const techDetails = (text, label = 'Technical details') => (text ? html`<details class="tech"><summary>${label}</summary><div class="techbody">${text}</div></details>` : '');

export const gapNote = (text, gap) => html`<p class="gapnote">${text}${gap ? html` <span class="mono">(${gap})</span>` : ''}</p>`;

// ---------- Inputs ----------
export function field({ id, label, value = '', type = 'text', placeholder = '', hint = '', disabled = false, disabledReason = '', extra = {}, cls = '' }) {
  return html`<div class="fld ${cls}"><label for="${id}">${label}</label><input${attrs({ id, name: id, type, value, placeholder, disabled, title: disabled ? disabledReason : undefined, autocomplete: 'off', spellcheck: 'false', ...extra })}>${hint ? html`<span class="hint">${hint}</span>` : ''}</div>`;
}

export function selectField({ id, label, options, value, disabled = false, extra = {}, cls = '' }) {
  return html`<div class="fld ${cls}"><label for="${id}">${label}</label><select${attrs({ id, name: id, disabled, ...extra })}>${options.map(([v, text]) => html`<option value="${v}" ${v === value ? raw('selected') : ''}>${text}</option>`)}</select></div>`;
}

export function toggle({ label, checked, act, arg, disabled = false, disabledReason = '' }) {
  return html`<button type="button" class="switch" role="switch" aria-checked="${checked ? 'true' : 'false'}" aria-label="${label}"${attrs({ 'data-act': act, 'data-arg': arg, disabled, title: disabled ? disabledReason : undefined })}><span class="knob"></span></button>`;
}

/** options: [[value, label, disabledReason?]] */
export function segmented({ label, options, value, act, full = false, iconOnly = false }) {
  return html`<div class="segctl ${full ? 'full' : ''}" role="group" aria-label="${label}">${options.map(([v, text, reason, ic]) => html`<button type="button" class="sgb ${iconOnly ? 'icon-only' : ''}" data-act="${act}" data-arg="${v}" aria-pressed="${v === value ? 'true' : 'false'}"${attrs({ disabled: Boolean(reason), title: reason || (iconOnly ? text : undefined), 'aria-label': iconOnly ? text : undefined })}>${ic ? icon(ic, 18) : text}</button>`)}</div>`;
}

/** options: [[value, label, count]] */
export function tabs({ label, options, value, act, scroll = false, cls = '' }) {
  return html`<div class="tabs ${scroll ? 'scroll' : ''} ${cls}" role="group" aria-label="${label}">${options.map(([v, text, n]) => html`<button type="button" class="tab" data-act="${act}" data-arg="${v}" aria-pressed="${v === value ? 'true' : 'false'}">${text}${n != null ? html` <span class="n">${n}</span>` : ''}</button>`)}</div>`;
}

export function settingRow({ label, desc = '', control, stack = false }) {
  return html`<div class="srow ${stack ? 'stack' : ''}"><div class="col gap4"><span class="label">${label}</span>${desc ? html`<span class="desc">${desc}</span>` : ''}</div>${control}</div>`;
}

// ---------- Lists ----------
export const ldot = kind => html`<span class="ldot ${kind}" aria-hidden="true">${icon(ICON_FOR_KIND[kind] || 'check', 14, { stroke: 2.2 })}</span>`;

const KIND_WORD = { ok: 'Done', warn: 'Paused', bad: 'Failed', info: 'Update', play: 'Running', you: 'You' };

export function logRow(entry, now = Date.now()) {
  const inner = html`<span class="time">${relative(entry.at, now)}</span>${ldot(entry.kind)}<span class="body"><span class="sr">${KIND_WORD[entry.kind] || ''}: </span><span class="t">${entry.text}</span>${entry.detail ? html`<span class="d">${entry.detail}</span>` : ''}</span>`;
  return entry.href ? html`<a class="logrow" href="${entry.href}">${inner}</a>` : html`<div class="logrow">${inner}</div>`;
}

export function historyList(entries) {
  if (!entries.length) return html`<p class="meta" style="padding:8px 0 12px">Nothing recorded yet.</p>`;
  return html`<ol class="hist">${entries.map(e => html`<li>${ldot(e.kind)}<div class="col gap4"><span class="t">${e.text}</span><span class="d">${e.at ? `${dayLabel(e.at)} · ${timeOfDay(e.at)}` : '—'}</span>${e.detail ? html`<span class="d">${e.detail}</span>` : ''}</div></li>`)}</ol>`;
}

export const checklistRow = ({ done, label, note = '' }) => html`<div class="chk"><span class="b ${done ? 'y' : 'n'}" aria-hidden="true">${done ? icon('check', 14, { stroke: 2.4 }) : ''}</span><span class="label">${label}<span class="sr">${done ? ': done' : ': not done'}</span></span><span class="cnote">${note}</span></div>`;

export const kv = rows => html`<dl class="kv">${rows.map(([k, v]) => html`<dt>${k}</dt><dd>${dash(v)}</dd>`)}</dl>`;

/** 44px spot-check button with the 15-second countdown ring while playing. */
export function spotButton({ playing, label, act, arg, disabled = false, disabledReason = '', cls = 'chplay' }) {
  return html`<button type="button" class="${cls}" data-act="${act}" data-arg="${arg}" aria-pressed="${playing ? 'true' : 'false'}" aria-label="${playing ? `Stop preview of ${label}` : `Preview 15 seconds of ${label}`}"${attrs({ disabled, title: disabled ? disabledReason : undefined })}>${playing ? html`${countdownRing()}${icon('pause', 18)}` : icon('play', 18)}</button>`;
}

export const skeletonRows = (n = 4, height = 56) => html`${Array.from({ length: n }, () => html`<div class="skel" style="height:${height}px;margin:6px 0"></div>`)}`;
export const skeletonGrid = (n = 12) => html`<div class="libgrid grid">${Array.from({ length: n }, () => html`<div class="col gap8"><div class="skel" style="aspect-ratio:1/1;border-radius:12px"></div><div class="skel line" style="width:80%"></div><div class="skel line" style="width:50%"></div></div>`)}</div>`;

export const REGIONS = [['us', 'United States'], ['uk', 'United Kingdom'], ['ca', 'Canada'], ['au', 'Australia'], ['de', 'Germany'], ['fr', 'France'], ['es', 'Spain'], ['it', 'Italy'], ['in', 'India'], ['jp', 'Japan']];
export const regionName = code => REGIONS.find(([c]) => c === String(code || '').toLowerCase())?.[1] || (code ? String(code).toUpperCase() : '');
