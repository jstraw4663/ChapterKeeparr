import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kindOf, reviewModel, startCandidates, decisionFor, applyChoice, clearChoice, isDecided, markerDecisions, relTime, hms, nextOpen, timelineEnd } from '../../app/static/js/chapter-review.js';

// Shaped like recovery_acceptance_preview: section ids are published start seconds.
function preview({ markers, published, missing = [], supportedPercent } = {}) {
  const ms = markers.map((m, i) => ({ index: i + 1, title: m.title || `Original marker ${i + 1}`, seconds: m.at, supported: Boolean(m.ref != null),
    suggested_title: m.ref != null ? published.find(s => s.at === m.ref).title : null, reference_id: m.ref != null ? String(m.ref) : null,
    excerpt: m.noAudio ? null : 'clip.wav', transcript: m.noAudio ? '' : 'Spoken text', removable: i > 0 }));
  const sections = published.map(s => ({ id: String(s.at), title: s.title }));
  const supported = ms.filter(m => m.supported).length;
  return { token: 't', markers: ms, published_sections: sections, sections: sections.filter(s => missing.includes(Number(s.id))),
    supported, total: ms.length, supported_percent: supportedPercent ?? (100 * supported) / ms.length, default_minimum_percent: 50, coverage_warnings: [], requires_gap_acceptance: true };
}
const item = (model, id) => model.items.find(i => i.id === id);

test('time formatting is h:mm:ss and relative wording follows the published time', () => {
  assert.equal(hms(65), '0:01:05');
  assert.equal(hms(3725), '1:02:05');
  assert.equal(hms(null), '—');
  assert.equal(relTime(64, 60), '4s later');
  assert.equal(relTime(420, 445), '25s earlier');
  assert.equal(relTime(300, 120), '3 min later');
  assert.equal(relTime(5, 5), 'same time');
});

test('kind tags are derived from the in-order choices, audio and recommendation', () => {
  const s = at => ({ id: String(at), title: `S${at}` });
  assert.equal(kindOf({ inOrder: [], seconds: 0, excerpt: 'x' }), 'extra');
  assert.equal(kindOf({ inOrder: [], seconds: 0, excerpt: null }), 'extra', 'no in-order choice wins over missing audio');
  assert.equal(kindOf({ inOrder: [s(62)], seconds: 60, excerpt: null, recommended: true }), 'noaudio');
  assert.equal(kindOf({ inOrder: [s(62)], seconds: 60, excerpt: 'x', recommended: true }), 'suggested');
  assert.equal(kindOf({ inOrder: [s(178), s(182)], seconds: 180, excerpt: 'x' }), 'close');
  assert.equal(kindOf({ inOrder: [s(500)], seconds: 420, excerpt: 'x' }), 'far');
  assert.equal(kindOf({ inOrder: [s(445), s(560)], seconds: 420, excerpt: 'x' }), 'plain');
});

test('options are the 3 nearest unassigned sections between the neighbour anchors, recommendation first', () => {
  const p = preview({
    markers: [{ at: 0, ref: 0 }, { at: 100 }, { at: 400, ref: 400 }],
    published: [{ at: 0, title: 'Opening' }, { at: 60, title: 'A' }, { at: 98, title: 'B' }, { at: 150, title: 'C' }, { at: 300, title: 'D' }, { at: 400, title: 'Later' }, { at: 500, title: 'After' }],
  });
  const m = item(reviewModel(p, {}), 'm2');
  assert.deepEqual(m.options.map(o => o.label), ['B', 'A', 'C'], 'nearest first; only between Opening and Later');
  assert.deepEqual(m.allChoices().inOrder.map(o => o.label), ['B', 'A', 'C', 'D']);
  assert.deepEqual(m.allChoices().outOrder.map(o => o.label), ['After']);
  assert.equal(m.outCount, 1);
  assert.deepEqual(m.allChoices().outOrder[0].choice, { type: 'section', index: 2, sectionId: '500', outOfOrder: true });
  assert.equal(m.options[0].sub, 'Published 0:01:38 · 2s earlier');
  assert.equal(m.between.prev, 'Opening');
  assert.equal(m.between.next, 'Later');
  assert.equal(m.between.label, 'Sits between Opening and Later');
  assert.equal(m.kind, 'suggested');
  assert.equal(m.options[0].rec, true);
  assert.equal(m.options.filter(o => o.rec).length, 1);
});

