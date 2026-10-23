import test from 'node:test';
import assert from 'node:assert/strict';
import {resourceCache} from '../../app/static/js/resource-cache.js';
import {api} from '../../app/static/js/api.js';
import {state,refresh,loadSettings,subscribe} from '../../app/static/js/store.js';
import {job} from './fixtures.mjs';
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

test('reads coalesce and keep visible data while a newer version loads',async()=>{
 const pending=[];const cache=resourceCache(()=>{const d=deferred();pending.push(d);return d.promise;});
 const first=cache.read('book',1);assert.equal(cache.read('book',1),first);await flush();assert.equal(pending.length,1);
 pending[0].resolve({chapters:['one']});await first.promise;
 const next=cache.read('book',2);assert.deepEqual(next.value,{chapters:['one']});assert.equal(next.loading,true);
 await flush();pending[1].resolve({chapters:['two']});await next.promise;assert.equal(next.loading,false);assert.deepEqual(cache.get('book').value,{chapters:['two']});
});
test('superseded responses cannot publish old data even if a transport ignores abort',async()=>{
 const pending=[];const cache=resourceCache((key,{signal})=>{const d=deferred();pending.push({...d,signal});return d.promise;});
 const old=cache.read('book',1);await flush();const next=cache.read('book',2);await flush();
 assert.equal(pending[0].signal.aborted,true);
 pending[1].resolve('new');await next.promise;pending[0].resolve('old');assert.equal(await old.promise,'new');assert.equal(cache.get('book').value,'new');
});
test('a failed refresh retains its old value and exposes an error',async()=>{
 let fail=false;const cache=resourceCache(async()=>{if(fail)throw Error('Offline');return ['chapters'];});
 await cache.read('book',1).promise;fail=true;const next=cache.read('book',2);await assert.rejects(next.promise,/Offline/);
 assert.deepEqual(next.value,['chapters']);assert.equal(next.error,'Offline');assert.equal(next.loading,false);
});
test('cache is bounded and aborts an evicted pending request',async()=>{
 const cache=resourceCache(()=>new Promise(()=>{}),2);const a=cache.read('a',1);cache.read('b',1);cache.read('c',1);
 assert.equal(cache.get('a'),undefined);assert.equal(a.controller.signal.aborted,true);
});
test('post-mutation refresh serializes a fresh read and drops its known-stale predecessor',async t=>{
 const original=globalThis.document;globalThis.document={hidden:false};t.after(()=>{if(original===undefined)delete globalThis.document;else globalThis.document=original;});
 t.mock.method(globalThis,'setTimeout',()=>0);
 const pending=[];t.mock.method(api,'listJobs',()=>{const d=deferred();pending.push(d);return d.promise;});
 const seen=[];const unsub=subscribe(()=>seen.push(state.jobs.map(j=>j.id)));t.after(unsub);
 const first=refresh();assert.equal(refresh(),first);const fresh=refresh({fresh:true});assert.equal(first,fresh);assert.equal(pending.length,1);
 pending[0].resolve([job({id:'stale'})]);await flush();assert.equal(pending.length,2);assert.equal(seen.length,0);
 pending[1].resolve([job({id:'fresh'})]);await Promise.all([first,fresh]);assert.deepEqual(seen,[['fresh']]);
});
test('startup settings reads cannot overwrite a later successful save',async t=>{
 const d=deferred();t.mock.method(api,'settings',()=>d.promise);const before=state.settings;
 t.after(()=>{state.settings=before;});const p=loadSettings();assert.equal(loadSettings(),p);
 const saved={recovery_minimum_percent:97};state.settings=saved;d.resolve({recovery_minimum_percent:80});assert.equal(await p,saved);assert.equal(state.settings,saved);
});

test('a read without a known summary version still loads exactly once',async()=>{
 let calls=0;const cache=resourceCache(async()=>{calls++;return 'detail';});
 assert.equal(await cache.read('book',undefined).promise,'detail');
 assert.equal(await cache.read('book',undefined).promise,'detail');assert.equal(calls,1);
});
