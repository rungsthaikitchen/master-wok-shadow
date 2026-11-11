'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
require('./master-wok-model-bundle');
const {prepareStagingBasket}=require('./staging-canonical-basket');
const {relativePlacement}=require('./master-wok-clock');
const {createDeliveryCapacity}=require('./master-wok-delivery-capacity');
const {remapPlanOrder}=require('./master-wok-service-plan-store');
const model=globalThis.MasterWokModelV1,serviceDate='2026-11-04',now='2026-11-04T08:00:00Z';
const availability={blackouts:[],serviceState:{mode:'normal',capacity_throttle:0}};
const capacity=createDeliveryCapacity({quoteLeg:async({origin,destination})=>({durationSeconds:origin.lat===53.744437?300:destination.lat===53.744437?420:120})});
function candidate(id='a',time=1110,type='delivery'){
 const p=prepareStagingBasket({id,createdAt:now,serviceDate,readyMinute:time,model,items:[{item_id:'green-curry',qty:1,modifiers:[{id:'chicken'}],spice:1}]});
 return {...p.candidate,placedAt:relativePlacement(now,serviceDate),rawRow:p.rawRow,
  validatedHeader:{order_type:type,preferred_time:`2026-11-04T${String(Math.floor(time/60)).padStart(2,'0')}:${String(time%60).padStart(2,'0')}:00Z`,customer_lat:53.75,customer_lng:-1.58}};
}
const context=c=>({proposedOrder:c,acceptedOrders:[],rawRows:[],serviceDate,state:{now,availability}});
function accepted(c){return {...c.rawRow,order_type:c.validatedHeader.order_type,customer_lat:53.75,customer_lng:-1.58,source_order_id:c.orderId,confirmed_time:c.validatedHeader.preferred_time};}
test('actual kitchen finishes before loading, not at customer arrival',async()=>{
 const result=await capacity.verify(context(candidate()));
 assert.equal(result.status,'VERIFIED_KITCHEN_CAPACITY',result.reason);assert.equal(result.bookingApprovalAllowed,false);
 const trip=result.plan.delivery.trips[0];assert.equal(trip.stops[0].arrival,1110);
 const jobs=[...result.plan.wok.jobs,...result.plan.fryer.jobs,...result.plan.auxiliary.jobs];
 assert.ok(jobs.every(j=>j.finish<=trip.start));assert.ok(jobs.some(j=>j.finish===trip.start));
});
test('collections replan against the committed driver trip without erasing it',async()=>{
 const a=candidate(),first=await capacity.verify(context(a));
 const c=context(candidate('collection',1140,'collection'));c.acceptedOrders=[a];c.rawRows=[accepted(a)];c.state.previousPlan=first.plan;
 const r=await capacity.verify(c);assert.equal(r.status,'VERIFIED_KITCHEN_CAPACITY',r.reason);
 assert.deepEqual(r.plan.delivery,first.plan.delivery);
});
test('business hours apply to door arrival while production may finish before opening',async()=>{
 const c=context(candidate('a',1020));const r=await capacity.verify(c);
 assert.equal(r.status,'VERIFIED_KITCHEN_CAPACITY',r.reason);assert.equal(r.plan.delivery.trips[0].start,1013);
 c.proposedOrder=candidate('b',1015);assert.equal((await capacity.verify(c)).reason,'OUTSIDE_SERVICE_WINDOW');
});
test('kitchen blackouts and minimum lead apply after subtracting travel',async()=>{
 const c=context(candidate());c.state={now:'2026-11-04T18:12:00Z',availability};assert.notEqual((await capacity.verify(c)).status,'VERIFIED_KITCHEN_CAPACITY');
 c.state={now,availability:{...availability,blackouts:[{kind:'closed',start_at:'2026-11-04T17:00:00Z',end_at:'2026-11-04T19:00:00Z'}]}};
 assert.equal((await capacity.verify(c)).reason,'BLACKOUT');
});
test('explicit combination re-assesses actual kitchen baskets and leaves the previous plan immutable',async()=>{
 const a=candidate(),b=candidate('b',1130),first=await capacity.verify(context(a)),ctx=context(b);
 ctx.acceptedOrders=[a];ctx.rawRows=[accepted(a)];ctx.state.previousPlan=first.plan;
 const second=await capacity.verify(ctx);assert.equal(second.status,'VERIFIED_KITCHEN_CAPACITY',second.reason);
 const snapshot=JSON.stringify(second.plan);
 const r=await capacity.replan({orders:[a,b],rows:[accepted(a),accepted(b)],previousPlan:second.plan,serviceDate,now,availability,combine:['a','b']});
 assert.equal(r.status,'VALIDATED_PROTECTED_PLAN',r.reason);assert.equal(r.plan.delivery.trips.length,1);assert.equal(JSON.stringify(second.plan),snapshot);
 const trip=r.plan.delivery.trips[0];assert.ok(r.plan.wok.jobs.every(j=>j.finish<=trip.start));
});
test('persisted IDs are remapped in kitchen jobs and the delivery reservation together',async()=>{
 const first=await capacity.verify(context(candidate('candidate:key')));
 const p=remapPlanOrder(first.plan,'candidate:key','11111111-1111-4111-8111-111111111111@2026-11-04T18:30:00.000Z');
 const stop=p.delivery.trips[0].stops[0];assert.equal(stop.sourceId,'11111111-1111-4111-8111-111111111111');
 assert.ok(p.wok.jobs.every(j=>j.orderIds.includes(stop.id)));assert.equal(first.plan.delivery.trips[0].stops[0].id,'candidate:key');
});

