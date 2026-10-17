'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {assessRtkDeliverySnapshot:assess}=require('./master-wok-rtk-delivery-assessment');
const policy=require('./master-wok-rtk-delivery-policy.json');
test('RTK profile stays disabled by default',()=>assert.equal(assess(null).status,'DISABLED'));
test('approved RTK allowances are applied without mutating or trusting stale fixture values',()=>{
 const input=structuredClone(require('./fixtures/delivery/integrated-two-stops-input.json'));
 input.loadingMinutes=0;input.minCombinedSavingMinutes=0;input.orders.forEach(o=>o.handoverMinutes=0);
 const before=structuredClone(input),r=assess(input,{enabled:true});
 assert.deepEqual(input,before);assert.equal(r.policyId,policy.policyId);
 assert.equal(r.policyScope,'OFFLINE_AND_STAGING_ONLY');assert.equal(r.status,'SHADOW_RECOMMENDATION');
 for(const trip of r.recommendation.trips) {
  assert.equal(trip.departureMinute-trip.startMinute,2);
  const last=trip.arrivals.at(-1),leg=input.legs.find(l=>l.from===last.orderId&&l.to==='KITCHEN');
  assert.equal(trip.endMinute-last.arrivalMinute-Math.ceil(leg.durationSeconds/60),2);
 }
 if(r.recommendation.kind==='COMBINED'&&r.separateAlternative)
  assert.ok(r.combinedDriverMinutesSaved>=5);
});
test('RTK profile retains unknown evidence instead of bypassing source requirements',()=>{
 const input=structuredClone(require('./fixtures/delivery/integrated-two-stops-input.json'));
 input.existingPlan.complete=false;
 assert.equal(assess(input,{enabled:true}).status,'UNVERIFIED');
});
test('combined-only feasibility cannot invent the required five-minute saving',()=>{
 const s=structuredClone(require('./fixtures/delivery/integrated-two-stops-input.json'));
 s.existingPlan.orders=['before','after'].map(orderId=>({orderId,orderType:'delivery',kitchenRequirement:'NONE',
 kitchenAllocation:null,driverTripId:orderId}));
 s.existingPlan.driverTrips=[{tripId:'before',orderIds:['before'],startMinute:990,endMinute:1125},
 {tripId:'after',orderIds:['after'],startMinute:1149,endMinute:1320}];
 const r=assess(s,{enabled:true});assert.equal(r.status,'UNVERIFIED');
 assert.equal(r.reasonCode,'RTK_COMBINED_SAVING_UNVERIFIED');assert.equal(r.recommendation,null);
});
