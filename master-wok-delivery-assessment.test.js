'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {assessDeliverySnapshot:assess}=require('./master-wok-delivery-assessment');
const {collectDeliveryRoutes}=require('./master-wok-delivery-routes');
const lines=()=>[{itemId:'panang-curry',qty:1,mods:[{id:'chicken'}]}];
const input=()=>({serviceDate:'2026-10-17',timezone:'Europe/London',assessedAt:'2026-10-17T17:40:00Z',
 orders:[{orderId:'a',orderType:'delivery',targetMinute:1140,handoverMinutes:1,lines:lines()}],
 existingPlan:{complete:true,basis:'COMPLETE_HYPOTHETICAL_PLANS',serviceDate:'2026-10-17',
 assessedAt:'2026-10-17T17:40:00Z',orders:[],driverTrips:[]},
 loadingMinutes:1,minCombinedSavingMinutes:1,maxEstimateAgeMinutes:15,
 legs:[['KITCHEN','a'],['a','KITCHEN']].map(([from,to])=>({from,to,durationSeconds:300,
 basis:'ROUTE_DURATION_ESTIMATE',estimatedAt:'2026-10-17T17:40:00Z'}))});
const run=s=>assess(s,{enabled:true});
const collection=()=>({orderId:'existing',orderType:'collection',kitchenRequirement:'REQUIRED',
 kitchenAllocation:{start:1120,finish:1200},driverTripId:null});
