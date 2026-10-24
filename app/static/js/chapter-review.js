// Chapter draft review (docs/design/CHAPTER_REVIEW.md): what each unconfirmed
// marker and each missing chapter becomes before Accept and save. Pure; no DOM.
// The decision contract is unchanged: markers send {index, action, ...};
// missing chapters saved without their own marker go in the optional sections.

import { publishedSeconds, clearRecommendations } from './review-drafts.js';
import { assessMatches } from './review-quality.js';

export const OUT_OF_ORDER = 'Outside the surrounding chapter order';
const sectionsOf = p => p.published_sections || p.sections;

export function markerDecisions(p, f) {
  return (p.markers || []).map(m => ({ index: m.index, action: m.supported ? 'suggested' : 'keep', ...(f.decisions?.[m.index] || {}) }));
}

export const retainedSectionId = (marker, decision) => decision?.action === 'remove' ? null : decision?.action === 'published' ? decision.section_id : marker.reference_id;

function reviewSections(p, used) {
  const ids = new Set((p.sections || []).map(s => s.id));
  for (const m of p.markers) if (m.supported && m.reference_id != null && !used.has(m.reference_id)) ids.add(m.reference_id);
  return sectionsOf(p).filter(s => ids.has(s.id));
}

export function remainingSections(p, f) {
  const decisions = markerDecisions(p, f);
  const assigned = new Set(p.markers.map((m, i) => retainedSectionId(m, decisions[i])).filter(id => id != null));
  return reviewSections(p, assigned).filter(s => !assigned.has(s.id));
}

export function assignmentIssue(p, f, index, section) {
  const all = p.published_sections || p.sections;
  const rank = all.findIndex(s => s.id === section.id);
  for (const d of markerDecisions(p, f)) {
    if (d.index === index || d.action === 'remove') continue;
    const m = p.markers.find(m => m.index === d.index);
    const id = d.action === 'published' ? d.section_id : m.reference_id;
    if (!id) continue;
    if (id === section.id) return `Already assigned to marker ${d.index}`;
    const other = all.findIndex(s => s.id === id);
    if (other >= 0 && ((d.index < index && other > rank) || (d.index > index && other < rank))) return 'Outside the surrounding chapter order';
  }
  return '';
}

// ---------- formatting ----------
/** Always h:mm:ss, as the spec shows marker and published times. */
export function hms(seconds) {
  if (seconds == null || seconds === '' || !Number.isFinite(Number(seconds))) return '—';
  const n = Math.max(0, Math.floor(Number(seconds)));
  const pad = x => String(x).padStart(2, '0');
  return `${Math.floor(n / 3600)}:${pad(Math.floor((n % 3600) / 60))}:${pad(n % 60)}`;
}

/** "4s later", "25s earlier", "3 min later" or "same time": where `target` sits relative to `from`. */
export function relTime(target, from) {
  const d = Math.round(Number(target) - Number(from));
  if (!Number.isFinite(d)) return '';
  if (d === 0) return 'same time';
  const a = Math.abs(d);
  return `${a < 60 ? `${a}s` : `${Math.round(a / 60)} min`} ${d > 0 ? 'later' : 'earlier'}`;
}

export const percentText = pct => `${Number(Number(pct).toFixed(1))}%`;

// ---------- decisions ----------
/** An explicit, complete choice. The implied "keep" for an untouched unconfirmed marker isn't one. */
export function isDecided(d) {
  if (!d) return false;
  if (d.action === 'published') return d.section_id != null;
  if (d.action === 'rename') return Boolean(d.title?.trim());
  if (d.action === 'remove') return d.confirmed === true;
  return d.action === 'keep';
}

/** UI choice → the decision the server expects (CHAPTER_REVIEW.md, decision mapping). */
export function decisionFor(choice) {
  switch (choice.type) {
    case 'section': return { index: choice.index, action: 'published', section_id: choice.sectionId, ...(choice.outOfOrder ? { override_order: true } : {}) };
    case 'keep': return { index: choice.index, action: 'keep' };
    case 'rename': return { index: choice.index, action: 'rename', title: String(choice.title || '').trim() };
    case 'remove': return { index: choice.index, action: 'remove', confirmed: true };
    case 'start': return { index: choice.markerIndex, action: 'published', section_id: choice.sectionId };
    default: return null;
  }
}