test('a marker with nothing in order offers Remove and Keep, and a far one says listen first', () => {
  const p = preview({
    markers: [{ at: 0, ref: 0 }, { at: 100, ref: 100 }, { at: 150 }, { at: 200, ref: 200 }, { at: 300 }, { at: 600, ref: 600 }],
    published: [{ at: 0, title: 'One' }, { at: 100, title: 'Two' }, { at: 200, title: 'Three' }, { at: 450, title: 'Four' }, { at: 600, title: 'Five' }],
  });
  const model = reviewModel(p, {});
  const extra = item(model, 'm3');
  assert.equal(extra.kind, 'extra');
  assert.deepEqual(extra.options.map(o => o.label), ['Remove this marker', 'Keep it as its own chapter']);
  assert.equal(extra.options[0].sub, 'Its audio joins Two');
  assert.ok(!extra.options.some(o => o.rec), 'neither is tagged Suggested');
  assert.equal(extra.showKeep, false);
  assert.equal(extra.canRemove, false);
  const far = item(model, 'm5');
  assert.equal(far.kind, 'far');
  assert.match(far.options[0].sub, /· listen first$/);
  assert.equal(far.options[0].warn, true);
});

test('missing chapters offer Save without it and the 2 nearest undecided markers that keep the order', () => {
  const p = preview({
    markers: [{ at: 0, ref: 0 }, { at: 30 }, { at: 140 }, { at: 400, ref: 400 }],
    published: [{ at: 0, title: 'Opening' }, { at: 28, title: 'Early' }, { at: 120, title: 'Lost' }, { at: 145, title: 'Mid' }, { at: 400, title: 'End' }],
    missing: [28, 120, 145],
  });
  const lost = p.sections.find(s => s.title === 'Lost');
  assert.deepEqual(startCandidates(p, {}, lost).map(m => m.index), [3, 2], 'nearest first');
  assert.deepEqual(startCandidates(p, { decisions: { 3: { index: 3, action: 'keep' } } }, lost).map(m => m.index), [2], 'decided markers drop out');
  const model = reviewModel(p, {});
  assert.equal(item(model, 's28'), undefined, 'Early is marker 2’s nearest choice, so it isn’t missing yet');
  assert.equal(item(model, 's145'), undefined);
  const card = item(model, 's120');
  assert.equal(card.options[0].label, 'Save without a separate marker');
  assert.equal(card.options[0].sub, 'Accept that this section has no assigned marker; its audio is not removed.');
  assert.equal(card.options[0].rec, false);
  assert.deepEqual(card.options.slice(1).map(o => o.label), ['Start it at 0:02:20', 'Start it at 0:00:30']);
  assert.equal(card.options[1].sub, 'Uses the marker “Original marker 3” · 20s later');
  assert.equal(card.options[2].sub, 'Uses the marker “Original marker 2” · 2 min earlier');
  const placed = applyChoice({}, card.options[1].choice);
  const after = reviewModel(p, placed);
  assert.equal(item(after, 's120').note, 'Starts at 0:02:20', 'a placed chapter stays as a decided row');
  assert.equal(item(after, 'm3').note, 'was “Original marker 3”');
  assert.ok(item(after, 's145'), 'Mid is nobody’s nearest choice any more, so it now needs a decision');
  // A marker after an anchor that follows the section would break the order.
  const q = preview({ markers: [{ at: 0, ref: 0 }, { at: 100, ref: 300 }, { at: 200 }], published: [{ at: 0, title: 'A' }, { at: 150, title: 'Lost' }, { at: 300, title: 'B' }], missing: [150] });
  assert.deepEqual(startCandidates(q, {}, q.sections[0]).map(m => m.index), []);
});

