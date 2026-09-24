import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toStatus, stepOf, mp3State } from '../../app/static/js/status.js';
import { job } from './fixtures.mjs';

test('server statuses map onto the seven design statuses', () => {
  assert.equal(toStatus(job({ status: 'queued', gateStates: [] })).key, 'queued');
  assert.equal(toStatus(job({ status: 'running', gateStates: ['passed', 'working'] })).key, 'converting');
  assert.equal(toStatus(job({ status: 'awaiting_review', gateStates: ['passed', 'review'] })).key, 'review');
  assert.equal(toStatus(job({ status: 'failed', gateStates: ['passed', 'passed', 'blocked'] })).key, 'failed');
  assert.equal(toStatus(job({ status: 'cancelled' })).key, 'cancelled');
  assert.equal(toStatus(job({ status: 'complete' })).key, 'verified');
});

test('labels are the fixed status words', () => {
  const labels = ['queued', 'running', 'awaiting_review', 'failed', 'cancelled', 'complete']
    .map(status => toStatus(job({ status })).label);
  assert.deepEqual(labels, ['Queued', 'Converting', 'Needs review', 'Failed', 'Cancelled', 'Verified']);
});

test('optimized requires an EPUB and no source MP3s left; unknown never promotes', () => {
  const epub = { epub: { title: 'x', path: '/library/x.epub' } };
  assert.equal(toStatus(job({ report: { ...epub, mode: 'repair_existing' } })).key, 'optimized');
  assert.equal(toStatus(job({ report: { ...epub, mode: 'convert_then_repair', mp3s_deleted: 24 } })).key, 'optimized');
  assert.equal(toStatus(job({ report: { ...epub, mode: 'convert_then_repair', mp3s_deleted: 0 }, options: { keep_mp3s: true } })).key, 'verified');
  assert.equal(toStatus(job({ report: { ...epub } })).key, 'verified');
  assert.equal(toStatus(job({ report: { mode: 'repair_existing' } })).key, 'verified');
});

test('recovery acceptance always retains MP3s', () => {
  assert.equal(mp3State(job({ report: { mode: 'convert_then_repair', recovery_acceptance: {} } })), 'present');
});

test('align and verify both map to Check audio but keep the sub-check name', () => {
  const timing = stepOf(job({ status: 'running', gateStates: ['passed', 'passed', 'working'] }));
  const speech = stepOf(job({ status: 'running', gateStates: ['passed', 'passed', 'passed', 'working'] }));
  assert.deepEqual([timing.index, timing.sub, timing.state], [3, 'timing', 'current']);
  assert.deepEqual([speech.index, speech.sub], [3, 'speech']);
  assert.match(toStatus(job({ status: 'running', progress: 0.5, gateStates: ['passed', 'passed', 'passed', 'working'] })).detail, /Check audio · speech/);
});

test('failed jobs name the step they stopped at', () => {
  const s = toStatus(job({ status: 'failed', gateStates: ['passed', 'passed', 'blocked'] }));
  assert.equal(s.detail, 'Failed at step 3 · Check audio');
  assert.equal(s.canRetry, true);
});

test('paused review shows the paused step', () => {
  const step = stepOf(job({ status: 'awaiting_review', gateStates: ['passed', 'review'] }));
  assert.deepEqual([step.index, step.state], [2, 'paused']);
});

test('running percent comes from progress 0–1 and cancelling is reported', () => {
  const s = toStatus(job({ status: 'running', progress: 0.62, cancel_requested: true, gateStates: ['passed', 'working'] }));
  assert.equal(s.pct, 62);
  assert.equal(s.cancelling, true);
  assert.equal(s.canCancel, false);
  assert.equal(s.detail, 'Cancelling at the next safe point');
});

test('skipped: unchanged verified stays verified, nothing-to-convert reads failed without retry', () => {
  assert.equal(toStatus(job({ status: 'skipped', report: { output_sha256: 'abc' } })).key, 'verified');
  const none = toStatus(job({ status: 'skipped', report: { reason: 'No M4B and fewer than two MP3 files.' } }));
  assert.equal(none.key, 'failed');
  assert.equal(none.canRetry, false);
});
