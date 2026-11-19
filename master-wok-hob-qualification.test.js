'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
require('./master-wok-model-bundle');
const {createDeliveryCapacity}=require('./master-wok-delivery-capacity');
const {prepareStagingBasket}=require('./staging-canonical-basket');
const {priceBasket}=require('./master-wok-commercial');
const {validateRingOccupancy}=require('./staging-kitchen-launch-validator');
const {validateFoodAge}=require('./master-wok-driver-plan');
const {protectStartedWork}=require('./master-wok-protected-plan');
test('invalid historical reservations remain evidence; separately rebuilt baseline is valid',()=>{
 const old=require('./staging-tests/current-overlap-replay-20261118.json');
 const rebuilt=require('./staging-tests/current-overlap-replay-20261118-corrected-hob.json');
 const before=JSON.stringify(old);
 assert.throws(()=>protectStartedWork(old.plan,0),/COMMITTED_PLAN_RESOURCE_CLASH/);
 assert.doesNotThrow(()=>protectStartedWork(rebuilt.plan,0));
 const ids=plan=>[...new Set(plan.wok.jobs.flatMap(j=>j.orderIds))].sort();
 assert.deepEqual(ids(old.plan),ids(rebuilt.plan));assert.deepEqual(old.orders,rebuilt.orders);
 assert.equal(JSON.stringify(old),before);
});
test('all four £150 examples get independently checked physical plans through the scoped holding review path',async()=>{
 const examples=require('./staging-tests/large-basket-examples'),date='2026-11-07',now=date+'T15:00:00Z';
 const capacity=createDeliveryCapacity({stagingSharedRings:true,advisoryHolding:true,quoteLeg:async()=>{throw Error('NO_PROVIDER_TRAFFIC');}});
 const cpu=process.cpuUsage();
 for(const [name,items] of Object.entries(examples)){
  const p=prepareStagingBasket({id:name,createdAt:now,serviceDate:date,readyMinute:1215,items:priceBasket(items).items,model:globalThis.MasterWokModelV1});
  const r=await capacity.verify({serviceDate:date,acceptedOrders:[],rawRows:[],state:{now,availability:{blackouts:[],serviceState:{mode:'normal',capacity_throttle:0}},previousPlan:null},proposedOrder:{...p.candidate,rawRow:p.rawRow,validatedHeader:{order_type:'collection',preferred_time:date+'T20:15:00Z'}}});
  assert.equal(r.status,'VERIFIED_KITCHEN_CAPACITY',`${name}: ${r.reason}`);assert.equal(r.bookingApprovalAllowed,false);
  assert.deepEqual(validateRingOccupancy(r.plan.wok.jobs,r.plan.auxiliary.jobs),[]);assert.equal(validateFoodAge(r.plan),true);
  if(name!=='startersAndCurries'){
   assert.equal(r.plan.holdingAdvisories[name].kind,'staff_review_required');
   assert.ok(r.plan.holdingAdvisories[name].maxMinutes>20);
   assert.ok(r.plan.holdingAdvisories[name].maxMinutes<330);
  }
 }
 const used=process.cpuUsage(cpu);assert.ok(used.user+used.system<1500000,'four large basket assessments must remain bounded');
});
