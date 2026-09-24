import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, legacyJobTarget } from '../../app/static/js/router.js';

test('new routes', () => {
  assert.equal(parse('#/').name, 'library');
  assert.equal(parse('').name, 'library');
  assert.equal(parse('#/queue?job=abc').query.get('job'), 'abc');
  assert.deepEqual([parse('#/review/x%20y').name, parse('#/review/x%20y').id], ['review', 'x y']);
  assert.equal(parse('#/review').id, undefined);
  assert.deepEqual([parse('#/books/j1').name, parse('#/books/j1').id], ['book', 'j1']);
  assert.equal(parse('#/new').name, 'newjob');
  assert.equal(parse('#/settings/server').section, 'server');
  assert.equal(parse('#/nope').redirect, '#/');
});

test('old UI hashes redirect', () => {
  assert.equal(parse('#overview').redirect, '#/');
  assert.equal(parse('#jobs').redirect, '#/queue');
  assert.equal(parse('#jobs?filter=review').redirect, '#/review');
  assert.equal(parse('#jobs?filter=complete').redirect, '#/?filter=verified');
  assert.equal(parse('#new-job').redirect, '#/new');
  assert.equal(parse('#settings').redirect, '#/settings');
  assert.deepEqual(parse('#job/abc?match'), { legacyJob: 'abc', match: true });
});

test('legacy job links land by status', () => {
  const book = key => ({ id: 'j', status: { key } });
  assert.equal(legacyJobTarget(book('review'), true), '#/review/j?match');
  assert.equal(legacyJobTarget(book('verified')), '#/books/j');
  assert.equal(legacyJobTarget(book('failed')), '#/queue?job=j');
  assert.equal(legacyJobTarget(null), '#/queue');
});
