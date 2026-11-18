'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
require('./master-wok-model-bundle');
const {expandCommitments}=require('./master-wok-commitment-reader'),{normalizeStagingOrders}=require('./staging-order-snapshot');
const {relativePlacement}=require('./master-wok-clock'),{prepareStagingBasket}=require('./staging-canonical-basket');
const {createDeliveryCapacity}=require('./master-wok-delivery-capacity'),{warnings}=require('./master-wok-holding-advisory');
const {createMutationAssessment}=require('./master-wok-mutation-assessment');
const fixture=require('./staging-tests/current-overlap-replay-20261118.json');
test('authoritative checkout matches the bounded hint around the existing 20:00 collection without moving its reserved jobs',async()=>{
 const model=globalThis.MasterWokModelV1,date='2026-11-18',now=date+'T12:15:00Z';
 const rows=expandCommitments(fixture.orders,date),orders=normalizeStagingOrders({rows,model,serviceDate:date}).map(o=>({...o,placedAt:relativePlacement(o.placedAt,date)}));
 const capacity=createDeliveryCapacity({stagingSharedRings:true,advisoryHolding:true,quoteLeg:async()=>({durationSeconds:480})}),cpu=process.cpuUsage();
 for(const ready of [1190,1200,1210,1220]){
  const p=prepareStagingBasket({id:'checkout-candidate',createdAt:now,serviceDate:date,readyMinute:ready,items:fixture.orders[0].items,model});
  const ctx={serviceDate:date,acceptedOrders:orders,rawRows:rows,state:{now,availability:{blackouts:[],serviceState:{mode:'normal',capacity_throttle:0}},previousPlan:structuredClone(fixture.plan)},proposedOrder:{...p.candidate,rawRow:p.rawRow,validatedHeader:{order_type:'delivery',preferred_time:new Date(Date.UTC(2026,10,18,0,ready)).toISOString(),customer_lat:53.752,customer_lng:-1.58}}};
  const before=JSON.stringify(ctx.state.previousPlan),hint=await capacity.verify(ctx,{maxSearchNodes:1000,maxCompleteChecks:8,preserveOnly:true}),actual=await capacity.verify(ctx);
  assert.equal(actual.status,'VERIFIED_KITCHEN_CAPACITY',actual.reason);assert.deepEqual(actual.plan,hint.plan);assert.equal(JSON.stringify(ctx.state.previousPlan),before);
  for(const resource of ['wok','fryer','auxiliary'])assert.deepEqual(actual.plan[resource].jobs.filter(j=>j.orderIds.some(id=>id.startsWith(fixture.orders[0].id+'@'))),fixture.plan[resource].jobs);
  if(ready>=1200)assert.ok(warnings(actual.plan).some(w=>w.id==='checkout-candidate'&&w.estimatedMinutes>20));
  const candidateRow={...p.rawRow,order_type:'delivery',customer_lat:53.752,customer_lng:-1.58,source_order_id:'checkout-candidate'};
  const retained=await capacity.replan({orders:[...orders,ctx.proposedOrder],rows:[...rows,candidateRow],previousPlan:actual.plan,serviceDate:date,now,availability:ctx.state.availability,retainExistingPlan:true});
  assert.equal(retained.status,'VALIDATED_PROTECTED_PLAN',retained.reason);
  assert.deepEqual(retained.plan.wok.jobs,actual.plan.wok.jobs);
 }
 const used=process.cpuUsage(cpu);assert.ok(used.user+used.system<1500000,'four locked-snapshot-equivalent assessments and hints must fit below the Edge CPU limit');
});
test('capacity-neutral completion validates the saved plan rather than rescheduling the whole service',async()=>{
 let retained;
 const before={id:'a',status:'confirmed',capacity_scheduler:'MASTER_WOK',preferred_time:'2026-11-18T20:00:00Z'};
 const assess=createMutationAssessment({model:globalThis.MasterWokModelV1,readOrders:async()=>[],readAvailability:async()=>({blackouts:[],serviceState:{mode:'normal'}}),planStore:{read:async()=>({})},deliveryCapacity:{replan:async options=>{retained=options.retainExistingPlan;return {status:'VALIDATED_PROTECTED_PLAN',plan:{wok:{jobs:[]},fryer:{jobs:[]},auxiliary:{jobs:[]}}};}},stagingSharedRings:true});
 const r=await assess({connection:{},before,after:{...before,status:'completed'},dates:['2026-11-18'],now:'2026-11-18T12:15:00Z',action:'complete'});assert.equal(r.status,'VALIDATED_LIFECYCLE_ASSESSMENT');assert.equal(retained,true);
});
