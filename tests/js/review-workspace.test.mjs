import {test} from 'node:test';
import assert from 'node:assert/strict';
import {workspaceModel,editorItem,applyChoice,clearChoice,matchesFilter,foldRows,clusterPins,cycleItem} from '../../app/static/js/chapter-review.js';
const p={ready:true,token:'draft',supported:1,total:2,supported_percent:50,default_minimum_percent:50,coverage_warnings:[],
 markers:[{index:1,title:'Track 1',seconds:0,supported:true,suggested_title:'Opening',reference_id:'0',removable:false},{index:2,title:'Track 2',seconds:60,supported:false,removable:true}],
 published_sections:[{id:'0',title:'Opening'},{id:'61',title:'Chapter 1'},{id:'180',title:'Bonus'}],sections:[{id:'180',title:'Bonus'}]};
test('all markers can be focused and confirmed matches overridden and restored',()=>{
 let f={focus:'m1'};let m=workspaceModel(p,f);assert.equal(m.rows.length,3);assert.equal(m.focused.id,'m1');
 assert.equal(editorItem(p,f,'m1').options[0].key,'restore');assert.equal(editorItem(p,f,'m1').canRemove,false);
 f=applyChoice(f,{type:'rename',index:1,title:'Custom'});m=workspaceModel(p,f);assert.equal(m.rows[0].after,'Custom');assert.equal(m.rows[0].status,'By you');assert.equal(m.pct,50);
 f=applyChoice(f,{type:'restore',index:1});assert.equal(workspaceModel(p,f).rows[0].after,'Opening');
});
test('filtering retains decided review items and folds contiguous other rows',()=>{
 const f=applyChoice({}, {type:'keep',index:2});const m=workspaceModel(p,f);
 assert.ok(matchesFilter(m.rows.find(r=>r.id==='m2'),'need'));
 assert.equal(matchesFilter(m.rows[0],'need'),false);
 const folded=foldRows(m.rows,'need');assert.equal(folded[0].fold,true);
 assert.equal(foldRows(m.rows,'need',{m1:true})[1].id,'m1');
 assert.equal(cycleItem([],null),null);assert.equal(cycleItem(m.rows,m.rows.at(-1).id).id,'m1');
});
test('pins cluster, clamp and ignore decisions',()=>{
 const rows=[{id:'a',seconds:0,pending:true},{id:'b',seconds:10,pending:true},{id:'c',seconds:999,pending:true},{id:'d',seconds:500,pending:false}];
 const c=clusterPins(rows,1000,2.5);assert.equal(c.length,2);assert.equal(c[0].rows.length,2);assert.equal(c[0].position,3);assert.equal(c[1].position,97);assert.deepEqual(clusterPins(rows,0,8),[]);
});
test('save guards readiness, exact coverage, consent and original evidence count',()=>{
 let f=applyChoice({}, {type:'keep',index:2});f=applyChoice(f,{type:'skip',sectionId:'180'});f.gap=true;
 assert.equal(workspaceModel(p,f).canSave,true);
 assert.equal(workspaceModel({...p,ready:false},f).canSave,false);
 assert.equal(workspaceModel({...p,supported_percent:49.999},f).canSave,false);
 assert.equal(workspaceModel({...p,supported:0,supported_percent:0},{...f,min:1}).canSave,false);
 assert.equal(workspaceModel(p,{...f,min:49.9}).canSave,true);
 assert.equal(workspaceModel(p,{...f,min:''}).canSave,false);
});
test('empty preview is safe',()=>{
 const m=workspaceModel({...p,markers:[],sections:[],published_sections:[],supported:0,total:0,supported_percent:0},{});
 assert.equal(m.focused,undefined);assert.equal(m.canSave,false);
});

test('reference timeline uses real duration and keeps unmatched sections distinct',async()=>{
 const {reviewTimeline}=await import('../../app/static/js/chapter-review.js');
 assert.equal(reviewTimeline(p,{}),null);
 const t=reviewTimeline({...p,duration_seconds:240},{focus:'m2'});
 assert.equal(t.duration,240);assert.equal(t.rows.find(r=>r.id==='m2').position,25);
 assert.equal(t.sections.find(s=>s.id==='180').missing.pending,true);
 assert.equal(reviewTimeline(p,{},300).duration,300);
});
