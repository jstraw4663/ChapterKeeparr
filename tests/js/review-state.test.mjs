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