test('UI choices map to the existing decision contract', () => {
  assert.deepEqual(decisionFor({ type: 'section', index: 4, sectionId: '178' }), { index: 4, action: 'published', section_id: '178' });
  assert.deepEqual(decisionFor({ type: 'section', index: 4, sectionId: '900', outOfOrder: true }), { index: 4, action: 'published', section_id: '900', override_order: true });
  assert.deepEqual(decisionFor({ type: 'keep', index: 6 }), { index: 6, action: 'keep' });
  assert.deepEqual(decisionFor({ type: 'rename', index: 6, title: '  Prologue ' }), { index: 6, action: 'rename', title: 'Prologue' });
  assert.deepEqual(decisionFor({ type: 'remove', index: 6 }), { index: 6, action: 'remove', confirmed: true });
  assert.deepEqual(decisionFor({ type: 'start', markerIndex: 3, sectionId: '120' }), { index: 3, action: 'published', section_id: '120' });

  let f = applyChoice({ sections: ['120'] }, { type: 'skip', sectionId: '300' });
  assert.deepEqual(f.sections, ['120', '300'], 'Save without it joins the optional sections');
  f = applyChoice(f, { type: 'start', markerIndex: 3, sectionId: '120' });
  assert.deepEqual(f.sections, ['300'], 'assigning a section takes it out of the optional sections');
  assert.equal(f.decisions[3].section_id, '120');
  assert.equal(isDecided({ action: 'keep' }), true);
  assert.equal(isDecided({ action: 'remove', confirmed: false }), false, 'an unconfirmed legacy removal reopens');
  assert.equal(isDecided({ action: 'rename', title: ' ' }), false);
  assert.equal(isDecided(undefined), false);

  const p = preview({ markers: [{ at: 0, ref: 0 }, { at: 130 }], published: [{ at: 0, title: 'A' }, { at: 120, title: 'Lost' }], missing: [120] });
  const cleared = clearChoice(p, f, 's120');
  assert.equal(cleared.decisions[3], undefined, 'Change on a placed missing chapter undoes the placement');
  assert.deepEqual(markerDecisions(p, {}).map(d => d.action), ['suggested', 'keep']);
});

test('save needs every item decided, the minimum met and the gap box ticked', () => {
  const p = preview({
    markers: [{ at: 0, ref: 0 }, { at: 100 }, { at: 200, ref: 200 }],
    published: [{ at: 0, title: 'A' }, { at: 98, title: 'B' }, { at: 200, title: 'C' }, { at: 300, title: 'D' }],
    missing: [300],
  });
  let f = {};
  let m = reviewModel(p, f);
  assert.equal(m.need, 2);
  assert.equal(m.headline, '2 decisions need you');
  assert.equal(m.subline, '2 of 3 originally matched by audio · 0 decided by you');
  assert.equal(m.status, '2 left to decide');
  assert.equal(m.canSave, false);
  f = applyChoice(f, { type: 'section', index: 2, sectionId: '98' });
  f = applyChoice(f, { type: 'skip', sectionId: '300' });
  m = reviewModel(p, f);
  assert.equal(m.headline, 'Every decision is ready');
  assert.equal(m.status, 'Tick the box to save');
  assert.equal(m.canSave, false);
  m = reviewModel(p, { ...f, gap: true });
  assert.equal(m.status, 'Ready to save');
  assert.equal(m.canSave, true);
  m = reviewModel(p, { ...f, gap: true, min: '90' });
  assert.equal(m.blocked, true);
  assert.equal(m.status, 'Below your minimum');
  assert.equal(m.canSave, false);
  assert.equal(m.lowerTo, 66);
  assert.equal(reviewModel(p, { ...f, gap: true, min: String(m.lowerTo) }).canSave, true);
  assert.equal(reviewModel(p, { ...f, gap: true, min: '0' }).canSave, false, 'an invalid minimum blocks saving');
  const bar = m.bar;
  assert.equal(Math.round(bar.ok + bar.done + bar.need), 100);
});

test('decided rows say what happened', () => {
  const p = preview({
    markers: [{ at: 0, ref: 0 }, { at: 100, title: 'Chapter 12' }, { at: 150, title: 'Extra' }, { at: 160, title: 'Odd' }, { at: 400, ref: 400 }],
    published: [{ at: 0, title: 'Opening' }, { at: 98, title: 'Letter I' }, { at: 400, title: 'End' }, { at: 500, title: 'Later' }],
  });
  const f = { decisions: {
    2: decisionFor({ type: 'section', index: 2, sectionId: '500', outOfOrder: true }),
    3: decisionFor({ type: 'remove', index: 3 }),
    4: decisionFor({ type: 'rename', index: 4, title: 'Interlude' }),
  } };
  const m = reviewModel(p, f);
  assert.equal(item(m, 'm2').final, 'Later');
  assert.equal(item(m, 'm2').note, 'Out of the usual order · was “Chapter 12”');
  assert.equal(item(m, 'm3').note, 'Audio joins Later');
  assert.equal(item(m, 'm4').note, 'Custom name · was “Odd”');
  assert.equal(nextOpen(m.items, 'm2'), null);
});

