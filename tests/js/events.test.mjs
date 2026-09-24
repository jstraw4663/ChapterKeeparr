import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffJobs, snapshot, destinationFor, ownAction } from '../../app/static/js/events.js';
import { job } from './fixtures.mjs';

test('destinations: needs review → review badge, other job news → queue, own actions → none', () => {
  assert.equal(destinationFor('warn'), 'review');
  assert.equal(destinationFor('ok'), 'queue');
  assert.equal(destinationFor('bad'), 'queue');
  assert.equal(destinationFor('info'), 'queue');
  assert.equal(destinationFor('plain'), null);
  assert.equal(ownAction('Details saved').dest, null);
});

test('the first poll only sets a baseline', () => {
  assert.deepEqual(diffJobs(null, [job({ status: 'awaiting_review' })]), []);
});

test('status changes become notifications with the right destination', () => {
  const running = job({ id: 'r', status: 'running', gateStates: ['passed', 'working'] });
  const before = snapshot([running]);
  const paused = { ...running, status: 'awaiting_review', workflow: { ...running.workflow, gates: running.workflow.gates.map(g => g.id === 'match' ? { ...g, state: 'review' } : g) } };
  const [event] = diffJobs(before, [paused]);
  assert.equal(event.kind, 'warn');
  assert.equal(event.dest, 'review');
  assert.equal(event.action, 'Review');
  assert.equal(event.href, '#/review/r');

  const [done] = diffJobs(before, [{ ...running, status: 'complete', workflow: { gates: running.workflow.gates.map(g => ({ ...g, state: 'passed' })) } }]);
  assert.equal(done.kind, 'ok');
  assert.equal(done.dest, 'queue');
});

test('resuming from review is announced as resumed', () => {
  const paused = job({ id: 'p', status: 'awaiting_review', gateStates: ['passed', 'review'] });
  const [event] = diffJobs(snapshot([paused]), [{ ...paused, status: 'running', workflow: { gates: paused.workflow.gates.map(g => g.id === 'match' ? { ...g, state: 'working' } : g) } }]);
  assert.match(event.title, /resumed$/);
  assert.equal(event.dest, 'queue');
});

test('a transition caused by the user’s own action is not announced twice', () => {
  const queued = job({ id: 'q', status: 'queued', gateStates: [] });
  const events = diffJobs(snapshot([queued]), [{ ...queued, status: 'cancelled' }], new Map([['q', 'cancelled']]));
  assert.deepEqual(events, []);
});

test('unchanged jobs produce nothing; new jobs are announced once', () => {
  const a = job({ id: 'a' });
  assert.deepEqual(diffJobs(snapshot([a]), [a]), []);
  const fresh = job({ id: 'n', status: 'queued', gateStates: [] });
  const [event] = diffJobs(snapshot([a]), [a, fresh]);
  assert.match(event.title, /queued$/);
});
