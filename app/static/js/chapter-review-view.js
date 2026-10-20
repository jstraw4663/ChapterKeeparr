// Ordered decision cards for the fingerprint-bound chapter draft.
import { html, bool } from './format.js';
import { icon } from './icons.js';
import { button, field, collapsible } from './ui.js';
import { reviewModel, applyChoice, clearChoice, nextOpen, hms, percentText, KIND, assignmentIssue, markerDecisions, timelineEnd, applySuggestionSnapshot, undoSuggestions } from './chapter-review.js';
import { glideTo } from './scroll.js';

const reduced = () => document.documentElement.dataset.motion === 'reduce';
const control = (label, act, arg, options = {}) => button({ label, act, arg, ...options });
const key = item => `decision-${item.id}`;
const summary = item => html`<div class="cr-summary"><span class="cr-disc">${icon('check', 16)}</span><span class="mono">${hms(item.seconds)}</span><span class="col gap4 grow"><strong class="ell">${item.final || item.original || item.title}</strong><span class="meta ell">${item.note || 'Decision saved'}</span></span>${control('Change', 'cr-change', item.id, { size: 'sm' })}</div>`;
const between = item => html`<div class="cr-between ${item.type === 'missing' ? 'missing' : ''}" aria-label="${item.between.label}"><span class="ell">${item.between.prev}</span><span class="cr-between-line"><i></i></span><span class="ell">${item.between.next}</span></div>`;
function option(item, value, disabled) {
  return html`<button type="button" class="cr-option ${value.rec ? 'suggested' : ''} ${value.warn ? 'warn' : ''}" data-act="cr-pick" data-item="${item.id}" data-choice="${JSON.stringify(value.choice)}" ${disabled ? 'disabled' : ''}><span class="radio" aria-hidden="true"></span><span class="col gap4 grow"><strong>${value.label}</strong><span class="meta">${value.sub}</span></span>${value.rec ? html`<span class="pill sm">Suggested</span>` : ''}</button>`;
}
function card(item, f, playing) {
  if (item.decided) return html`<section class="cr-card decided" data-key="${key(item)}" data-cr-item="${item.id}" tabindex="-1" aria-label="${item.final}">${summary(item)}</section>`;
  const closing = f.closing?.[item.id];
  const editing = f.inline?.[item.id];
  let choices = '';
  if (editing === 'rename') {
    choices = html`<div class="col gap8">${field({ id: `rename-${item.id}`, label: 'Chapter name', value: f.renameDraft?.[item.id] ?? item.original, extra: { maxlength: 200, 'data-cr-name': item.id } })}<div class="row gap8 wrap">${control('Use name', 'cr-use-name', item.id)}${control('Cancel', 'cr-inline', item.id)}</div></div>`;
  } else {
    choices = html`<div class="cr-options" role="group" aria-label="Choices for ${item.original || item.title}">${item.options.map(o => option(item, o, Boolean(f.busy || f.closing)))}</div>`;
    if (item.type === 'marker') {
      choices = html`${choices}<div class="row gap8 wrap cr-other">${item.showKeep ? control(`Keep “${item.original}”`, 'cr-keep', item.id, { size: 'sm' }) : ''}${control('Rename', 'cr-rename', item.id, { size: 'sm' })}${item.canRemove ? control('Remove marker', 'cr-remove', item.id, { size: 'sm' }) : ''}${control('All chapters', 'cr-all', item.id, { size: 'sm' })}</div>`;
      if (editing === 'all') {
        const all = item.allChoices(), query = (f.queries?.[item.id] || '').toLocaleLowerCase();
        const matches = values => values.filter(o => o.label.toLocaleLowerCase().includes(query));
        const inside = matches(all.inOrder), outside = matches(all.outOrder), limit = f.choiceLimit?.[item.id] || 50;
        choices = html`${choices}<div class="cr-all col gap12">${field({ id: `chapters-${item.id}`, label: 'Search chapters', type: 'search', value: f.queries?.[item.id] || '', extra: { 'data-cr-query': item.id } })}<h4>In order here</h4>${inside.length ? inside.slice(0, limit).map(o => option(item, o, Boolean(f.busy || f.closing))) : html`<p class="meta">No unassigned in-order chapters match.</p>`}${inside.length > limit ? control('Show more chapters', 'cr-more-choices', item.id) : ''}${outside.length ? control(`${f.outside?.[item.id] ? 'Hide' : 'Show'} ${outside.length} chapters outside the usual order`, 'cr-outside', item.id) : ''}${f.outside?.[item.id] ? html`<p class="cr-order-warning" role="note">These break the published order. Only use one if you’ve listened and you’re sure.</p>${outside.slice(0, limit).map(o => option(item, o, Boolean(f.busy || f.closing)))}${outside.length > limit ? control('Show more chapters', 'cr-more-choices', item.id) : ''}` : ''}</div>`;
      }
    }
  }
const tag = item.type === 'missing' ? ['Published section not matched to a marker', 'warn'] : KIND[item.kind];
  return html`<section class="cr-card ${item.type === 'missing' ? 'missing' : ''} ${closing ? 'closing' : ''}" data-key="${key(item)}" data-cr-item="${item.id}" tabindex="-1" aria-label="${item.original || item.title}">
    <div class="cr-sum" aria-hidden="true" inert><div>${summary(closing || item)}</div></div>
    <div class="cr-body" ${closing ? 'inert' : ''}><div class="col gap12">
      <div class="cr-card-head"><span class="mono">${hms(item.seconds)}</span><span class="cr-kind ${tag[1]}">${tag[0]}</span>${item.type === 'marker' ? html`<span class="meta">In your file: <strong>${item.original}</strong></span>` : ''}</div>
      ${item.type === 'missing' ? html`<h3>${item.title}</h3>` : ''}${between(item)}
      ${item.marker?.conflict ? html`<p class="note">${item.marker.reason}</p>` : ''}
      ${item.blockedBy ? html`<div class="col gap8"><p class="meta">Another assignment may be blocking this match. Review it before leaving this section unassigned.</p>${control(`Review match at ${hms(item.blockedBy.seconds)}`, 'cr-edit-match', `m${item.blockedBy.index}`, { size: 'sm' })}</div>` : ''}
      ${item.type === 'marker' ? html`<button type="button" class="cr-listen" data-act="cr-play" data-arg="${item.index}" ${!item.marker.excerpt || f.busy ? 'disabled' : ''} aria-pressed="${bool(playing === item.index)}"><span class="cr-play">${icon(playing === item.index ? 'pause' : 'play', 20)}</span><span class="clamp2">${item.marker.transcript || 'No spoken text saved for this marker.'}</span><span class="sr-only">Listen to a 15-second excerpt</span></button>` : ''}
      ${choices}
      ${item.marker?.supported ? control('Keep the original audio match', 'cr-match-reset', item.id, { size: 'sm' }) : ''}
    </div></div></section>`;
}
function completion(m, small = false) {
  return html`<div class="cr-completion ${small ? 'mini' : ''}" role="img" aria-label="${m.untouchedConfirmed} unchanged audio matches, ${m.decided} decided by you, ${m.need} need you"><span style="width:${m.bar.ok}%" class="confirmed"></span><span style="width:${m.bar.done}%" class="chosen"></span><span style="width:${m.bar.need}%" class="needed"></span></div>`;
}
export function chapterReviewView(p, f, { duration, playing, warning = '', open = {} } = {}) {
  const m = reviewModel(p, f), end = timelineEnd(p, duration), limit = f.revealed || 30;
  const ticks = (p.published_sections || p.sections).map(s => ({ seconds: Number(s.seconds ?? s.id), title: s.title, id: `s${s.id}`, edition: true }));
  ticks.push(...p.markers.map(x => ({ seconds: x.seconds, title: x.suggested_title || x.title, id: `m${x.index}`, supported: x.supported })));
  const itemById = new Map(m.items.map(item => [item.id, item]));
  const lane = values => {
    const active = values.filter(t => itemById.has(t.id)).sort((a,b) => a.seconds-b.seconds);
    const groups = [];
    for (const t of active) {
      const last = groups.at(-1);
      // Keep 44px targets apart even in the narrowest supported lane. The
      // individual marks remain visible; every chapter is editable in the list.
      if (last && (t.seconds-last.seconds)/end < .34) last.items.push(t);
      else groups.push({ seconds:t.seconds, items:[t] });
    }
    return html`${values.map(t => {
      const item = itemById.get(t.id);
      return html`<span class="cr-mark ${t.edition ? 'edition' : 'file'} ${item ? item.decided ? 'chosen' : item.type === 'missing' ? 'missing' : 'needed' : t.supported ? 'confirmed' : ''}" style="left:${Math.min(100,100*t.seconds/end)}%" aria-hidden="true"></span>`;
    })}${groups.map(group => {
      const target = group.items.find(t => !itemById.get(t.id)?.decided) || group.items[0];
      return html`<button type="button" class="cr-tick cr-cluster" style="left:${Math.min(100,100*group.seconds/end)}%" data-act="cr-jump" data-arg="${target.id}" aria-label="${group.items.length} nearby chapter decisions; jump to ${target.title} at ${hms(target.seconds)}">${group.items.length > 1 ? html`<span>${group.items.length}</span>` : ''}</button>`;
    })}`;
  };
  return html`<div class="chapter-review col gap16">
    <div class="col gap8"><h3>${m.headline}</h3><p class="meta">${m.subline}</p>${m.recs.length ? control(`Accept ${m.recs.length} suggestions`, 'cr-suggestions', '', { disabled: Boolean(f.busy || f.closing) }) : ''}${f.bulkUndo ? html`<p class="meta" role="status">Applied ${f.bulk?.length || 0} suggestions. Each one is marked in the list. ${control('Undo', 'cr-undo', '', { size: 'sm' })}</p>` : ''}</div>
    ${completion(m)}<div class="cr-legend"><span><i class="confirmed"></i>Confirmed by audio</span><span><i class="chosen"></i>Decided by you</span><span><i class="needed"></i>Needs you</span><span><i class="missing"></i>Not matched to a marker</span></div>
    <div class="cr-timeline" role="group" aria-label="Chapter timeline"><span>Edition</span><div class="cr-lane">${lane(ticks.filter(t => t.edition))}</div><span>Your file</span><div class="cr-lane">${lane(ticks.filter(t => !t.edition))}</div><div class="cr-timeline-help"><span>Start</span><span>Tap a group to review; every chapter is listed below.</span><span>End</span></div></div>
    ${m.blocked ? html`<div class="cr-blocked" role="note"><span class="icon">${icon('alert', 22)}</span><div class="col gap4 grow"><strong>${percentText(m.pct)} identified by audio · your minimum is ${percentText(m.min)}.</strong><span class="meta">Resolve the audio checks or explicitly lower the minimum for this book.</span></div>${control('Lower for this book', 'cr-lower', '', { disabled: Boolean(f.busy || f.closing) })}</div>` : ''}
    <div class="cr-list">${m.items.slice(0, limit).map(item => card(item, f, playing))}</div>
    ${m.items.length > limit ? html`<div data-cr-more>${control(`Show more decisions (${m.items.length - limit} left)`, 'cr-more')}</div>` : ''}
    ${collapsible({ id: 'chapter-confirmed', title: `${m.confirmedRows.length} unchanged audio matches`, summary: 'Review any match', open: open['chapter-confirmed'] || false, body: html`<div class="col gap8">${m.confirmedRows.map(row => html`<div class="row gap12"><span class="mono meta">${hms(row.seconds)}</span><span class="grow">${row.name}</span>${control('Change', 'cr-edit-match', `m${row.index}`, { size: 'sm' })}</div>`)}` })}
    ${collapsible({ id: 'chapter-advanced', title: 'Advanced', open: open['chapter-advanced'] || false, body: html`<div class="col gap12">${field({ id: 'accept-min', label: 'Minimum identified markers for this book (%)', type: 'number', value: f.min ?? p.default_minimum_percent, extra: { min: 1, max: 100, step: .1, inputmode: 'decimal' } })}${(p.coverage_warnings || []).map(w => html`<p class="meta">${w}</p>`)}<p class="meta">Edits are saved in this browser. Manual choices do not increase the percentage confirmed by audio. Retained timestamps and audio stay unchanged; no missing marker is invented.${warning ? ` ${warning}` : ''}</p></div>` })}
    ${f.message ? html`<p class="note" role="status">${f.message}</p>` : ''}
  </div>`;
}
export function chapterSaveBar(p, f, acceptance) {
  const m = reviewModel(p, f);
  const status = f.message || (m.canSave && !acceptance.enabled ? acceptance.problem : m.status);
  return html`<section class="cr-save" data-key="save-${p.token}" aria-label="Save reviewed chapter decisions" aria-busy="${bool(Boolean(f.busy))}"><div class="cr-save-status"><div class="col gap8 grow"><strong id="accept-status" role="status" aria-live="polite">${status}</strong><span id="accept-detail" class="sr-only">${acceptance.problem || 'Final validation runs before saving.'}</span>${completion(m, true)}</div>${control('Next open', 'cr-next', '', { iconEnd: 'chevronDown', disabled: !m.need, extra: { 'aria-label': 'Jump to next open decision' } })}</div><label class="checkbox"><input type="checkbox" id="accept-gap" name="gap" ${f.gap ? 'checked' : ''} ${f.busy ? 'disabled' : ''}><span>I accept possible gaps or edition differences. Matching chapters doesn’t prove the audio is complete.</span></label><div id="accept-action" ${acceptance.visible ? '' : 'hidden'}>${control(f.busy ? 'Submitting…' : 'Accept and save', 'accept', '', { kind: 'review-save', block: true, disabled: !acceptance.enabled, disabledReason: acceptance.problem, extra: { 'aria-describedby': 'accept-status accept-detail' } })}</div></section>`;
}

