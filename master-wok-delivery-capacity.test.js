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
