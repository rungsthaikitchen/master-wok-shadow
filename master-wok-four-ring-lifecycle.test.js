'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {planWithProtectedWork,protectStartedWork}=require('./master-wok-protected-plan');
const options={serviceDate:'2026-11-07',sharedRings:true,stagingSharedRings:true,
 confirmedStarterRecipes:true,standaloneSpringRolls:true};
const line=(item_id,qty=1)=>({item_id,qty,modifiers:[],spice:null});
const fixture=(id,items,readyMinute=1215)=>({order:{orderId:id,readyMinute,placedAt:new Date(2026,10,7,15)},row:{id,items}});
const instant=minute=>`2026-11-07T${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}:00Z`;
function initial(a){
 const r=planWithProtectedWork({...options,orders:[a.order],rows:[a.row],now:instant(900)});
 assert.equal(r.status,'VALIDATED_PROTECTED_PLAN');return r.plan;
}
function checkFixed(result,fixed){
 assert.equal(result.status,'VALIDATED_PROTECTED_PLAN',JSON.stringify(result));
 for(const resource of ['wok','fryer','auxiliary'])for(const job of fixed[resource])
  assert.ok(result.plan[resource].jobs.some(j=>JSON.stringify(j)===JSON.stringify(job)),resource);
 assert.equal(result.bookingApprovalAllowed,false);
}
test('new order uses a free ring while a started curry remains immovable',()=>{
 const a=fixture('a',[line('green-curry')]),b=fixture('b',[line('pad-thai')],1220),plan=initial(a);
 const r=planWithProtectedWork({...options,orders:[a.order,b.order],rows:[a.row,b.row],previousPlan:plan,now:instant(1211),newOrderId:'b'});
 checkFixed(r,protectStartedWork(plan,1211));
 const first=r.plan.wok.jobs.find(j=>j.orderIds.includes('a')),next=r.plan.wok.jobs.find(j=>j.orderIds.includes('b'));
 assert.ok(next.start<first.finish);assert.notEqual(next.vessel,first.vessel);
});
test('four occupied rings block a fifth simultaneous cook but allow a later order',()=>{
 const a=fixture('a',['green-curry','red-curry','panang-curry','rung-curry'].map(id=>line(id))),plan=initial(a);
 for(const [ready,accepted] of [[1215,false],[1225,true]]){
  const b=fixture('b',[line('green-curry')],ready);
  const r=planWithProtectedWork({...options,orders:[a.order,b.order],rows:[a.row,b.row],previousPlan:plan,now:instant(1210),newOrderId:'b'});
  assert.equal(r.status,accepted?'VALIDATED_PROTECTED_PLAN':'UNVERIFIED');
  if(accepted)checkFixed(r,protectStartedWork(plan,1210));
 }
});
test('started fryer and microwave prerequisites freeze downstream jobs through cancellation',()=>{
 const a=fixture('a',['stir-crispy','coconut-rice','pork-dumplings'].map(id=>line(id))),plan=initial(a);
 for(const minute of [plan.fryer.jobs[0].start,plan.auxiliary.jobs.find(j=>j.itemId==='coconut-rice').start]){
  const fixed=protectStartedWork(plan,minute);
  assert.ok(fixed.wok.length);
  const r=planWithProtectedWork({...options,orders:[],rows:[],previousPlan:plan,now:instant(minute)});
  checkFixed(r,fixed);
  assert.equal(r.plan.wok.jobs.length,fixed.wok.length);
 }
});
test('time changes replan unstarted food and reject changes to started food',()=>{
 const a=fixture('a',[line('green-curry')]),plan=initial(a);
 const changed={...a.order,readyMinute:1230};
 assert.equal(planWithProtectedWork({...options,orders:[changed],rows:[a.row],previousPlan:plan,now:instant(1100)}).status,'VALIDATED_PROTECTED_PLAN');
 const late=planWithProtectedWork({...options,orders:[changed],rows:[a.row],previousPlan:plan,now:instant(1211)});
 assert.equal(late.reason,'STARTED_WORK_CHANGED');
 const cancelled=planWithProtectedWork({...options,orders:[],rows:[],previousPlan:plan,now:instant(1100)});
 assert.equal(cancelled.status,'VALIDATED_PROTECTED_PLAN');assert.deepEqual(cancelled.plan.wok.jobs,[]);
});
test('saved parallel plans reject invalid vessels and ring overload',()=>{
 const plan=initial(fixture('a',['green-curry','red-curry','panang-curry','rung-curry'].map(id=>line(id))));
 const wrong=structuredClone(plan);wrong.wok.jobs[0].vessel='unknown';
 assert.throws(()=>protectStartedWork(wrong,1210),/RESOURCE_CLASH/);
 const fifth=structuredClone(plan);fifth.wok.jobs.push({...fifth.wok.jobs[0],vessel:'pan-5'});
 assert.throws(()=>protectStartedWork(fifth,1210),/RESOURCE_CLASH/);
 const batch=structuredClone(plan);batch.wok.jobs[0].portions=2;
 assert.throws(()=>protectStartedWork(batch,1210),/RESOURCE_CLASH/);
});
test('scheduler model changes require a drain in both directions',()=>{
 const a=fixture('a',[line('green-curry')]),parallel=initial(a);
 const single=planWithProtectedWork({orders:[a.order],rows:[a.row],now:instant(900),serviceDate:options.serviceDate});
 assert.equal(single.status,'VALIDATED_PROTECTED_PLAN');
 assert.equal(planWithProtectedWork({...options,orders:[a.order],rows:[a.row],previousPlan:single.plan,now:instant(900)}).reason,'SCHEDULER_MODEL_CHANGE_REQUIRES_DRAIN');
 assert.equal(planWithProtectedWork({orders:[a.order],rows:[a.row],previousPlan:parallel,now:instant(900),serviceDate:options.serviceDate}).reason,'SCHEDULER_MODEL_CHANGE_REQUIRES_DRAIN');
});
test('two customer £150 plans retain started work when adding or cancelling orders',()=>{
 const examples=require('./staging-tests/large-basket-examples');
 for(const name of ['mixed','startersAndCurries']){
  const a=fixture('a',examples[name]),plan=initial(a),b=fixture('b',[line('green-curry')],1260);
  const minute=Math.min(...[...plan.wok.jobs,...plan.fryer.jobs,...plan.auxiliary.jobs].map(j=>j.start))+1;
  const fixed=protectStartedWork(plan,minute);
  for(const cancel of [false,true]){
   const r=planWithProtectedWork({...options,orders:cancel?[b.order]:[a.order,b.order],rows:cancel?[b.row]:[a.row,b.row],previousPlan:plan,now:instant(minute),newOrderId:'b'});
   checkFixed(r,fixed);
  }
 }
});