/**
 * Apply one choice to the book's draft state. Missing chapters "saved without it"
 * join the optional sections; anything assigning a section takes it out of them.
 */
export function applyChoice(f, choice) {
  if (choice.type === 'restore') {
    const decisions = { ...f.decisions }, editingMatches = { ...f.editingMatches };
    delete decisions[choice.index]; delete editingMatches[choice.index];
    return { ...f, decisions, editingMatches, message: '' };
  }
  if (choice.type === 'skip') return { ...f, sections: [...new Set([...(f.sections || []), choice.sectionId])], message: '' };
  const d = decisionFor(choice);
  const sections = d.action === 'published' ? (f.sections || []).filter(id => id !== d.section_id) : f.sections || [];
  const placed = choice.type === 'start' ? [...new Set([...(f.placed || []), choice.sectionId])] : f.placed;
  return { ...f, decisions: { ...f.decisions, [d.index]: d }, sections, ...(placed ? { placed } : {}), message: '' };
}

/** Undo the choice behind an item ("Change"): the card reopens. */
export function clearChoice(p, f, id) {
  const bulk = (f.bulk || []).filter(i => `m${i}` !== id);
  if (id.startsWith('m')) {
    const decisions = { ...f.decisions };
    delete decisions[Number(id.slice(1))];
    const index = Number(id.slice(1));
    return { ...f, decisions, bulk, ...(p.markers.find(m => m.index === index)?.supported ? { editingMatches: { ...f.editingMatches, [index]: true } } : {}), message: '' };
  }
  const sectionId = id.slice(1);
  const decisions = { ...f.decisions };
  for (const [k, d] of Object.entries(decisions)) if (d.action === 'published' && d.section_id === sectionId) delete decisions[k];
  return { ...f, decisions, bulk, sections: (f.sections || []).filter(s => s !== sectionId), placed: (f.placed || []).filter(s => s !== sectionId), message: '' };
}

// ---------- the list ----------
/**
 * One pass over the book: decisions, anchors (retained markers with a known
 * published section) and, per marker, the published ranks it must sit between.
 * The order rule is the same as assignmentIssue(): every earlier anchor ranks
 * below, every later one above. Computed once so books with hundreds of
 * markers stay fast; assignmentIssue() still guards the combined plan.
 */
function plan(p, f) {
  const sections = sectionsOf(p);
  const rankOf = new Map(sections.map((s, i) => [s.id, i]));
  const markers = [...(p.markers || [])].sort((a, b) => a.index - b.index);
  const decisions = markerDecisions(p, f);
  const byIndex = new Map(decisions.map(d => [d.index, d]));
  const used = new Set();
  const anchors = [];
  for (const m of markers) {
    const d = byIndex.get(m.index);
    if (d.action === 'remove') continue;
    const id = d.action === 'published' ? d.section_id : m.reference_id;
    if (id == null) continue;
    used.add(id);
    if (rankOf.has(id)) anchors.push({ index: m.index, seconds: m.seconds, title: sections[rankOf.get(id)].title, rank: rankOf.get(id) });
  }
  // lo: highest anchor rank before the marker; hi: lowest after it.
  const bounds = new Map();
  let lo = -1;
  let a = 0;
  for (const m of markers) {
    while (a < anchors.length && anchors[a].index < m.index) lo = Math.max(lo, anchors[a++].rank);
    bounds.set(m.index, { lo });
  }
  let hi = Infinity;
  a = anchors.length - 1;
  for (const m of [...markers].reverse()) {
    while (a >= 0 && anchors[a].index > m.index) hi = Math.min(hi, anchors[a--].rank);
    bounds.get(m.index).hi = hi;
  }
  const free = sections.filter(s => !used.has(s.id)).length;
  const fits = (m, s) => { const b = bounds.get(m.index), r = rankOf.get(s.id); return r != null && r > b.lo && r < b.hi; };
  return { sections, rankOf, markers, decisions, byIndex, used, anchors, bounds, fits, free };
}

/** Recommendations that respect the current order, as "Accept N suggestions" applies them. */
export function recommendations(p, f, ctx = plan(p, f)) {
  return clearRecommendations(p, ctx.decisions, f.decisions, ctx.fits);
}

