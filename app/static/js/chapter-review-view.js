// Ordered decision cards for the fingerprint-bound chapter draft.
import { html, bool } from './format.js';
import { icon } from './icons.js';
import { button, field, collapsible, titleComparison, chapterWarnings } from './ui.js';
import { reviewModel, applyChoice, clearChoice, nextOpen, hms, percentText, KIND, assignmentIssue, markerDecisions, chapterTimeline, applySuggestionSnapshot, undoSuggestions, workspaceModel, editorItem, REVIEW_FILTERS, matchesFilter, foldRows, cycleItem } from './chapter-review.js';
import { glideTo } from './scroll.js';

const reduced = () => document.documentElement.dataset.motion === 'reduce';
const control = (label, act, arg, options = {}) => button({ label, act, arg, ...options });
const key = item => `decision-${item.id}`;
const summary = item => html`<div class="cr-summary"><span class="cr-disc">${icon('check', 16)}</span><span class="mono">${hms(item.seconds)}</span>${titleComparison({existing:item.original || 'No assigned marker', proposed:item.final || item.title, note:(item.note || 'Decision saved').replace(/was “.*”/, '').replace(/\s*·\s*$/, '')})}${control('Change', 'cr-change', item.id, { size: 'sm' })}</div>`;
const between = item => html`<div class="cr-between ${item.type === 'missing' ? 'missing' : ''}" aria-label="${item.between.label}"><span class="ell">${item.between.prev}</span><span class="cr-between-line"><i></i></span><span class="ell">${item.between.next}</span></div>`;
function option(item, value, disabled, closing) {
  const d = closing?.decision, c = value.choice;
  const chosen = closing?.selectedChoice;
  const selected = chosen ? chosen.type === c.type && (chosen.sectionId ?? null) === (c.sectionId ?? null) && (chosen.index ?? chosen.markerIndex ?? null) === (c.index ?? c.markerIndex ?? null)
    : Boolean(d && (d.action === 'published' ? d.section_id === c.sectionId : d.action === c.type));
  return html`<button type="button" class="cr-option ${value.rec ? 'suggested' : ''} ${value.warn ? 'warn' : ''}" data-act="cr-pick" data-item="${item.id}" data-choice="${JSON.stringify(c)}" aria-pressed="${bool(selected)}" ${disabled ? 'disabled' : ''}><span class="radio" aria-hidden="true"></span><span class="col gap4 grow"><strong>${value.label}</strong><span class="meta">${value.sub}</span></span>${value.rec ? html`<span class="pill sm">Suggested</span>` : ''}</button>`;
}
function card(item, f, playing) {
  if (item.decided) return html`<section class="cr-card decided" data-key="${key(item)}" data-cr-item="${item.id}" tabindex="-1" aria-label="${item.final}">${summary(item)}</section>`;
  const closing = f.closing?.[item.id];
  const editing = f.inline?.[item.id];
  let choices = '';
  if (editing === 'rename') {
    choices = html`<div class="col gap8">${field({ id: `rename-${item.id}`, label: 'Chapter name', value: f.renameDraft?.[item.id] ?? item.original, extra: { maxlength: 200, 'data-cr-name': item.id } })}<div class="row gap8 wrap">${control('Use name', 'cr-use-name', item.id)}${control('Cancel', 'cr-inline', item.id)}</div></div>`;
  } else {
    choices = html`<div class="cr-options" role="group" aria-label="Choices for ${item.original || item.title}">${item.options.map(o => option(item, o, Boolean(f.busy || f.closing), { decision: f.decisions?.[item.index] }))}</div>`;
    if (item.type === 'marker') {
      choices = html`${choices}<div class="row gap8 wrap cr-other">${item.showKeep ? control(`Keep “${item.original}”`, 'cr-keep', item.id, { size: 'sm' }) : ''}${control('Rename', 'cr-rename', item.id, { size: 'sm' })}${item.canRemove ? control('Remove marker', 'cr-remove', item.id, { size: 'sm' }) : ''}${control('All chapters', 'cr-all', item.id, { size: 'sm' })}</div>`;
      if (editing === 'all') {
        const all = item.allChoices(), query = (f.queries?.[item.id] || '').toLocaleLowerCase();
        const matches = values => values.filter(o => o.label.toLocaleLowerCase().includes(query));
        const inside = matches(all.inOrder), outside = matches(all.outOrder), limit = f.choiceLimit?.[item.id] || 50;
        choices = html`${choices}<div class="cr-all col gap12">${field({ id: `chapters-${item.id}`, label: 'Search chapters', type: 'search', value: f.queries?.[item.id] || '', extra: { 'data-cr-query': item.id } })}<h4>In order here</h4>${inside.length ? inside.slice(0, limit).map(o => option(item, o, Boolean(f.busy || f.closing), { decision: f.decisions?.[item.index] })) : html`<p class="meta">No unassigned in-order chapters match.</p>`}${inside.length > limit ? control('Show more chapters', 'cr-more-choices', item.id) : ''}${outside.length ? control(`${f.outside?.[item.id] ? 'Hide' : 'Show'} ${outside.length} chapters outside the usual order`, 'cr-outside', item.id) : ''}${f.outside?.[item.id] ? html`<p class="cr-order-warning" role="note">These break the published order. Only use one if you’ve listened and you’re sure.</p>${outside.slice(0, limit).map(o => option(item, o, Boolean(f.busy || f.closing), { decision: f.decisions?.[item.index] }))}${outside.length > limit ? control('Show more chapters', 'cr-more-choices', item.id) : ''}` : ''}</div>`;
      }
    }
  }
const tag = item.type === 'missing' ? ['Published section not matched to a marker', 'warn'] : KIND[item.kind];
  return html`<section class="cr-card ${item.type === 'missing' ? 'missing' : ''} ${closing ? 'closing' : ''}" data-key="${key(item)}" data-cr-item="${item.id}" tabindex="-1" aria-label="${item.original || item.title}">
    <div class="cr-sum" aria-hidden="true" inert><div>${summary(closing || item)}</div></div>
    <div class="cr-body" ${closing ? 'inert' : ''}><div class="col gap12">
      <div class="cr-card-head"><span class="mono">${hms(item.seconds)}</span><span class="cr-kind ${tag[1]}">${tag[0]}</span></div>
      ${item.type === 'marker' ? titleComparison({existing:item.original, proposed:f.decisions?.[item.index] ? chapterTimeline(f.preview, f).find(r=>r.n===item.index)?.planned : item.marker.supported ? item.marker.suggested_title : 'Not selected', note:f.decisions?.[item.index] ? 'Your current choice' : item.marker.supported ? 'Original audio match' : 'Choose below'}) : ''}
      ${item.type === 'missing' ? html`<h3>${item.title}</h3>` : ''}${between(item)}
      ${item.marker?.conflict ? html`<p class="note">${item.marker.reason}</p>` : ''}
      ${item.blockedBy ? html`<div class="col gap8"><p class="meta">Another assignment may be blocking this match. Review it before leaving this section unassigned.</p>${control(`Review match at ${hms(item.blockedBy.seconds)}`, 'cr-edit-match', `m${item.blockedBy.index}`, { size: 'sm' })}</div>` : ''}
      ${item.type === 'marker' ? html`<button type="button" class="cr-listen" data-act="cr-play" data-arg="${item.index}" ${!item.marker.excerpt || f.busy ? 'disabled' : ''} aria-pressed="${bool(playing === item.index)}"><span class="cr-play">${icon(playing === item.index ? 'pause' : 'play', 20)}</span><span class="clamp2">${item.marker.transcript || 'No spoken text saved for this marker.'}</span><span class="sr-only">Listen to up to 15 seconds around this marker</span></button>` : ''}
      ${choices}
      ${item.marker?.supported ? control('Keep the original audio match', 'cr-match-reset', item.id, { size: 'sm' }) : ''}
    </div></div></section>`;
}
function completion(m, small = false) {
  return html`<div class="cr-completion ${small ? 'mini' : ''}" role="img" aria-label="${m.untouchedConfirmed} unchanged audio matches, ${m.decided} decided by you, ${m.need} need you"><span style="width:${m.bar.ok}%" class="confirmed"></span><span style="width:${m.bar.done}%" class="chosen"></span><span style="width:${m.bar.need}%" class="needed"></span></div>`;
}
function changeOverview(p, f, m) {
  const rows = chapterTimeline(p, f), decisions = new Map(markerDecisions(p, f).map(d => [d.index,d]));
  const removed = rows.filter(r => decisions.get(r.n)?.action === 'remove');
  const renamed = rows.filter(r => r.changed && decisions.get(r.n)?.action !== 'remove');
  const kept = rows.filter(r => !r.changed);
  const changed = rows.filter(r => r.changed);
  const samples = (changed.length ? changed : rows.filter(r => r.proposal)).slice(0,3);
  const missing = m.items.filter(i => i.type === 'missing');
  const jumpCount = (values,singular,plural) => control(`${values.length} ${values.length === 1 ? singular : plural}`, 'chapter-warning', values[0]?.n, {size:'sm', disabled:!values.length});
  return html`<section class="cr-overview col gap12" aria-label="Changes at a glance">
    <div class="col gap4"><h4>Changes at a glance</h4><p class="meta">This is the current save plan. Suggestions count only after you accept them. Audio and retained marker times stay the same.</p></div>
    <div class="row gap8 wrap cr-change-counts">${jumpCount(renamed,'title change','title changes')}${jumpCount(removed,'marker removed','markers removed')}${jumpCount(kept,'title kept','titles kept')}${control(`${m.need} open ${m.need === 1 ? 'decision' : 'decisions'}`, 'cr-next', '', {size:'sm',disabled:!m.need})}</div>
    ${samples.length ? html`<p class="meta">${changed.length ? `First ${samples.length} planned changes, in file order. Select one to inspect it.` : 'No changes selected yet. These suggestions still need your decision.'}</p><div class="col gap8">${samples.map(r => button({act:'chapter-warning',arg:r.n,cls:'cr-change-preview',label:html`<span class="meta mono">${hms(r.seconds)}</span>${titleComparison({existing:r.original,proposed:r.proposal || r.planned,note:r.proposal ? 'Not selected' : decisions.get(r.n)?.action === 'remove' ? 'Audio joins the previous chapter' : 'Planned title change'})}<span class="icon">${icon('chevronRight',18)}</span>`}))}</div>` : html`<p class="meta">No title or marker changes selected.</p>`}
    ${changed.length ? control(`View ${changed.length === 1 ? '1 change' : `all ${changed.length} changes`} in Chapter checks`, 'chapter-overview', 'changed', {size:'sm',iconEnd:'chevronDown'}) : ''}
    ${missing.length ? html`<p class="meta">${missing.length} published sections are not matched to a file marker. Their audio may be inside another chapter.</p>${control('Review unmatched sections','cr-jump',missing[0].id,{size:'sm'})}` : ''}
  </section>`;
}
function workspace(p, f, playing) {
  const m = workspaceModel(p, f), filter=f.filter || 'need', focused=m.focused;
  const editor=focused && editorItem(p,f,focused.id);
  const rows=foldRows(m.rows,filter,f.folds || {}), limit=f.revealed || 60;
  return html`<div class="rw-filters" role="group" aria-label="Filter chapter markers">${REVIEW_FILTERS.map(([id,label])=>control(`${label} ${m.rows.filter(r=>matchesFilter(r,id)).length}`,'rw-filter',id,{extra:{'aria-pressed':bool(filter===id)}}))}</div>
    <div class="rw-workspace"><div class="rw-markers" aria-label="Chapter markers">${rows.slice(0,limit).map(r=>r.fold ? html`<div class="rw-fold">${control(`${r.expanded?'Collapse':'Show'} ${r.rows.length} other markers · ${hms(r.rows[0].seconds)} – ${hms(r.rows.at(-1).seconds)}`,'rw-fold',r.id,{extra:{'aria-expanded':bool(r.expanded)}})}</div>` : html`<div class="rw-row ${focused?.id===r.id?'selected':''}" data-key="row-${r.id}">${control(html`<span class="mono meta">${hms(r.seconds)} · ${r.status}</span>${titleComparison({existing:r.original || 'No file marker',proposed:r.after,note:r.pending?'Not selected':''})}`,'cr-jump',r.id,{cls:'rw-row-main',extra:{'aria-current':focused?.id===r.id?'true':'false'}})}${r.marker ? control(icon(playing===r.marker.index?'pause':'play',18),'cr-play',r.marker.index,{disabled:!r.marker.excerpt,extra:{'aria-label':`Listen around ${hms(r.seconds)}`}}):''}</div>`)}${rows.length>limit ? html`<div data-cr-more>${control(`Show more markers (${rows.length-limit} left)`,'cr-more')}</div>`:''}</div>
    <section class="rw-decision" tabindex="-1" aria-label="Decision panel" data-key="editor-${focused?.id || 'empty'}"><div class="row gap8 wrap"><span class="meta grow">${m.need} left to decide</span>${control('Previous','rw-browse',-1,{disabled:!focused})}${control('Next','rw-browse',1,{disabled:!focused})}</div>${editor ? card(editor,{...f,preview:p},playing) : html`<p class="meta">Choose a marker to inspect its details.</p>`}${focused && !focused.pending ? html`<div class="rw-continue"><p class="meta">${focused.after} · current save plan</p>${control('Continue to next open decision','cr-next','',{disabled:!m.need})}</div>`:''}</section></div>`;
}
export function chapterReviewView(p, f, { playing, warning = '', open = {} } = {}) {
  const m = reviewModel(p, f), limit = f.revealed || 30;
  return html`<div class="chapter-review col gap16">
    <div class="col gap8"><h3>${m.headline}</h3><p class="meta">${m.subline}</p>${m.recs.length ? control(`Accept ${m.recs.length} suggestions`, 'cr-suggestions', '', { disabled: Boolean(f.busy || f.closing) }) : ''}${f.bulkUndo ? html`<p class="meta" role="status">Applied ${f.bulk?.length || 0} suggestions. Each one is marked in the list. ${control('Undo', 'cr-undo', '', { size: 'sm' })}</p>` : ''}</div>
    ${p.quality_policy ? html`<div class="cr-evidence-score col gap4" role="status" aria-live="polite"><strong data-validated-score>${percentText(m.pct)} evidence-backed matches · ${m.quality.validated_count}/${m.total}</strong><span class="meta">${m.quality.audio_count} originally matched by audio + ${m.quality.selected_count} selected matches passed timing and order checks. Your minimum is ${m.validMin ? percentText(m.min) : 'not set'}.</span></div>` : ''}
    ${chapterWarnings(m.quality.warnings)}
    ${changeOverview(p, f, m)}
    ${m.blocked ? html`<div class="cr-blocked" role="note"><span class="icon">${icon('alert', 22)}</span><div class="col gap4 grow"><strong>${percentText(m.pct)} ${p.quality_policy ? 'evidence-backed matches' : 'identified by audio'} · your minimum is ${percentText(m.min)}.</strong><span class="meta">A choice adds credit only when its supporting evidence passes. Review the remaining chapters before changing the minimum.</span></div>${control('Lower for this book', 'cr-lower', '', { disabled: Boolean(f.busy || f.closing) })}</div>` : ''}
    ${workspace(p, f, playing)}
    ${collapsible({ id: 'chapter-advanced', title: 'Advanced', open: open['chapter-advanced'] || false, body: html`<div class="col gap12">${field({ id: 'accept-min', label: 'Minimum evidence-backed markers for this book (%)', type: 'number', value: f.min ?? p.default_minimum_percent, extra: { min: 1, max: 100, step: .1, inputmode: 'decimal' } })}${(p.coverage_warnings || []).map(w => html`<p class="meta">${w}</p>`)}<p class="meta">Edits are saved in this browser. Audio recognition stays separate. Selected catalog matches can add timing evidence; typing a name, keeping a title or removing a marker adds no credit. The percentage uses every original marker and is not a probability that the audio is complete. Retained timestamps and audio stay unchanged.${warning ? ` ${warning}` : ''}</p>${p.quality_policy ? html`<p class="meta">${p.quality_policy.reason}</p>` : ''}</div>` })}
    ${f.message ? html`<p class="note" role="status">${f.message}</p>` : ''}
  </div>`;
}
export function chapterSaveBar(p, f, acceptance) {
  const m = reviewModel(p, f);
  const status = f.message || (acceptance.refreshing || (m.canSave && !acceptance.enabled) ? acceptance.problem : m.status);
  return html`<section class="cr-save" data-key="save-${p.token}" aria-label="Save reviewed chapter decisions" aria-busy="${bool(Boolean(f.busy))}"><div class="cr-save-status"><div class="col gap8 grow"><strong id="accept-status" role="status" aria-live="polite">${status}</strong><span id="accept-detail" class="sr-only">${acceptance.problem || 'Final validation runs before saving.'}</span>${completion(m, true)}</div>${control('Next open', 'cr-next', '', { iconEnd: 'chevronDown', disabled: !m.need, extra: { 'aria-label': 'Jump to next open decision' } })}</div><label class="checkbox"><input type="checkbox" id="accept-gap" name="gap" ${f.gap ? 'checked' : ''} ${f.busy ? 'disabled' : ''}><span>I accept possible gaps or edition differences. Matching chapters doesn’t prove the audio is complete.</span></label><div id="accept-action" ${acceptance.visible ? '' : 'hidden'}>${control(f.busy ? 'Submitting…' : 'Accept and save', 'accept', '', { kind: 'review-save', block: true, disabled: !acceptance.enabled, disabledReason: acceptance.problem, extra: { 'aria-describedby': 'accept-status accept-detail' } })}</div></section>`;
}

