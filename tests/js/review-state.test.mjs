import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptanceState, draftApproval } from '../../app/static/js/review-state.js';

const preview = { ready: true, token: 'one', supported_percent: 96, default_minimum_percent: 95, sections: [{ id: 'credits' }], unresolved_markers: [{}] };
const approval = { token: 'one', gap: true, preserve: true, sections: ['credits'] };

test('off/on/off visibility is independent of publication requirements', () => {
  assert.equal(acceptanceState(preview, { ...approval, gap: false }).visible, false);
  assert.equal(acceptanceState(preview, approval).enabled, true);
  const below = acceptanceState({ ...preview, supported_percent: 91.9 }, approval);
  assert.equal(below.visible, true); assert.equal(below.enabled, false);
  assert.match(below.problem, /95%/);
  assert.equal(acceptanceState(preview, { ...approval, gap: false }).enabled, false);
});

test('every existing approval, busy, connection and numeric gate still blocks', () => {
  for (const form of [{ ...approval, min: '' }, { ...approval, min: NaN }, { ...approval, min: 101 }, { ...approval, sections: [] }, { ...approval, preserve: false }, { ...approval, busy: true }]) {
    assert.equal(acceptanceState(preview, form).enabled, false);
  }
  assert.equal(acceptanceState(preview, approval, { connected: false }).enabled, false);
  assert.equal(acceptanceState(preview, approval, { authNeeded: true }).enabled, false);
  assert.equal(acceptanceState({ ...preview, ready: false }, approval).enabled, false);
  assert.equal(acceptanceState({ ...preview, token: '' }, approval).enabled, false);
  assert.equal(acceptanceState({ ...preview, supported_percent: NaN }, approval).enabled, false);
});

test('a changed draft discards consent and per-section choices, unchanged polling keeps them', () => {
  assert.equal(draftApproval(preview, approval), approval);
  const reset = draftApproval({ ...preview, token: 'two' }, approval);
  assert.equal(reset.token, 'two'); assert.equal(reset.gap, undefined); assert.equal(reset.sections, undefined);
  assert.match(reset.message, /changed/);
});

test('ordered decisions share the submit gates and never carry consent across tokens', () => {
  const p = { ready: true, token: 'ordered', supported: 2, total: 3, supported_percent: 66.6666666667, default_minimum_percent: 60,
    markers: [{ index: 1, seconds: 0, title: 'A', supported: true, reference_id: '0' }, { index: 2, seconds: 10, title: 'Unknown', removable: true }, { index: 3, seconds: 20, title: 'C', supported: true, reference_id: '20' }],
    published_sections: [{ id: '0', title: 'A' }, { id: '10', title: 'B' }, { id: '20', title: 'C' }, { id: '30', title: 'Missing' }], sections: [{ id: '10', title: 'B' }, { id: '30', title: 'Missing' }] };
  let f = { token: 'ordered', gap: true };
  assert.equal(acceptanceState(p, f).enabled, false, 'an untouched default keep is not an explicit decision');
  f = { ...f, decisions: { 2: { index: 2, action: 'published', section_id: '10' } }, sections: ['30'] };
  assert.equal(acceptanceState(p, f).enabled, true, 'an assigned section does not also need optional consent');
  for (const patch of [{ gap: false }, { min: 95 }, { token: 'older' }, { busy: true }, { closing: {} }]) assert.equal(acceptanceState(p, { ...f, ...patch }).enabled, false);
  assert.equal(acceptanceState(p, { ...f, decisions: { 2: { index: 2, action: 'published', section_id: '0' } }, sections: ['10','30'] }).enabled, false, 'duplicate identities block submission');
  assert.equal(acceptanceState(p, { ...f, decisions: { 2: { index: 2, action: 'published', section_id: 'unknown' } }, sections: ['10','30'] }).enabled, false);
  assert.equal(acceptanceState(p, { ...f, decisions: { 2: { index: 2, action: 'rename', title: 'Custom' } }, sections: ['30'] }).enabled, false, 'renaming does not resolve published identity');
  assert.equal(acceptanceState(p, { ...f, decisions: { 2: { index: 2, action: 'rename', title: 'Custom' } }, sections: ['10','30'] }).enabled, true);
  assert.equal(acceptanceState(p, f, { connected: false }).enabled, false);
  assert.equal(acceptanceState(p, f, { authNeeded: true }).enabled, false);
});

test('explicit order overrides match server validation on either member of an inverted pair', () => {
  const p = { ready: true, token: 'order', supported_percent: 25, default_minimum_percent: 20,
    markers: [{ index: 1, seconds: 0, title: 'Opening', supported: true, reference_id: '0' },
      { index: 2, seconds: 10, title: 'Unknown' }, { index: 3, seconds: 20, title: 'Unknown' }, { index: 4, seconds: 30, title: 'Unknown' }],
    published_sections: ['0','10','20','30'].map(id => ({ id, title: id })), sections: [] };
  const decisions = { 2: { index: 2, action: 'published', section_id: '20' },
    3: { index: 3, action: 'published', section_id: '10' }, 4: { index: 4, action: 'keep' } };
  const f = { token: 'order', gap: true, decisions };
  assert.equal(acceptanceState(p, f).enabled, false);
  for (const index of [2, 3]) {
    assert.equal(acceptanceState(p, { ...f, decisions: { ...decisions, [index]: { ...decisions[index], override_order: true } } }).enabled, true);
  }
  assert.equal(acceptanceState(p, { ...f, decisions: { ...decisions, 4: { index: 4, action: 'published', section_id: '20', override_order: true } } }).enabled, false, 'overrides never allow duplicates');
});