/** Name the marker will be saved under right now (decisions resolved, defaults otherwise). */
function savedName(ctx, m) {
  const d = ctx.byIndex.get(m.index);
  if (d.action === 'published') return ctx.sections[ctx.rankOf.get(d.section_id)]?.title || m.title;
  if (d.action === 'rename' && d.title?.trim()) return d.title.trim();
  if (d.action === 'suggested' && m.suggested_title) return m.suggested_title;
  return m.title || 'Untitled marker';
}

/** The retained marker whose chapter absorbs this one's audio when it's removed. */
function previousRetained(ctx, m) {
  for (let i = ctx.markers.indexOf(m) - 1; i >= 0; i--) {
    if (ctx.byIndex.get(ctx.markers[i].index).action !== 'remove') return savedName(ctx, ctx.markers[i]);
  }
  return 'the previous chapter';
}

const between = (prev, next, missing = false) => ({
  prev: prev?.title || 'Start of book', next: next?.title || 'End of book', missing,
  label: `Sits between ${prev?.title || 'the start of the book'} and ${next?.title || 'the end of the book'}`,
});

export const KIND = {
  suggested: ['Suggested match', 'ok'],
  close: ['Two close matches', 'warn'],
  far: ['Nearest chapter is far', 'warn'],
  extra: ['No chapter starts here', 'warn'],
  noaudio: ['No audio saved', 'muted'],
  conflict: ['Review conflicting match', 'warn'],
  // Not in the spec's list: an unconfirmed marker none of the five describe (nearest 10–60 s away, no rival).
  plain: ['Not confirmed by audio', 'warn'],
};

/** Kind tag: what kind of problem this is, derived client side (spec §3a). */
export function kindOf({ inOrder, seconds, recommended, excerpt }) {
  if (!inOrder.length) return 'extra';
  if (!excerpt) return 'noaudio';
  if (recommended) return 'suggested';
  const [d1, d2] = inOrder.slice(0, 2).map(s => Math.abs(publishedSeconds(s) - seconds));
  if (d2 != null && Math.abs(d2 - d1) < 10) return 'close';
  if (d1 > 60) return 'far';
  return 'plain';
}

const byDistance = seconds => (a, b) => {
  const da = Math.abs(publishedSeconds(a.s) - seconds), db = Math.abs(publishedSeconds(b.s) - seconds);
  return (Number.isFinite(da) ? da : Infinity) - (Number.isFinite(db) ? db : Infinity) || a.order - b.order;
};

/** Unassigned sections that keep the published order here, nearest first (stable ties). */
function inOrderSections(ctx, m) {
  const { lo, hi } = ctx.bounds.get(m.index);
  return ctx.sections.slice(lo + 1, Math.min(hi, ctx.sections.length)).map((s, i) => ({ s, order: lo + 1 + i }))
    .filter(({ s }) => !ctx.used.has(s.id)).sort(byDistance(m.seconds)).map(r => r.s);
}

/** The rest of the unassigned sections, nearest first. Only built when "All chapters" opens. */
function outOrderSections(ctx, m) {
  return ctx.sections.map((s, order) => ({ s, order })).filter(({ s }) => !ctx.used.has(s.id) && !ctx.fits(m, s))
    .sort(byDistance(m.seconds)).map(r => r.s);
}

