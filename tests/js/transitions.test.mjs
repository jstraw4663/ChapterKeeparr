import test from 'node:test';
import assert from 'node:assert/strict';
import { kindOf } from '../../app/static/js/transitions.js';

const r = (name, id, nav = name) => ({ name, id, nav });

test('first render has no transition', () => {
  assert.equal(kindOf(null, r('library'), false), 'none');
});

test('opening a detail pushes and leaving it pops', () => {
  assert.equal(kindOf(r('library'), r('book', 'b1', 'library'), true), 'push');
  assert.equal(kindOf(r('book', 'b1', 'library'), r('library'), true), 'pop');
  assert.equal(kindOf(r('review'), r('review', 'b1'), true), 'push');
});

test('desktop review split view switches in place', () => {
  assert.equal(kindOf(r('review', 'a'), r('review', 'b'), false), 'same');
  assert.equal(kindOf(r('review'), r('review', 'b'), false), 'same');
});

test('top-level tabs slide by sidebar order', () => {
  assert.equal(kindOf(r('library'), r('queue'), false), 'tab-right');
  assert.equal(kindOf(r('queue'), r('library'), false), 'tab-left');
  assert.equal(kindOf(r('settings'), r('settings'), false), 'same');
});

test('a skipped navigation cannot swap an older screen after the latest screen', async t => {
  const { transition } = await import('../../app/static/js/transitions.js');
  const callbacks=[], finishes=[], effects=[], before=globalThis.document;
  globalThis.document={hidden:false,documentElement:{dataset:{}},startViewTransition(callback){
    callbacks.push(callback);return {skipTransition(){},ready:Promise.resolve(),finished:new Promise(resolve=>finishes.push(resolve))};
  }};
  t.after(()=>{if(before===undefined)delete globalThis.document;else globalThis.document=before;});
  transition('push',()=>effects.push('old'));
  transition('push',()=>effects.push('new'));
  await callbacks[1]();await callbacks[0]();
  finishes.forEach(resolve=>resolve());await Promise.resolve();await Promise.resolve();
  assert.deepEqual(effects,['new']);
});
