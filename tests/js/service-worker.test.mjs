import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../app/static/sw.js', import.meta.url), 'utf8');

function worker() {
  const handlers = {}, calls = { activated: 0, network: 0 };
  const cached = { body: 'installed shell asset' };
  const cache = { addAll: async () => {}, match: async () => cached, put: async () => {} };
  const self = { location: { origin: 'http://fixture' }, addEventListener: (name, fn) => { handlers[name] = fn; }, skipWaiting: () => { calls.activated++; } };
  vm.runInNewContext(source, { self, URL, caches: { open: async () => cache }, fetch: async () => { calls.network++; return { body: 'new server asset' }; } });
  return { handlers, calls, cached };
}

test('installing a new shell does not interrupt an existing review tab', async () => {
  const { handlers, calls } = worker();
  let installed;
  handlers.install({ waitUntil: promise => { installed = promise; } });
  await installed;
  assert.equal(calls.activated, 0);
  handlers.message({ data: 'unrelated' }); assert.equal(calls.activated, 0);
  handlers.message({ data: 'ACTIVATE_UPDATE' }); assert.equal(calls.activated, 1);
});

test('a controlled tab keeps its installed shell assets and never caches API responses', async () => {
  const { handlers, calls, cached } = worker();
  let response;
  handlers.fetch({ request: { method: 'GET', url: 'http://fixture/static/js/main.js' }, respondWith: promise => { response = promise; } });
  assert.equal(await response, cached); assert.equal(calls.network, 0);
  response = undefined;
  handlers.fetch({ request: { method: 'GET', url: 'http://fixture/api/settings' }, respondWith: promise => { response = promise; } });
  assert.equal(response, undefined);
});