function markerItem(p, f, m, ctx) {
  const d = f.decisions?.[m.index];
  const decided = isDecided(d);
  const id = `m${m.index}`;
  const prev = [...ctx.anchors].filter(a => a.index < m.index).pop();
  const next = ctx.anchors.find(a => a.index > m.index);
  const joins = previousRetained(ctx, m);
  const blockedSection = ctx.sections.find(s => Math.abs(publishedSeconds(s)-m.seconds) <= 5 && ctx.used.has(s.id));
  const blocker = blockedSection && ctx.markers.find(other => other.index !== m.index && retainedSectionId(other, ctx.byIndex.get(other.index)) === blockedSection.id);
  const base = { id, type: 'marker', index: m.index, seconds: m.seconds, decided, marker: m, original: m.title || 'Untitled marker', between: between(prev, next), decision: d,
    blockedBy: blocker ? { index: blocker.index, seconds: blocker.seconds } : null };
  if (decided) {
    // Decided rows only need what was chosen; options are worked out when the card reopens.
    const was = `was “${base.original}”`;
    let final, note;
    if (d.action === 'published') {
      final = ctx.sections[ctx.rankOf.get(d.section_id)]?.title || '—';
      note = `${(f.bulk || []).includes(m.index) ? 'Suggestion applied · ' : ''}${d.override_order ? 'Out of the usual order · ' : ''}${was}`;
    } else if (d.action === 'keep') { final = base.original; note = 'Kept its original name'; }
    else if (d.action === 'rename') { final = d.title.trim(); note = `Custom name · ${was}`; }
    else { final = 'Marker removed'; note = `Audio joins ${joins}`; }
    return { ...base, final, note, options: [], outCount: 0, allChoices: () => ({ inOrder: [], outOrder: [] }) };
  }
  const inOrder = inOrderSections(ctx, m);
  const rec = ctx.recs.get(m.index);
  const kind = m.conflict ? 'conflict' : kindOf({ inOrder, seconds: m.seconds, recommended: rec != null && inOrder.some(s => s.id === rec), excerpt: m.excerpt });
  const sectionChoice = (s, outOfOrder = false) => ({
    key: `${outOfOrder ? 'out' : 'sec'}:${s.id}`, label: s.title,
    sub: `Published ${hms(publishedSeconds(s))} · ${relTime(publishedSeconds(s), m.seconds)}${outOfOrder ? ' · outside the usual order' : ''}`,
    choice: { type: 'section', index: m.index, sectionId: s.id, outOfOrder },
  });
  let options;
  if (kind === 'extra') {
    options = [
      ...(m.removable ? [{ key: 'remove', label: 'Remove this marker', sub: `Its audio joins ${joins}`, choice: { type: 'remove', index: m.index } }] : []),
      { key: 'keep', label: 'Keep it as its own chapter', sub: `Named “${base.original}”`, choice: { type: 'keep', index: m.index } },
    ];
  } else {
    options = inOrder.slice(0, 3).map((s, i) => {
      const o = sectionChoice(s);
      if (kind === 'far' && i === 0) { o.sub += ' · listen first'; o.warn = true; }
      o.rec = s.id === rec;
      return o;
    }).sort((a, b) => Number(Boolean(b.rec)) - Number(Boolean(a.rec)));
  }
  return {
    ...base, kind, options, final: '', note: '', nearest: inOrder[0]?.id,
    outCount: ctx.free - inOrder.length,
    allChoices: () => ({ inOrder: inOrder.map(s => sectionChoice(s)), outOrder: outOrderSections(ctx, m).map(s => sectionChoice(s, true)) }),
    showKeep: kind !== 'extra', canRemove: Boolean(m.removable) && kind !== 'extra',
  };
}

/** "Start it at" candidates: the two nearest undecided unconfirmed markers that keep the published order. */
export function startCandidates(p, f, section, ctx = plan(p, f)) {
  const t = publishedSeconds(section);
  return ctx.markers
    .filter(m => !m.supported && !isDecided(f.decisions?.[m.index]) && !ctx.used.has(section.id) && ctx.fits(m, section))
    .sort((a, b) => Math.abs(a.seconds - t) - Math.abs(b.seconds - t) || a.index - b.index)
    .slice(0, 2);
}

function missingItem(p, f, s, ctx) {
  const t = publishedSeconds(s);
  const rank = ctx.rankOf.get(s.id);
  const prev = ctx.anchors.filter(a => a.rank < rank).sort((a, b) => a.rank - b.rank).pop();
  const next = ctx.anchors.filter(a => a.rank > rank).sort((a, b) => a.rank - b.rank)[0];
  const assigned = ctx.decisions.find(d => d.action === 'published' && d.section_id === s.id);
  const skipped = !assigned && (f.sections || []).includes(s.id);
  const placed = Boolean(assigned) && (f.placed || []).includes(s.id);
  // `sections` lists every published section without a confirmed marker. One that an open
  // marker card already offers as its nearest choice isn't missing yet; one assigned from a
  // marker card shows on that marker's row instead.
  if (!skipped && !placed && (assigned || ctx.claimed.has(s.id))) return null;
  const decided = Boolean(assigned) || skipped;
  const at = assigned && ctx.markers.find(m => m.index === assigned.index);
  const options = decided ? [] : [
    { key: 'skip', label: 'Save without a separate marker', sub: 'Accept that this section has no assigned marker; its audio is not removed.', rec: false, choice: { type: 'skip', sectionId: s.id } },
    ...startCandidates(p, f, s, ctx).map(m => ({
      key: `start:${m.index}`, label: `Start it at ${hms(m.seconds)}`,
      sub: `Uses the marker “${m.title || 'Untitled marker'}” · ${relTime(m.seconds, t)}`,
      choice: { type: 'start', markerIndex: m.index, sectionId: s.id },
    })),
  ];
  return {
    id: `s${s.id}`, type: 'missing', sectionId: s.id, title: s.title, seconds: t, decided,
    blockedBy: !decided ? ctx.markers.filter(m => m.supported && Math.abs(m.seconds-t) <= 5).map(m => ({ index: m.index, seconds: m.seconds }))[0] : null,
    between: between(prev, next, true), options,
    final: s.title, note: decided ? (skipped ? 'Saved without its own chapter' : `Starts at ${hms(at?.seconds)}`) : '',
  };
}

