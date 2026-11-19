'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {assessChefAttention}=require('./master-wok-chef-attention');
const job=(itemId,start,finish)=>({itemId,start,finish,orderIds:['a']});
const plan=jobs=>({wok:{jobs},fryer:{jobs:[]},auxiliary:{jobs:[]}});
const full={phases:[{role:'mains',startOffset:0,finishOffset:'finish'}]};
test('separates start and finish work from simmering, with half-open boundaries',()=>{
 const result=assessChefAttention(plan([job('curry',0,10),job('noodles',2,8)]),{profiles:{'wok:curry':{phases:[{role:'mains',startOffset:0,finishOffset:2},{role:'mains',startOffset:8,finishOffset:10}]},'wok:noodles':full},capacities:{mains:1}});
 assert.equal(result.status,'WITHIN_SUPPLIED_ASSUMPTIONS');assert.ok(result.intervals.every(i=>i.demand===1));assert.equal(result.bookingApprovalAllowed,false);
});
test('reports simultaneous active dishes without counting portions or duplicate phases as chefs',()=>{
 const duplicate={phases:[...full.phases,...full.phases]};
 const result=assessChefAttention(plan([job('a',0,5),job('b',1,4)]),{profiles:{'wok:a':duplicate,'wok:b':full},capacities:{mains:1}});
 assert.equal(result.status,'REQUIRES_KITCHEN_REVIEW');assert.equal(Math.max(...result.intervals.map(i=>i.demand)),2);
});
test('unknown recipes and staffing remain incomplete rather than gaining approval',()=>{
 assert.equal(assessChefAttention(plan([job('unknown',0,5)])).status,'INCOMPLETE_ATTENTION_MODEL');
 assert.deepEqual(assessChefAttention(plan([job('a',0,5)]),{profiles:{'wok:a':full}}).missingRoles,['mains']);
});
test('starter chef and mains chef are separate and input plan is unchanged',()=>{
 const p=plan([job('a',0,5)]);p.fryer.jobs=[job('b',0,5)];const before=JSON.stringify(p);
 const result=assessChefAttention(p,{profiles:{'wok:a':full,'fryer:b':{phases:[{role:'starters',startOffset:0,finishOffset:'finish'}]}},capacities:{mains:1,starters:1}});
 assert.equal(result.status,'WITHIN_SUPPLIED_ASSUMPTIONS');assert.equal(JSON.stringify(p),before);
});
test('rejects missing resource sections, invalid times and phases outside cooking',()=>{
 assert.throws(()=>assessChefAttention({}),/INCOMPLETE/);
 assert.throws(()=>assessChefAttention(plan([job('a',5,0)])),/INVALID_JOB/);
 assert.throws(()=>assessChefAttention(plan([job('a',0,5)]),{profiles:{'wok:a':{phases:[{role:'mains',startOffset:0,finishOffset:6}]}}}),/INVALID_ATTENTION_PHASE/);
});
test('a shared fryer batch counts once and retains its contributing dishes',()=>{
 const p=plan([]);p.fryer.jobs=[{type:'crispyChicken',itemIds:['salt-chicken','stir-crispy'],start:0,finish:5,orderIds:['a','b']}];
 const unknown=assessChefAttention(p);assert.equal(unknown.unprofiled[0].itemId,'crispyChicken');assert.deepEqual(unknown.unprofiled[0].itemIds,['salt-chicken','stir-crispy']);
 const r=assessChefAttention(p,{profiles:{'fryer:crispyChicken':{phases:[{role:'starters',startOffset:0,finishOffset:'finish'}]}},capacities:{starters:1}});
 assert.equal(r.status,'WITHIN_SUPPLIED_ASSUMPTIONS');assert.equal(r.intervals[0].demand,1);
});
