'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {deriveDeliveryEventEstimates:derive}=require('./master-wok-event-delivery-projection');
const {replay,validateEventBatch}=require('./master-wok-chronological-replay');
function input(){
 const snapshot=structuredClone(require('./fixtures/delivery/integrated-two-stops-input.json'));
 const events=snapshot.orders.map((o,i)=>({eventId:'offer-'+o.orderId,sequence:i+1,at:snapshot.assessedAt,kind:'BOOKING_DECISION',actualDecision:'SUGGESTED',order:{orderId:o.orderId,orderType:'delivery',targetAt:'2026-10-17T18:00:00Z',lines:structuredClone(o.lines),deliveryReadyEstimate:null}}));
 return {serviceDate:snapshot.serviceDate,snapshot,events};
}
function batch(events){return {serviceDate:'2026-10-17',events,coverage:{basis:'DECISION_EVENT_LOG',complete:true,eventCount:events.length,firstSequence:1,lastSequence:events.length,initialState:'NO_PRIOR_SERVICE_COMMITMENTS',throughAt:events.at(-1).at}};}
test('delivery event projection is default off',()=>assert.equal(derive(null).status,'DISABLED'));
test('actual planner prepares immutable event-bound estimates and retains hypothetical return journeys',()=>{
 const s=input(),before=structuredClone(s),r=derive(s,{enabled:true});assert.equal(r.status,'ESTIMATES_PREPARED');assert.deepEqual(s,before);assert.equal(r.verified,false);assert.equal(r.networkRequests,0);
 const enriched=s.events.map((e,i)=>({...e,order:{...e.order,deliveryReadyEstimate:r.estimates[i].deliveryReadyEstimate}}));
 assert.equal(validateEventBatch(batch(enriched)).length,2);assert.equal(replay(batch(enriched),{enabled:true}).status,'REPLAYED');
 for(const trip of r.hypotheticalDriverPlan.trips){assert.equal(trip.departureMinute-trip.startMinute,2);assert.ok(trip.endMinute>trip.arrivals.at(-1).arrivalMinute);}
 for(const row of r.estimates){const e=row.deliveryReadyEstimate;assert.ok(Date.parse(e.arrivalAt)-Date.parse(e.foodReadyAt)<=20*60000);assert.ok(Math.abs(Date.parse(e.arrivalAt)-Date.parse('2026-10-17T18:00:00Z'))<=10*60000);}
});
test('different offer target, basket, event time, incomplete driver coverage and missing return evidence cannot be joined',()=>{
 const mutations=[s=>s.events[0].order.targetAt='2026-10-17T18:30:00Z',s=>s.events[0].order.lines[0].qty=2,s=>s.events[0].at='2026-10-17T16:01:00Z',s=>s.snapshot.existingPlan.complete=false,s=>s.snapshot.legs.pop(),s=>s.snapshot.orders[1].orderId=s.snapshot.orders[0].orderId,s=>s.snapshot.maxEstimateAgeMinutes=1440,s=>s.snapshot.legs[0].estimatedAt='2026-10-17T17:00:00Z'];
 for(const change of mutations){const s=input();change(s);assert.equal(derive(s,{enabled:true}).status,'UNVERIFIED');}
});
test('food age uses estimated arrival while preserving the requested target',()=>{
 const e=input().events[0];e.sequence=1;e.order.deliveryReadyEstimate={foodReadyAt:'2026-10-17T17:45:00Z',arrivalAt:'2026-10-17T18:10:00Z',estimatedAt:e.at,basis:'DELIVERY_PLANNER_ESTIMATE'};
 let result=replay(batch([e]),{enabled:true});assert.equal(result.status,'REPLAYED');assert.equal(result.observations[0].reasonCode,'DELIVERY_READY_ESTIMATE_REQUIRED');
 e.order.deliveryReadyEstimate={...e.order.deliveryReadyEstimate,foodReadyAt:'2026-10-17T17:35:00Z',arrivalAt:'2026-10-17T17:50:00Z'};
 result=replay(batch([e]),{enabled:true});assert.equal(result.status,'REPLAYED');
 if(process.env.TZ==='Europe/London')assert.equal(result.observations[0].prediction,'GREEN');
 assert.equal(e.order.targetAt,'2026-10-17T18:00:00Z');
});
test('outside-window and before-food-ready arrival estimates are rejected',()=>{
 for(const arrivalAt of ['2026-10-17T18:10:01Z','2026-10-17T17:34:00Z']){
  const e=input().events[0];e.sequence=1;e.order.deliveryReadyEstimate={foodReadyAt:'2026-10-17T17:35:00Z',arrivalAt,estimatedAt:e.at,basis:'DELIVERY_PLANNER_ESTIMATE'};
  assert.throws(()=>validateEventBatch(batch([e])));
 }
});
test('winter timestamps and cross-date bindings use London service time',()=>{
 const s=input();s.serviceDate='2026-12-01';s.snapshot.serviceDate=s.serviceDate;s.snapshot.assessedAt='2026-12-01T17:00:00Z';s.snapshot.existingPlan.serviceDate=s.serviceDate;s.snapshot.existingPlan.assessedAt=s.snapshot.assessedAt;
 s.snapshot.legs.forEach(l=>l.estimatedAt=s.snapshot.assessedAt);
 s.events.forEach(e=>{e.at=s.snapshot.assessedAt;e.order.targetAt='2026-12-01T19:00:00Z';});
 const r=derive(s,{enabled:true});assert.equal(r.status,'ESTIMATES_PREPARED');
 for(const row of r.estimates){
  const at=new Date(row.deliveryReadyEstimate.arrivalAt);
  const arrival=r.hypotheticalDriverPlan.trips.flatMap(t=>t.arrivals).find(a=>a.orderId===row.orderId);
  assert.equal(at.toISOString().slice(0,10),'2026-12-01');assert.equal(at.getUTCHours()*60+at.getUTCMinutes(),arrival.arrivalMinute);
 }
 s.events[0].order.targetAt='2026-12-02T19:00:00Z';assert.equal(derive(s,{enabled:true}).status,'UNVERIFIED');
});
test('the twenty-minute limit applies at the estimated arrival boundary',()=>{
 for(const [ready,unverified] of [['2026-10-17T17:50:00Z',false],['2026-10-17T17:49:59Z',true]]){
  const e=input().events[0];e.sequence=1;e.order.deliveryReadyEstimate={foodReadyAt:ready,arrivalAt:'2026-10-17T18:10:00Z',estimatedAt:e.at,basis:'DELIVERY_PLANNER_ESTIMATE'};
  const r=replay(batch([e]),{enabled:true});assert.equal(r.status,'REPLAYED');
  if(unverified)assert.equal(r.observations[0].reasonCode,'DELIVERY_READY_ESTIMATE_REQUIRED');
  else if(process.env.TZ==='Europe/London')assert.equal(r.observations[0].prediction,'GREEN');
 }
});