/**
 * Everything the draft panel shows, derived from the preview `p` and the book's
 * draft state `f`: the ordered items, counts, save state and timeline ticks.
 */
export function reviewModel(p, f) {
  const ctx = plan(p, f);
  const recs = recommendations(p, f, ctx);
  ctx.recs = new Map(recs.map(r => [r.index, r.section_id]));
  const markers = ctx.markers.filter(m => !m.supported || f.editingMatches?.[m.index] || f.decisions?.[m.index]).map(m => markerItem(p, f, m, ctx));
  ctx.claimed = new Set(markers.filter(m => !m.decided && m.kind !== 'extra').map(m => m.nearest));
  const missing = reviewSections(p, ctx.used).map(s => missingItem(p, f, s, ctx)).filter(Boolean);
  const items = [...markers, ...missing].sort((a, b) => a.seconds - b.seconds || (a.type === 'missing') - (b.type === 'missing'));
  const decided = items.filter(i => i.decided).length;
  const need = items.length - decided;
  const confirmed = p.supported ?? ctx.markers.filter(m => m.supported).length;
  const total = p.total ?? ctx.markers.length;
  const untouchedConfirmed = ctx.markers.filter(m => m.supported && !f.editingMatches?.[m.index] && !f.decisions?.[m.index]).length;
  const minText = f.min ?? p.default_minimum_percent;
  const min = Number(minText);
  const validMin = minText !== '' && Number.isFinite(min) && min >= 1 && min <= 100;
  const quality = assessMatches(p, f);
  const pct = Number(quality.validated_percent) || 0;
  const blocked = validMin && pct + 1e-9 < min;
  const gap = Boolean(f.gap);
  const canSave = p.ready !== false && need === 0 && validMin && !blocked && confirmed > 0 && gap;
  const status = blocked ? 'Below your minimum'
    : !validMin ? 'Set a minimum from 1 to 100%'
      : need ? `${need} left to decide`
        : !gap ? 'Tick the box to save' : 'Ready to save';
  const unit = 100 / Math.max(1, total + missing.length);
  return {
    items, decided, need, confirmed, untouchedConfirmed, total, pct, quality, min, validMin, blocked, gap, canSave, status,
    recs: recs.length >= 2 ? recs : [],
    lowerTo: Math.max(1, Math.floor(pct + 1e-9)),
    bar: { ok: untouchedConfirmed * unit, done: decided * unit, need: need * unit },
    headline: need === 0 ? 'Every decision is ready' : `${need} ${need === 1 ? 'decision needs' : 'decisions need'} you`,
    subline: `${confirmed} of ${total} originally matched by audio · ${decided} decided by you`,
    confirmedRows: ctx.markers.filter(m => m.supported && !f.editingMatches?.[m.index] && !f.decisions?.[m.index]).map(m => ({ index: m.index, seconds: m.seconds, name: savedName(ctx, m) })),
  };
}

