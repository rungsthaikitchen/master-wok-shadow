'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {planWithProtectedWork,protectStartedWork}=require('./master-wok-protected-plan');
const {remapPlanOrder}=require('./master-wok-service-plan-store');
function fixture(id='a',ready=1140,item='stir-crispy'){
 return {order:{orderId:id,readyMinute:ready,placedAt:new Date(2026,10,4,16,0)},
  row:{id,items:[{item_id:item,qty:1,modifiers:[],spice:1}]}};
}
function initial(){
 const a=fixture();const r=planWithProtectedWork({orders:[a.order],rows:[a.row],
  now:'2026-11-04T16:00:00Z',serviceDate:'2026-11-04'});
 assert.equal(r.status,'VALIDATED_PROTECTED_PLAN');return {a,plan:r.plan};
}
function instant(minute){return '2026-11-04T'+String(Math.floor(minute/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0')+':00Z';}
test('new booking cannot move an already-started wok batch',()=>{
 const {a,plan}=initial(),b=fixture('b',1200,'green-curry');
 const r=planWithProtectedWork({orders:[a.order,b.order],rows:[a.row,b.row],previousPlan:plan,
  now:instant(plan.wok.jobs[0].start+1),serviceDate:'2026-11-04',newOrderId:'b'});
 assert.equal(r.status,'VALIDATED_PROTECTED_PLAN');
 assert.deepEqual(r.plan.wok.jobs.find(j=>j.orderIds.includes('a')),plan.wok.jobs[0]);
 assert.equal(r.protectedJobs.wok.length,1);
});
test('frying already underway also freezes the downstream wok batch',()=>{
 const {plan}=initial(),fixed=protectStartedWork(plan,plan.fryer.jobs[0].start+1);
 assert.equal(fixed.wok.length,1);assert.equal(fixed.fryer.length,1);
 assert.deepEqual(fixed.wok[0],plan.wok.jobs[0]);
});
test('cancellation keeps started resources reserved without requiring chef input',()=>{
 const {plan}=initial(),b=fixture('b',1200,'green-curry');
 const r=planWithProtectedWork({orders:[b.order],rows:[b.row],previousPlan:plan,
  now:instant(plan.fryer.jobs[0].start+1),serviceDate:'2026-11-04',newOrderId:'b'});
 assert.equal(r.status,'VALIDATED_PROTECTED_PLAN');
 assert.deepEqual(r.plan.wok.jobs.find(j=>j.orderIds.includes('a')),plan.wok.jobs[0]);
});
test('cancellation before cooking starts removes unstarted demand',()=>{
 const {plan}=initial(),b=fixture('b',1200,'green-curry');
 const r=planWithProtectedWork({orders:[b.order],rows:[b.row],previousPlan:plan,
  now:'2026-11-04T18:00:00Z',serviceDate:'2026-11-04',newOrderId:'b'});
 assert.equal(r.status,'VALIDATED_PROTECTED_PLAN');
 assert.ok(r.plan.wok.jobs.every(j=>!j.orderIds.includes('a')));
});
test('changing the recipe of an active started batch fails closed',()=>{
 const {a,plan}=initial();a.row.items[0].spice=3;
 const r=planWithProtectedWork({orders:[a.order],rows:[a.row],previousPlan:plan,
  now:instant(plan.wok.jobs[0].start+1),serviceDate:'2026-11-04'});
 assert.equal(r.reason,'STARTED_WORK_CHANGED');
});
test('missing historical plan cannot bootstrap unseen running-service activity',()=>{
 const a=fixture();
 const r=planWithProtectedWork({orders:[a.order],rows:[a.row],now:'2026-11-04T18:00:00Z',serviceDate:'2026-11-04'});
 assert.equal(r.reason,'COMMITTED_PLAN_REQUIRED_DURING_SERVICE');
});
test('corrupt saved resource overlaps are rejected',()=>{
 const {plan}=initial();plan.wok.jobs.push({...plan.wok.jobs[0]});
 assert.throws(()=>protectStartedWork(plan,1100),/RESOURCE_CLASH/);
});
test('temporary candidate identity maps to the persisted order commitment identity',()=>{
 const {plan}=initial(),mapped=remapPlanOrder(plan,'a','uuid@time');
 assert.deepEqual(mapped.wok.jobs[0].orderIds,['uuid@time']);
 assert.equal(mapped.fryer.jobs[0].allocations[0].orderId,'uuid@time');
 assert.deepEqual(plan.wok.jobs[0].orderIds,['a']);
});
