'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const fixture=require('./fixtures/historical-2026-09-18-retrospective.json');
const {planDelivery,recommendDeliveryRuns}=require('./master-wok-delivery-shadow');
const minute=value=>{
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value));
 return Number(parts.find(x=>x.type==='hour').value)*60+Number(parts.find(x=>x.type==='minute').value);
};
function replay(useOriginalRequest){
 const rows=fixture.savedState.orders.map(o=>({orderId:o.orderId,placedAt:o.createdAt,lines:o.lines,
  readyMinute:minute(useOriginalRequest&&o.orderId==='sample-13'?o.preferred_time:o.confirmed_time||o.proposed_time||o.preferred_time)}));
 const result=spawnSync(process.execPath,[path.join(__dirname,'railway-shadow/poll-replay.js')],{
  input:JSON.stringify({serviceDate:fixture.serviceDate,rows}),encoding:'utf8',env:{...process.env,TZ:'Europe/London'},timeout:20000});
 assert.equal(result.status,0);return JSON.parse(result.stdout);
}
test('retrospective corrections preserve the original request and lower-bound/approximate evidence',()=>{
 assert.equal(fixture.verified,false);
 const late=fixture.savedState.orders.find(o=>o.orderId==='sample-13');
 assert.equal(late.orderType,'delivery');assert.equal(minute(late.preferred_time),1185);
 assert.equal(fixture.savedState.orders.find(o=>o.orderId==='sample-2').orderType,'delivery');
 assert.equal(minute(late.confirmed_time),1260);
 assert.equal(fixture.ownerReportedCorrections.lateOrder.agreedArrival.kind,'LOWER_BOUND_ONLY');
 assert.equal(fixture.ownerReportedCorrections.lateOrder.agreedArrival.precisePromise,false);
 assert.equal(fixture.ownerReportedCorrections.lateOrder.agreedArrival.latestMinute,null);
 assert.equal(fixture.ownerReportedCorrections.lateOrder.arrivalPrecision,'APPROXIMATE_RECOLLECTION');
});
test('earlier rescheduled commitments expose risk that the retrospective 21:00 field masks',()=>{
 const original=replay(true),revised=replay(false);
 assert.equal(original.verified,false);assert.equal(revised.verified,false);
 const before=original.observations.find(o=>o.orderId==='sample-13');
 const after=revised.observations.find(o=>o.orderId==='sample-13');
 assert.equal(before.readyMinute,1185);assert.notEqual(before.status,'GREEN');
 assert.equal(after.readyMinute,1260);
 // This is conditional on other saved reschedules being in force, not actual decision-history proof.
 assert.equal(after.status,'GREEN');
 assert.equal(original.evidenceBasis,'HYPOTHETICAL_PLANS_NOT_COOKING_ACTIVITY');
});
test('reported drop sequence supplies no invented travel, readiness or driver return evidence',()=>{
 const run=fixture.ownerReportedCorrections.combinedJourney;
 assert.deepEqual(run.dropOrder,['sample-15','sample-13']);
 for(const key of ['foodReadyMinutes','departureMinute','arrivalMinutes','returnMinute','directionalTravelSeconds'])assert.equal(run[key],null);
 assert.equal(run.verifiedRoutePlan,false);
 const one=planDelivery({orderType:'delivery',timeBasis:'CUSTOMER_ARRIVAL',customerMinute:1260,route:null});
 assert.equal(one.status,'UNVERIFIED');assert.equal(one.verified,false);assert.equal(one.driverPlan,undefined);
 // Optimistic placeholders isolate the route-evidence guard; these are NOT claimed historical commitments.
 const pair=recommendDeliveryRuns({timeBasis:'CUSTOMER_ARRIVAL',
  orders:run.dropOrder.map(orderId=>({orderId,targetMinute:1260,handoverMinutes:2})),
  loadingMinutes:2,earliestFoodReadyMinute:990,minCombinedSavingMinutes:5,
  driverPlanCoverage:'COMPLETE_FOR_PLANNING_WINDOW',existingDriverPlans:[],
  assessedAt:'2026-09-18T18:00:00Z',maxEstimateAgeMinutes:30,legs:[]});
 assert.equal(pair.status,'UNVERIFIED');assert.equal(pair.verified,false);
 assert.equal(pair.reasonCode,'DIRECTIONAL_ROUTE_LEGS_REQUIRED');
});