export function chapterController({ get, update, play }) {
  const locked = new Set();
  const data = ctx => { const d = get(ctx); return d && { ...d, model: workspaceModel(d.p, d.f) }; };
  const change = (ctx, make) => { const d = data(ctx); if (d && !d.f.busy && !locked.has(d.book.id)) update(ctx, make(d.f, d)); };
  const jump = (ctx, id, force = true) => {
    const d = data(ctx); if (!d) return;
    const at=foldRows(d.model.rows,d.f.filter || 'need',d.f.folds || {}).findIndex(r=>!r.fold && r.id===id);
    update(ctx, { ...d.f, focus: id, revealed:Math.max(d.f.revealed || 60,at+1) });
    requestAnimationFrame(() => { if(ctx.isCurrent?.() === false) return; const el = document.querySelector('.rw-decision'); if (el) { el.focus({ preventScroll:true }); glideTo(el, { force, top:ctx.phone ? 76 : 96, bar:'.cr-save' }); } });
  };
  const choose = (ctx, transform, ids, selected = {}) => {
    const d = data(ctx); if (!d || d.f.busy || locked.has(d.book.id)) return;
    const manual = Object.keys(selected).length > 0;
    const next = transform(d.f, d);
    update(ctx, { ...next, focus: d.f.focus || ids[0], ...(manual ? { bulkUndo:null, bulk:[] } : {}),
      localHistory: [...(d.f.localHistory || []), { at:Date.now(), text:manual ? `Decision updated at ${hms(d.model.rows.find(row=>row.id===ids[0])?.seconds || 0)}` : 'Applied suggested matches' }].slice(-80) });
  };
  const pick = async (ctx, choice, itemId) => {
    const d = data(ctx); if (!d) return;
    if (choice.type === 'section' || choice.type === 'start') {
      const index = choice.index ?? choice.markerIndex, sectionId = choice.sectionId;
      const section = (d.p.published_sections || d.p.sections).find(s => s.id === sectionId);
      if (!section) return;
      const issue = assignmentIssue(d.p, d.f, index, section);
      if (issue && !(issue === 'Outside the surrounding chapter order' && choice.outOfOrder)) return;
    }
    if (choice.outOfOrder) {
      const { confirmSheet } = await import('./overlay.js');
      const approved = await confirmSheet({title:'Use a chapter outside the published order?',body:'This records an explicit order override. Use it only after checking the audio.',confirmLabel:'Use this chapter'});
      if (!approved || ctx.isCurrent?.() === false || data(ctx)?.p.token !== d.p.token) return;
    }
    choose(ctx, f => applyChoice({ ...f, inline: { ...f.inline, [itemId]: null } }, choice), [itemId], { [itemId]:choice });
  };
  const actions = {
    'rw-filter': (el, ev, ctx) => change(ctx, f => ({...f, filter:el.dataset.arg})),
    'rw-fold': (el, ev, ctx) => change(ctx, f => ({...f, folds:{...f.folds,[el.dataset.arg]:!f.folds?.[el.dataset.arg]}})),
    'rw-browse': (el, ev, ctx) => { const d=data(ctx), row=d && cycleItem(d.model.rows,d.f.focus || d.model.focused?.id,Number(el.dataset.arg)); if(row) jump(ctx,row.id); },
    'cr-pick': (el, ev, ctx) => { try { pick(ctx, JSON.parse(el.dataset.choice), el.dataset.item); } catch { /* Ignore stale or malformed choices. */ } },
    'cr-keep': (el, ev, ctx) => pick(ctx, { type: 'keep', index: Number(el.dataset.arg.slice(1)) }, el.dataset.arg),
    'cr-remove': (el, ev, ctx) => { const d = data(ctx), item = d && editorItem(d.p, d.f, el.dataset.arg); if (item?.marker.removable) pick(ctx, { type: 'remove', index: item.index }, item.id); },
    'cr-change': (el, ev, ctx) => change(ctx, (f, d) => ({...clearChoice(d.p, f, el.dataset.arg),bulkUndo:null,bulk:[]})),
    'cr-edit-match': (el, ev, ctx) => {
      const d = data(ctx); if (!d || d.f.busy) return;
      const marker = d.p.markers.find(m => `m${m.index}` === el.dataset.arg); if (!marker) return;
      jump(ctx, el.dataset.arg);
    },
    'cr-match-reset': (el, ev, ctx) => change(ctx, (f, d) => {
      const index = Number(el.dataset.arg.slice(1)); if (!d.p.markers.find(m => m.index === index)?.supported) return f;
      const decisions = { ...f.decisions }, editingMatches = { ...f.editingMatches };
      delete decisions[index]; delete editingMatches[index]; return { ...f, decisions, editingMatches, bulkUndo:null, bulk:[], message: '' };
    }),
    'cr-rename': (el, ev, ctx) => { change(ctx, f => ({ ...f, inline: { ...f.inline, [el.dataset.arg]: 'rename' } })); document.getElementById(`rename-${el.dataset.arg}`)?.focus({ preventScroll: true }); },
    'cr-inline': (el, ev, ctx) => change(ctx, f => ({ ...f, inline: { ...f.inline, [el.dataset.arg]: null } })),
    'cr-use-name': (el, ev, ctx) => { const d = data(ctx), item = d && editorItem(d.p, d.f, el.dataset.arg); const title = document.getElementById(`rename-${el.dataset.arg}`)?.value.trim(); if (item && title && title.length <= 200 && !/[\x00-\x1f]/.test(title)) pick(ctx, { type: 'rename', index: item.index, title }, item.id); },
    'cr-all': (el, ev, ctx) => change(ctx, f => ({ ...f, inline: { ...f.inline, [el.dataset.arg]: f.inline?.[el.dataset.arg] === 'all' ? null : 'all' } })),
    'cr-outside': (el, ev, ctx) => change(ctx, f => ({ ...f, outside: { ...f.outside, [el.dataset.arg]: !f.outside?.[el.dataset.arg] } })),
    'cr-more-choices': (el, ev, ctx) => change(ctx, f => ({ ...f, choiceLimit: { ...f.choiceLimit, [el.dataset.arg]: (f.choiceLimit?.[el.dataset.arg] || 50) + 50 } })),
    'cr-lower': (el, ev, ctx) => change(ctx, (f, d) => ({ ...f, min: d.model.lowerTo, message: '' })),
    'cr-more': (el, ev, ctx) => change(ctx, f => ({ ...f, revealed: (f.revealed || 60) + 60 })),
    'cr-play': (el, ev, ctx) => play(ctx, Number(el.dataset.arg)),
    'cr-next': (el, ev, ctx) => { const d = data(ctx), from = d?.f.focus || d?.model.focused?.id; const item = d && nextOpen(d.model.rows.map(r=>({...r,decided:!r.pending})), from); if (item) { ctx.ui.lastDecision = item.id; jump(ctx, item.id); } },
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
