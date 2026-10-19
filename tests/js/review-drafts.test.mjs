import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveDraft, loadDraft, acceptedDraft, clearDraft } from '../../app/static/js/review-drafts.js';
const storage = new Map();
globalThis.localStorage = {getItem:k=>storage.get(k) ?? null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
test('book edits survive serialization, are isolated and bound to evidence', () => {
  const a={accept:{token:'old',decisions:{64:{action:'rename',title:'Chapter 61'}},sections:['credits'],min:'90',gap:true,busy:true,message:'failed'}};
  assert.equal(saveDraft('a',a),true);
  saveDraft('b',{accept:{token:'other'}});
  a.accept.decisions[64].title='mutated';
  assert.equal(acceptedDraft('a','old').decisions[64].title,'Chapter 61');
  assert.deepEqual(acceptedDraft('a','new'),{token:'new'});
  assert.equal(loadDraft('a').accept.busy,undefined);
  assert.equal(loadDraft('a').accept.message,undefined);
  const restored=acceptedDraft('a','old');restored.min='50';
  assert.equal(loadDraft('a').accept.min,'90');
  clearDraft('a');assert.equal(loadDraft('a'),null);
  assert.equal(loadDraft('b').accept.token,'other');
});
test('storage failure retains tab memory and reports lack of persistence', () => {
  const original=localStorage.setItem;
  localStorage.setItem=()=>{throw Error('quota');};
  assert.equal(saveDraft('quota',{accept:{token:'x',min:91}}),false);
  assert.equal(acceptedDraft('quota','x').min,91);
  localStorage.setItem=original;
});

test('unassigned sections sort by absolute distance with stable ties', async () => {
  const { nearestUnassignedSections } = await import('../../app/static/js/review-drafts.js');
  const p={markers:[{index:1,reference_id:'100'},{index:2}],published_sections:[{id:'0',title:'Opening'},{id:'100',title:'Used'},{id:'200',title:'Later'},{id:'500',title:'Manually used'}]};
  const ds=[{index:1,action:'keep'},{index:2,action:'published',section_id:'500'}];
  assert.deepEqual(nearestUnassignedSections(p,ds,0).map(s=>s.id),['0','200']);
  assert.deepEqual(nearestUnassignedSections(p,ds,700).map(s=>s.id),['200','0']);
  assert.deepEqual(nearestUnassignedSections(p,ds,100).map(s=>s.id),['0','200']);
  ds[1].action='remove';
  assert.equal(nearestUnassignedSections(p,ds,500)[0].id,'500');
});

test('bulk recommendations require unique close timing and preserve edits', async () => {
  const { clearRecommendations } = await import('../../app/static/js/review-drafts.js');
  const p={markers:[{index:1,seconds:0,supported:false},{index:2,seconds:100,supported:false}],published_sections:[{id:'0',title:'Opening'},{id:'102',title:'Chapter'}]};
  const ds=p.markers.map(m=>({index:m.index,action:'keep'}));
  assert.equal(clearRecommendations(p,ds).length,2);
  assert.equal(clearRecommendations(p,ds,{1:{action:'rename'}}).length,1);
  assert.equal(clearRecommendations(p,ds,{},()=>false).length,0);
  p.published_sections.push({id:'104',title:'Competitor'});
  assert.deepEqual(clearRecommendations(p,ds).map(d=>d.index),[1]);
  p.published_sections=[{id:'40',title:'Far'}];assert.equal(clearRecommendations(p,ds).length,0);
  p.markers[1].seconds=2;p.published_sections=[{id:'0',title:'Shared'}];
  assert.equal(clearRecommendations(p,ds).length,0);
});