test('the complex fixture and a Bedlam-sized book build quickly and in book order', () => {
  // Same shape as tests/fixtures/complex_review.py.
  const cases = [[0, 0, 'Opening Credits'], [60, 62, 'Letter I'], [120, 120, 'Chapter 1', 1], [180, 178, 'Letter II'], [240, 240, 'Chapter 2', 1], [300], [360, 360, 'Chapter 3', 1], [420, 445, 'Letter III'], [480, 480, 'Chapter 4', 1], [540, 541, 'Interlude'], [542], [600, 600, 'Chapter 5', 1], [660, 662, 'Letter IV'], [720, 720, 'Chapter 6', 1], [780, null, null, 0, true], [840, 840, 'Chapter 7', 1], [900, 905, 'Afterword'], [960, 960, 'Chapter 8', 1], [1020, 1020, 'Interlude'], [1080, 1080, 'Chapter 9', 1], [1140, 1150, 'Epilogue'], [1200, 1200, 'Chapter 10', 1], [1260, 1261, 'End Credits']];
  const published = cases.filter(c => c[1] != null).map(c => ({ at: c[1], title: c[2] }));
  published.push({ at: 182, title: 'Letter II — alternate section' }, { at: 1040, title: 'Interlude' }, { at: 1320, title: 'Bonus scene — no local marker' });
  published.sort((a, b) => a.at - b.at);
  const p = preview({ markers: cases.map(c => ({ at: c[0], ref: c[3] ? c[1] : null, noAudio: c[4] })), published, missing: [1320] });
  const m = reviewModel(p, {});
  assert.equal(m.items.length, 14);
  assert.deepEqual(m.items.map(i => i.seconds), [...m.items.map(i => i.seconds)].sort((a, b) => a - b));
  assert.equal(item(m, 'm4').kind, 'close');
  assert.equal(item(m, 'm15').kind, 'extra', 'no free section between Chapter 6 and Chapter 7');
  assert.equal(item(m, 'm15').marker.excerpt, null);
  assert.equal(item(m, 's1320').type, 'missing');
  assert.ok(m.recs.length >= 2, 'Accept N suggestions shows');
  assert.equal(timelineEnd(p, 1380), 1380);
  assert.equal(timelineEnd(p, null), 1320);

  const n = 400;
  const big = preview({
    markers: Array.from({ length: n }, (_, i) => ({ at: i * 300 + (i % 3 ? 7 : 0), ref: i % 3 ? null : i * 300 })),
    published: Array.from({ length: n }, (_, i) => ({ at: i * 300, title: `Chapter ${i}` })),
  });
  const t0 = performance.now();
  const bm = reviewModel(big, {});
  const ms = performance.now() - t0;
  assert.equal(bm.items.length, n - Math.ceil(n / 3));
  assert.ok(ms < 2000, `reviewModel took ${ms.toFixed(0)}ms for ${n} markers`);
});

test('bulk undo preserves subsequent individual edits and restores optional choices', async () => {
  const { applySuggestionSnapshot, undoSuggestions } = await import('../../app/static/js/chapter-review.js');
  const choices = [{ index: 2, action: 'published', section_id: '120' }, { index: 4, action: 'published', section_id: '240' }];
  const bulk = applySuggestionSnapshot({ sections: ['120', '360'] }, choices);
  assert.deepEqual(bulk.sections, ['360']);
  const changed = { ...bulk, decisions: { ...bulk.decisions, 2: { index: 2, action: 'rename', title: 'My chapter' }, 6: { index: 6, action: 'keep' } } };
  const undone = undoSuggestions(changed);
  assert.equal(undone.decisions[2].title, 'My chapter');
  assert.equal(undone.decisions[4], undefined);
  assert.equal(undone.decisions[6].action, 'keep');
  assert.deepEqual(undone.sections, ['360', '120']);
});

