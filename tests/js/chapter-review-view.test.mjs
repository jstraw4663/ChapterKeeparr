import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chapterReviewView} from '../../app/static/js/chapter-review-view.js';

const p={markers:[{index:1,title:'Old title',seconds:0,supported:false,removable:false,excerpt:'clip.wav'}],
  published_sections:[{id:'0',title:'Opening Credits'}],sections:[{id:'0',title:'Opening Credits'}],
  supported:0,total:1,supported_percent:0,default_minimum_percent:95};
test('draft comparisons render and recommendations remain unselected',()=>{
  const html=String(chapterReviewView(p,{}));
  assert.match(html,/title-pair/);assert.match(html,/Existing/);assert.match(html,/Proposed/);
  assert.match(html,/Not selected/);assert.match(html,/aria-pressed="false"/);
  assert.doesNotMatch(html,/aria-pressed="true"/);
});
test('only the clicked choice is pressed during the decision animation',()=>{
  const html=String(chapterReviewView(p,{closing:{m1:{final:'Opening Credits',decision:{action:'published',section_id:'0'},selectedChoice:{type:'section',index:1,sectionId:'0'}}}}));
  assert.equal((html.match(/aria-pressed="true"/g)||[]).length,1);
});

test('change overview distinguishes unselected suggestions, renames and removals',()=>{
  let output=String(chapterReviewView(p,{}));
  assert.match(output,/Changes at a glance/);assert.match(output,/0 title changes/);
  assert.match(output,/No changes selected yet/);assert.doesNotMatch(output,/cr-timeline|cr-lane/);
  output=String(chapterReviewView(p,{decisions:{1:{action:'published',section_id:'0'}}}));
  assert.match(output,/1 title change/);assert.match(output,/0 markers removed/);
  assert.match(output,/View 1 change in Chapter checks/);assert.match(output,/chapter-overview/);
  output=String(chapterReviewView(p,{decisions:{1:{action:'remove',confirm_remove:true}}}));
  assert.match(output,/1 marker removed/);assert.match(output,/Audio joins the previous chapter/);
});