/** Whole-file preview, in timestamp order, from the exact publication decisions. */
export function chapterTimeline(p, f = {}) {
  const quality = assessMatches(p, f);
  const sections = new Map(sectionsOf(p).map(s => [s.id, s]));
  const decisions = new Map(markerDecisions(p, f).map(d => [d.index, d]));
  const proposals = new Map(recommendations(p, f).map(r => [r.index, sections.get(r.section_id)?.title]));
  return p.markers.map(m => {
    const issues = quality.warnings.filter(w => w.indexes.includes(m.index));
    const d = decisions.get(m.index), manual = Boolean(f.decisions?.[m.index]);
    const reviewing = Boolean(f.editingMatches?.[m.index] && !manual);
    const proposal = !manual && !m.supported ? proposals.get(m.index) || null : null;
    const planned = d.action === 'remove' ? 'Marker removed · audio retained'
      : d.action === 'published' ? sections.get(d.section_id)?.title || 'Choose a current section'
        : d.action === 'rename' ? d.title?.trim() || 'Enter a name'
          : d.action === 'suggested' ? m.suggested_title || m.title : m.title;
    return { n: m.index, name: planned || m.title || 'Untitled marker', original: m.title || 'Untitled marker',
      planned: planned || 'No proposal', seconds: m.seconds, passed: Boolean(m.supported && !manual),
      proposal, reviewing, manual, issues, validated: quality.qualified_indexes.includes(m.index), changed: d.action === 'remove' || planned !== m.title, needsAttention: issues.length > 0 || Boolean((!m.supported || m.conflict || reviewing) && !manual),
      conflict: Boolean(m.conflict && !manual), pending: false, draft: true,
      transcript: m.transcript || '', excerpt: m.excerpt || null, reason: m.reason || '' };
  }).sort((a, b) => a.seconds-b.seconds || a.n-b.n);
}

/**
 * DESIGN-GAP: G-050 — the preview has no book length, so the timeline uses the
 * file's duration when known and otherwise the last known time.
 */
export function timelineEnd(p, duration) {
  const times = [...(p.markers || []).map(m => m.seconds), ...sectionsOf(p).map(publishedSeconds)].filter(Number.isFinite);
  return Math.max(Number(duration) || 0, ...times, 1);
}

/** Which item comes next after `fromId` among open ones, wrapping to the start. */
export function nextOpen(items, fromId) {
  const open = items.filter(i => !i.decided);
  if (!open.length) return null;
  const at = items.findIndex(i => i.id === fromId);
  return open.find(i => items.indexOf(i) > at && i.id !== fromId) || open.find(i => i.id !== fromId) || null;
}

/** Bulk choices use one reviewed snapshot; undo must preserve later individual edits. */
export function applySuggestionSnapshot(form, proposals) {
  return { ...form, decisions: { ...form.decisions, ...Object.fromEntries(proposals.map(d => [d.index, d])) },
    sections: (form.sections || []).filter(id => !proposals.some(d => d.section_id === id)),
    bulk: proposals.map(d => d.index), bulkUndo: { decisions: form.decisions || {}, sections: form.sections || [], applied: Object.fromEntries(proposals.map(d => [d.index, d])) }, message: '' };
}
export function undoSuggestions(form) {
  const decisions = { ...form.decisions };
  for (const index of form.bulk || []) {
    if (decisions[index] && JSON.stringify(decisions[index]) === JSON.stringify(form.bulkUndo?.applied?.[index])) {
      if (form.bulkUndo.decisions[index]) decisions[index] = form.bulkUndo.decisions[index]; else delete decisions[index];
    }
  }
  const assigned = new Set(Object.values(decisions).filter(d => d.action === 'published').map(d => d.section_id));
  const sections = [...new Set([...(form.sections || []), ...(form.bulkUndo?.sections || [])])].filter(id => !assigned.has(id));
  return { ...form, decisions, sections, bulk: [], bulkUndo: null, message: '' };
}

/** A focused editor reuses the existing candidate/assignment rules without discarding a saved choice. */
export function editorItem(p, f, id) {
  const clean = clearChoice(p, f, id);
  const ctx = plan(p, clean);
  ctx.recs = new Map(recommendations(p, clean, ctx).map(r => [r.index, r.section_id]));
  ctx.claimed = new Set();
  if (id?.startsWith('s')) {
    const section = sectionsOf(p).find(s => s.id === id.slice(1));
    return section ? missingItem(p, clean, section, ctx) : null;
  }
  const marker = p.markers.find(m => `m${m.index}` === id);
  if (!marker) return null;
  const item = markerItem(p, clean, marker, ctx);
  if (marker.supported) {
    item.kind = 'confirmed'; item.showKeep = true; item.canRemove = Boolean(marker.removable);
    item.options.unshift({ key: 'restore', label: marker.suggested_title || marker.title,
      sub: 'Confirmed by audio · restore this match', choice: { type: 'restore', index: marker.index } });
  }
  return item;
}
KIND.confirmed = ['Confirmed by audio', 'ok'];