export function chapterController({ get, update, play }) {
  const locked = new Set();
  const data = ctx => { const d = get(ctx); return d && { ...d, model: reviewModel(d.p, d.f) }; };
  const change = (ctx, make) => { const d = data(ctx); if (d && !d.f.busy && !locked.has(d.book.id)) update(ctx, make(d.f, d)); };
  const jump = (ctx, id, force = true) => {
    const d = data(ctx); if (!d) return;
    const at = d.model.items.findIndex(i => i.id === id);
    if (at >= (d.f.revealed || 30)) update(ctx, { ...d.f, revealed: Math.ceil((at + 1) / 30) * 30 });
    requestAnimationFrame(() => { const el = document.querySelector(`[data-cr-item="${CSS.escape(id)}"]`); if (el) { el.focus({ preventScroll: true }); glideTo(el, { force, top: ctx.phone ? 76 : 96, bar: '.cr-save' }); } });
  };
  const choose = (ctx, transform, ids) => {
    const d = data(ctx); if (!d || d.f.busy || locked.has(d.book.id)) return;
    const next = transform(d.f, d), nextItems = reviewModel(d.p, next).items;
    const token = d.p.token; locked.add(d.book.id);
    const finish = () => {
      locked.delete(d.book.id);
      const now = data(ctx); if (!now || now.p.token !== token) return;
      // Transform the current form so changes to consent/minimum during motion survive.
      const value = transform({ ...now.f, closing: undefined }, now);
      update(ctx, value);
      if (ctx.phone) { const item = nextOpen(reviewModel(now.p, value).items, ids[ids.length - 1]); if (item) jump(ctx, item.id, false); else document.getElementById('accept-gap')?.focus({ preventScroll: true }); }
    };
    if (reduced()) { finish(); return; }
    const closing = Object.fromEntries(ids.map(id => [id, nextItems.find(i => i.id === id) || { ...d.model.items.find(i => i.id === id), final: 'Decision saved', note: '' }]));
    update(ctx, { ...d.f, closing });
    setTimeout(finish, 300);
  };
  const pick = (ctx, choice, itemId) => {
    const d = data(ctx); if (!d) return;
    if (choice.type === 'section' || choice.type === 'start') {
      const index = choice.index ?? choice.markerIndex, sectionId = choice.sectionId;
      const section = (d.p.published_sections || d.p.sections).find(s => s.id === sectionId);
      if (!section) return;
      const issue = assignmentIssue(d.p, d.f, index, section);
      if (issue && !(issue === 'Outside the surrounding chapter order' && choice.outOfOrder)) return;
    }
    choose(ctx, f => applyChoice({ ...f, inline: { ...f.inline, [itemId]: null } }, choice), [itemId]);
  };
  const actions = {
    'cr-pick': (el, ev, ctx) => { try { pick(ctx, JSON.parse(el.dataset.choice), el.dataset.item); } catch { /* Ignore stale or malformed choices. */ } },
    'cr-keep': (el, ev, ctx) => pick(ctx, { type: 'keep', index: Number(el.dataset.arg.slice(1)) }, el.dataset.arg),
    'cr-remove': (el, ev, ctx) => { const d = data(ctx), item = d?.model.items.find(i => i.id === el.dataset.arg); if (item?.marker.removable) pick(ctx, { type: 'remove', index: item.index }, item.id); },
    'cr-change': (el, ev, ctx) => change(ctx, (f, d) => clearChoice(d.p, f, el.dataset.arg)),
    'cr-edit-match': (el, ev, ctx) => {
      const d = data(ctx); if (!d || d.f.busy) return;
      const marker = d.p.markers.find(m => `m${m.index}` === el.dataset.arg); if (!marker) return;
      if (marker.supported) change(ctx, f => clearChoice(d.p, f, el.dataset.arg));
      jump(ctx, el.dataset.arg);
    },
    'cr-match-reset': (el, ev, ctx) => change(ctx, (f, d) => {
      const index = Number(el.dataset.arg.slice(1)); if (!d.p.markers.find(m => m.index === index)?.supported) return f;
      const decisions = { ...f.decisions }, editingMatches = { ...f.editingMatches };
      delete decisions[index]; delete editingMatches[index]; return { ...f, decisions, editingMatches, message: '' };
    }),
    'cr-rename': (el, ev, ctx) => { change(ctx, f => ({ ...f, inline: { ...f.inline, [el.dataset.arg]: 'rename' } })); document.getElementById(`rename-${el.dataset.arg}`)?.focus({ preventScroll: true }); },
    'cr-inline': (el, ev, ctx) => change(ctx, f => ({ ...f, inline: { ...f.inline, [el.dataset.arg]: null } })),
    'cr-use-name': (el, ev, ctx) => { const d = data(ctx), item = d?.model.items.find(i => i.id === el.dataset.arg); const title = document.getElementById(`rename-${el.dataset.arg}`)?.value.trim(); if (item && title && title.length <= 200 && !/[\x00-\x1f]/.test(title)) pick(ctx, { type: 'rename', index: item.index, title }, item.id); },
    'cr-all': (el, ev, ctx) => change(ctx, f => ({ ...f, inline: { ...f.inline, [el.dataset.arg]: f.inline?.[el.dataset.arg] === 'all' ? null : 'all' } })),
    'cr-outside': (el, ev, ctx) => change(ctx, f => ({ ...f, outside: { ...f.outside, [el.dataset.arg]: !f.outside?.[el.dataset.arg] } })),
    'cr-more-choices': (el, ev, ctx) => change(ctx, f => ({ ...f, choiceLimit: { ...f.choiceLimit, [el.dataset.arg]: (f.choiceLimit?.[el.dataset.arg] || 50) + 50 } })),
    'cr-lower': (el, ev, ctx) => change(ctx, (f, d) => ({ ...f, min: d.model.lowerTo, message: '' })),
    'cr-more': (el, ev, ctx) => change(ctx, f => ({ ...f, revealed: (f.revealed || 30) + 30 })),
    'cr-play': (el, ev, ctx) => play(ctx, Number(el.dataset.arg)),
    'cr-next': (el, ev, ctx) => { const d = data(ctx), from = document.activeElement?.closest('[data-cr-item]')?.dataset.crItem || ctx.ui.lastDecision; const item = d && nextOpen(d.model.items, from); if (item) { ctx.ui.lastDecision = item.id; jump(ctx, item.id); } },
    'cr-jump': (el, ev, ctx) => jump(ctx, el.dataset.arg),
    'cr-suggestions': (el, ev, ctx) => {
      const d = data(ctx); if (!d?.model.recs.length) return;
      const combined = applySuggestionSnapshot(d.f, d.model.recs);
      const recs = d.model.recs.filter(r => !assignmentIssue(d.p, combined, r.index, (d.p.published_sections || d.p.sections).find(s => s.id === r.section_id)));
      if (recs.length) choose(ctx, f => applySuggestionSnapshot(f, recs), recs.map(r => `m${r.index}`));
    },
    'cr-undo': (el, ev, ctx) => change(ctx, f => undoSuggestions(f)),
  };
  return {
    actions,
    onInput(el, ev, ctx) {
      if (el.dataset.crName) { change(ctx, f => ({ ...f, renameDraft: { ...f.renameDraft, [el.dataset.crName]: el.value } })); return true; }
      if (el.dataset.crQuery) { change(ctx, f => ({ ...f, queries: { ...f.queries, [el.dataset.crQuery]: el.value }, choiceLimit: { ...f.choiceLimit, [el.dataset.crQuery]: 50 } })); return true; }
      if (el.id === 'accept-gap' || el.id === 'accept-min') { const d = data(ctx); if (d && !d.f.busy) update(ctx, { ...d.f, ...(el.id === 'accept-gap' ? { gap: el.checked } : { min: el.value }), message: '' }); return true; }
      return false;
    },
    mount(root, ctx) {
      const form = root.querySelector('.accept'), footer = document.querySelector('.cr-save');
      const align = () => {
        const slot = document.getElementById('review-save');
        if (!slot || !footer || !form) return;
        const r = form.getBoundingClientRect();
        slot.style.left = ctx.phone ? '0px' : `${r.left}px`; slot.style.width = ctx.phone ? '100%' : `${r.width}px`;
        document.documentElement.style.setProperty('--review-footer-height', `${footer.getBoundingClientRect().height}px`);
        const v = window.visualViewport; slot.style.setProperty('--keyboard-inset', `${v ? Math.max(0, innerHeight - v.height - v.offsetTop) : 0}px`);
      };
      align(); window.addEventListener('resize', align, { passive: true }); window.visualViewport?.addEventListener('resize', align, { passive: true }); window.visualViewport?.addEventListener('scroll', align, { passive: true });
      const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(align) : null;
      if (form) resize?.observe(form); if (footer) resize?.observe(footer);
      const sentinel = root.querySelector('[data-cr-more]');
      const observer = sentinel && typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { observer.disconnect(); actions['cr-more'](null, null, ctx); } }, { rootMargin: '160px' }) : null;
      if (sentinel) observer?.observe(sentinel);
      return () => { resize?.disconnect(); observer?.disconnect(); window.removeEventListener('resize', align); window.visualViewport?.removeEventListener('resize', align); window.visualViewport?.removeEventListener('scroll', align); };
    },
  };
}