test('staging four-ring delivery keeps door arrival and loading deadlines through replanning',async()=>{
 const parallel=createDeliveryCapacity({stagingSharedRings:true,quoteLeg:async()=>({durationSeconds:300})});
 const a=candidate();a.rawRow.items[0].qty=4;
 const first=await parallel.verify(context(a));
 assert.equal(first.status,'VERIFIED_KITCHEN_CAPACITY',first.reason);
 assert.equal(first.plan.modelVersion,'combined-kitchen-four-ring-staging-v1');
 assert.equal(first.plan.wok.jobs.length,4);
 const trip=first.plan.delivery.trips[0];assert.equal(trip.stops[0].arrival,1110);
 assert.ok(first.plan.wok.jobs.every(j=>j.finish<=trip.start));
 const r=await parallel.replan({orders:[a],rows:[accepted(a)],previousPlan:first.plan,serviceDate,now,availability});
 assert.equal(r.status,'VALIDATED_PROTECTED_PLAN',r.reason);
 assert.equal(r.bookingApprovalAllowed,false);
});

test('delivery time proposal searches for a plan whose every dish meets door-arrival food age',async()=>{
 const parallel=createDeliveryCapacity({stagingSharedRings:true,quoteLeg:async()=>({durationSeconds:420})});
 const items=[['pork-dumplings'],['red-curry','chicken'],['stir-pepper','beef'],
  ['chef-pad-thai','pork'],['fried-rice','chicken'],['jasmine-rice'],['coconut-rice'],['chips']]
  .map(([item_id,protein])=>({item_id,qty:1,modifiers:protein?[{id:protein}]:[],spice:protein?1:0}));
 function basket(id,time,qty=1,selection=items,type='delivery'){
  const base=candidate(id,time,type),p=prepareStagingBasket({id,createdAt:now,serviceDate,readyMinute:time,model,
   items:selection.map(i=>({...i,qty:i.qty*qty}))});
  return {...base,...p.candidate,placedAt:relativePlacement(now,serviceDate),
   rawRow:{...p.rawRow,source_order_id:id.startsWith('same-delivery')?'same-delivery':id}};
 }
 const old=basket('same-delivery@old',1110),first=await parallel.verify(context(old));
 assert.equal(first.status,'VERIFIED_KITCHEN_CAPACITY',first.reason);
 const big=basket('hundred',1170,2),collection=basket('collection',1140,1,
  [{item_id:'pad-thai',qty:1,modifiers:[{id:'chicken'}],spice:0}],'collection');
 const existing=[old],rows=[{...accepted(old),source_order_id:'same-delivery'}];let previous=first.plan;
 for(const c of [big,collection]){
  const ctx=context(c);ctx.acceptedOrders=[...existing];ctx.rawRows=[...rows];ctx.state.previousPlan=previous;
  const bounded=await parallel.verify(ctx,{maxSearchNodes:1000,maxCompleteChecks:8});
  assert.equal(bounded.status,'VERIFIED_KITCHEN_CAPACITY',bounded.reason);
  assert.equal(require('./master-wok-driver-plan').validateFoodAge(bounded.plan),true);
  const added=await parallel.verify(ctx);assert.equal(added.status,'VERIFIED_KITCHEN_CAPACITY',added.reason);
  previous=added.plan;existing.push(c);rows.push(accepted(c));
 }
 const ctx=context(basket('same-delivery@new',1115));ctx.acceptedOrders=existing;
 ctx.rawRows=rows;ctx.state.previousPlan=previous;
 const result=await parallel.verify(ctx);
 assert.equal(result.status,'VERIFIED_KITCHEN_CAPACITY',result.reason);
 const {validateFoodAge}=require('./master-wok-driver-plan');assert.equal(validateFoodAge(result.plan),true);
 assert.equal(result.plan.delivery.trips.length,3);
 assert.ok(result.plan.wok.jobs.every(j=>j.portions===1));
});