export function workspaceModel(p, f) {
  const model = reviewModel(p, f), ctx = plan(p, f);
  const open = new Map(model.items.map(i => [i.id, i]));
  const rows = ctx.markers.map(m => {
    const id = `m${m.index}`, item = open.get(id), d = f.decisions?.[m.index];
    const pending = (!m.supported || Boolean(f.editingMatches?.[m.index])) && !isDecided(d);
    const suggested = item?.options.find(o => o.rec);
    const after = d?.action === 'remove' ? 'Removed' : pending ? (suggested ? `${suggested.label}?` : 'Not decided') : savedName(ctx, m);
    return { id, seconds: m.seconds, original: m.title, after, pending, review: !m.supported || Boolean(f.editingMatches?.[m.index]),
      status: isDecided(d) ? 'By you' : m.supported ? 'Audio' : 'Needs you',
      tone: isDecided(d) ? 'done' : pending ? 'warn' : 'ok', marker: m, removed: d?.action === 'remove' };
  });
  rows.push(...model.items.filter(i => i.type === 'missing').map(i => ({ ...i, original: '', after: i.decided ? i.note : i.title + ' · not decided',
    pending: !i.decided, review: true, status: i.decided ? 'By you' : 'Missing', tone: i.decided ? 'done' : 'bad' })));
  rows.sort((a,b) => a.seconds-b.seconds || a.id.localeCompare(b.id));
  const focused = rows.find(r => r.id === f.focus) || rows.find(r => r.pending) || rows[0];
  return { ...model, rows, focused, attention: model.need + Number(model.blocked || !model.validMin || p.ready === false || !model.confirmed) };
}
export const REVIEW_FILTERS = [ ['need','Needs you'], ['changing','Changing'], ['unchanged','Unchanged'], ['all','All'] ];
export function matchesFilter(row, filter) {
  return filter === 'need' ? row.review : filter === 'changing' ? !row.pending && row.after !== row.original : filter === 'unchanged' ? !row.pending && row.after === row.original : true;
}
export function foldRows(rows, filter, expanded = {}) {
  const result = []; let run = [];
  const flush = () => { if (!run.length) return; const id = run[0].id;
    result.push({ fold: true, id, rows: run, expanded: Boolean(expanded[id]) });
    if (expanded[id]) result.push(...run); run = []; };
  for (const row of rows) { if (matchesFilter(row,filter)) { flush(); result.push(row); } else run.push(row); }
  flush(); return result;
}
export function clusterPins(rows, duration, threshold) {
  if (!(duration > 0)) return [];
  const clusters = [];
  for (const row of rows.filter(r => r.pending)) {
    const position = row.seconds / duration * 100, last = clusters.at(-1);
    if (last && position-last.position < threshold) last.rows.push(row);
    else clusters.push({ position, rows: [row] });
  }
  return clusters.map(c => ({ ...c, position: Math.min(97, Math.max(3, c.position)) }));
}
export function cycleItem(rows, id, delta = 1) {
  if (!rows.length) return null;
  const at = rows.findIndex(r => r.id === id);
  return rows[(at + delta + rows.length) % rows.length];
}

/** Real duration only: a final marker is a start, never the book's ending. */
export function reviewTimeline(p, f, fallback) {
  const m = workspaceModel(p, f);
  const duration = Number(p.duration_seconds) > 0 ? Number(p.duration_seconds) : Number(fallback) > 0 ? Number(fallback) : null;
  if (!duration) return null;
  const position = seconds => Math.max(0, Math.min(100, seconds / duration * 100));
  const missing = new Map(m.rows.filter(r => r.type === 'missing').map(r => [r.sectionId || r.id.slice(1), r]));
  return {duration, rows:m.rows.map(r=>({...r, position:position(r.seconds)})),
    sections:sectionsOf(p).map(s=>({id:s.id,position:position(publishedSeconds(s)),missing:missing.get(s.id)})),
    desktopPins:clusterPins(m.rows,duration,2.5), phonePins:clusterPins(m.rows,duration,8)};
}