test('correcting an automatic match frees its old identity and the full timeline stays chronological', async () => {
  const {chapterTimeline, remainingSections} = await import('../../app/static/js/chapter-review.js');
  const p=preview({markers:[{at:0,ref:0},{at:581.333},{at:1918.059,ref:581.333},{at:3107.849,ref:3107.849}],
    published:[{at:0,title:'Opening Credits'},{at:581.333,title:'1. Prologue'},{at:1918.059,title:'I. Havana - Chapter 1'},{at:3107.849,title:'Chapter 2'}],missing:[1918.059]});
  const blocked=reviewModel(p,{});
  assert.equal(item(blocked,'m2').blockedBy.index,3);
  assert.equal(item(blocked,'s1918.059').options[0].rec,false,'skipping is never the suggested resolution of a conflict');
  let f=clearChoice(p,{},'m3');
  assert.ok(item(reviewModel(p,f),'m3'),'automatic matches can be opened for correction');
  f=applyChoice(f,{type:'section',index:3,sectionId:'1918.059'});
  assert.deepEqual(remainingSections(p,f).map(s=>s.id),['581.333'],'replaced recognition releases its previous section');
  assert.ok(item(reviewModel(p,f),'m2').options.some(o=>o.label==='1. Prologue'));
  f=applyChoice(f,{type:'section',index:2,sectionId:'581.333'});
  assert.equal(remainingSections(p,f).length,0);
  const rows=chapterTimeline(p,f);
  assert.deepEqual(rows.map(r=>r.seconds),[0,581.333,1918.059,3107.849]);
  assert.equal(rows[1].original,'Original marker 2');assert.equal(rows[1].planned,'1. Prologue');
  assert.equal(rows[2].planned,'I. Havana - Chapter 1');assert.equal(rows[2].manual,true);
  assert.equal(rows[2].passed,false,'manual corrections are not relabelled audio matches');
  const model=reviewModel(p,f);
  assert.equal(model.confirmed,3,'editing does not inflate the original recognition count');
  assert.ok(model.bar.ok+model.bar.done+model.bar.need<=100.00001,'edited matches are not double-counted in the bar');
});

test('the timeline preserves explicit rename, keep and removal without hiding current labels', async () => {
  const {chapterTimeline}=await import('../../app/static/js/chapter-review.js');
  const p=preview({markers:[{at:0,ref:0},{at:100},{at:200},{at:300}],published:[{at:0,title:'Opening'}]});
  const f={decisions:{2:{index:2,action:'rename',title:'My name'},3:{index:3,action:'keep'},4:{index:4,action:'remove',confirmed:true}}};
  const rows=chapterTimeline(p,f);
  assert.equal(rows[0].original,'Original marker 1');assert.equal(rows[0].planned,'Opening');
  assert.equal(rows[1].planned,'My name');assert.equal(rows[1].changed,true);
  assert.equal(rows[2].planned,'Original marker 3');assert.equal(rows[2].needsAttention,false);
  assert.match(rows[3].planned,/removed.*audio retained/);
});

test('chapter checks share suggestions without accepting them or changing the save plan', async () => {
  const {chapterTimeline}=await import('../../app/static/js/chapter-review.js');
  const p=preview({markers:[{at:0},{at:31.9},{at:581.3,ref:581.3}],
    published:[{at:0,title:'Opening Credits'},{at:31.9,title:'Front matter'},{at:581.3,title:'Prologue'}]});
  const f={}; const before=JSON.stringify({p,f});
  let rows=chapterTimeline(p,f);
  assert.equal(rows[0].proposal,'Opening Credits');
  assert.equal(rows[1].proposal,'Front matter');
  assert.equal(rows[0].planned,'Original marker 1','unselected suggestion never becomes the save plan');
  assert.equal(rows[0].manual,false);assert.equal(rows[0].passed,false);assert.equal(rows[0].needsAttention,true);
  assert.equal(rows[0].changed,false,'Changed describes the selected plan, not pending suggestions');
  assert.equal(JSON.stringify({p,f}),before,'preview never selects a suggestion');
  const chosen=applyChoice(f,{type:'section',index:1,sectionId:'0'});
  rows=chapterTimeline(p,chosen);
  assert.equal(rows[0].proposal,null);assert.equal(rows[0].planned,'Opening Credits');
  assert.equal(rows[0].manual,true);assert.equal(rows[0].passed,false);
  assert.equal(chapterTimeline(p,clearChoice(p,chosen,'m1'))[0].proposal,'Opening Credits');
  rows=chapterTimeline(p,{decisions:{1:{index:1,action:'keep'}}});
  assert.equal(rows[0].proposal,null);assert.equal(rows[0].planned,'Original marker 1');
  rows=chapterTimeline(p,clearChoice(p,{},'m3'));
  assert.equal(rows[2].reviewing,true);assert.equal(rows[2].needsAttention,true);
});