test('dated assessment is disabled by default',()=>{
 assert.equal(assess(null).status,'DISABLED');assert.equal(assess(input(),{enabled:'true'}).status,'DISABLED');
});
test('real kitchen and route calculations produce a bounded hypothetical recommendation',()=>{
 const r=run(input());assert.equal(r.status,'SHADOW_RECOMMENDATION');assert.equal(r.asOfMinute,1120);
 assert.equal(r.verified,false);assert.equal(r.snapshotBasis,'CALLER_ASSERTED_COMPLETE_HYPOTHETICAL_PLANS');
 for(const d of r.recommendation.deliveries){assert.ok(d.foodToDoorMinutes<=20);assert.ok(Math.abs(d.deviationMinutes)<=10);}
});
test('fixed collections and delivery return trips constrain the integrated assessment',()=>{
 const s=input();s.existingPlan.orders=[collection()];assert.equal(run(s).status,'UNVERIFIED');
 s.existingPlan.orders=[{orderId:'existing',orderType:'delivery',kitchenRequirement:'NONE',
 kitchenAllocation:null,driverTripId:'trip'}];
 s.existingPlan.driverTrips=[{tripId:'trip',orderIds:['existing'],startMinute:1120,endMinute:1200}];
 assert.equal(run(s).status,'UNVERIFIED');
 s.existingPlan.driverTrips[0].endMinute=1120;s.existingPlan.driverTrips[0].startMinute=1100;
 assert.equal(run(s).status,'SHADOW_RECOMMENDATION');
});
test('plan manifest requires explicit kitchen allocation and every delivery journey',()=>{
 const mutations=[s=>s.existingPlan.complete=false,s=>s.existingPlan.basis='CURRENT_SAVED_STATE',
 s=>s.existingPlan.orders=[{...collection(),kitchenAllocation:null}],
 s=>s.existingPlan.orders=[{...collection(),orderType:'delivery'}],
 s=>s.existingPlan.orders=[{...collection(),kitchenRequirement:'NONE'}],
 s=>s.existingPlan.orders=[{...collection(),driverTripId:'unexpected'}],
 s=>s.existingPlan.orders=[{...collection(),orderId:'a'}]];
 for(const mutate of mutations){const s=input();mutate(s);assert.equal(run(s).status,'UNVERIFIED');}
});
test('trip membership is complete and unique; existing one-driver conflicts fail closed',()=>{
 const setup=()=>{const s=input();s.existingPlan.orders=['x','y'].map(orderId=>({orderId,orderType:'delivery',
 kitchenRequirement:'NONE',kitchenAllocation:null,driverTripId:orderId+'_trip'}));
 s.existingPlan.driverTrips=[{tripId:'x_trip',orderIds:['x'],startMinute:1000,endMinute:1020},
 {tripId:'y_trip',orderIds:['y'],startMinute:1020,endMinute:1040}];return s;};
 assert.equal(run(setup()).status,'SHADOW_RECOMMENDATION');
 for(const change of [s=>s.existingPlan.driverTrips.pop(),s=>s.existingPlan.driverTrips[1].orderIds=['x'],
 s=>s.existingPlan.driverTrips[1].startMinute=1019,s=>s.existingPlan.driverTrips[1].orderIds=['unknown']]) {
  const s=setup();change(s);assert.equal(run(s).status,'UNVERIFIED');
 }
 const s=setup();s.existingPlan.orders[1].driverTripId='x_trip';s.existingPlan.driverTrips.pop();
 s.existingPlan.driverTrips[0].orderIds.push('y');assert.equal(run(s).status,'SHADOW_RECOMMENDATION');
});
test('snapshots cannot be silently reused across dates or assessment instants',()=>{
 for(const change of [s=>s.existingPlan.serviceDate='2026-10-18',s=>s.existingPlan.assessedAt='2026-10-17T17:39:00Z',
 s=>s.serviceDate='2026-10-16',s=>s.timezone='UTC',s=>s.assessedAt='2026-10-17T17:40:00']) {
  const s=input();change(s);assert.equal(run(s).status,'UNVERIFIED');
 }
});
test('London summer, winter, preopening, next-day and fractional clock boundaries',()=>{
 for(const [at,day,expected] of [['2026-10-17T15:00:00Z','2026-10-17',990],
 ['2026-10-17T17:40:00.001Z','2026-10-17',1121],['2026-12-01T18:40:00Z','2026-12-01',1120],
 ['2026-10-17T23:30:00Z','2026-10-18',990]]) {
  const s=input();s.assessedAt=at;s.serviceDate=day;s.existingPlan.assessedAt=at;s.existingPlan.serviceDate=day;
  s.legs.forEach(l=>l.estimatedAt=at);assert.equal(run(s).asOfMinute,expected);
 }
 const s=input();s.assessedAt='2026-10-17T21:00:00.001Z';s.existingPlan.assessedAt=s.assessedAt;
 assert.equal(run(s).reasonCode,'KITCHEN_WINDOW_FINISHED');
});
test('missing or stale journey data cannot authorize a result',()=>{
 const s=input();s.legs.pop();assert.equal(run(s).status,'UNVERIFIED');
 s.legs=input().legs;s.legs[0].estimatedAt='2026-10-17T17:00:00Z';assert.equal(run(s).status,'UNVERIFIED');
});
test('immutable integrated assessment omits source PII',()=>{
 const s=input();s.orders[0].address='private';const before=structuredClone(s),r=run(s);
 assert.deepEqual(s,before);assert.ok(!JSON.stringify(r).includes('private'));
});
test('route capture connects to real offline assessment without checkout or pricing',async()=>{
 const s=input();s.orders[0].deliveryFee=0;
 const r=await collectDeliveryRoutes(s,{enabled:true,quoteLeg:p=>({...p,ok:true,duration:'300s',
 estimatedAt:s.assessedAt,routingPreference:'TRAFFIC_UNAWARE'})});
 assert.equal(r.status,'ROUTE_ESTIMATES_CAPTURED');s.legs=r.legs;
 assert.equal(run(s).status,'SHADOW_RECOMMENDATION');
});
test('two-drop integration accounts for real cooking holding time, not just shared departure',()=>{
 const f=require('./fixtures/delivery/two-nearby-stops-input.json'),s=input();
 s.assessedAt=f.assessedAt;s.existingPlan.assessedAt=s.assessedAt;
 s.orders=f.orders.map(o=>({...o,orderType:'delivery',lines:lines()}));
 s.legs=f.legs;s.loadingMinutes=f.loadingMinutes;
 const r=run(s);assert.equal(r.status,'SHADOW_RECOMMENDATION');
 assert.equal(r.recommendation.kind,'COMBINED');assert.equal(r.combinedDriverMinutesSaved,16);
 // First cooking finishes ten minutes before loading, unlike the old synthetic callback.
 assert.deepEqual(r.recommendation.deliveries.map(d=>d.foodToDoorMinutes),[20,14]);
 assert.equal(r.recommendation.deliveries[0].quality,'ACCEPTABLE_FLAGGED');
});
