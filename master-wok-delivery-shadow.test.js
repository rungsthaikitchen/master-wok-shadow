'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {planDelivery}=require('./master-wok-delivery-shadow');
const base=()=>({orderType:'delivery',timeBasis:'CUSTOMER_ARRIVAL',customerMinute:1140,
 assessedAt:'2026-10-17T16:00:00Z',maxEstimateAgeMinutes:15,
 route:{basis:'ROUTE_DURATION_ESTIMATE',outboundSeconds:720,returnSeconds:900,estimatedAt:'2026-10-17T15:59:00Z'},
 loadingMinutes:3,handoverMinutes:2,existingDriverPlans:[],driverPlanCoverage:'COMPLETE_FOR_PLANNING_WINDOW'});
test('arrival is converted to food-ready and asymmetric return without claiming fit',()=>{
 const result=planDelivery(base());
 assert.equal(result.foodReadyMinute,1125);assert.equal(result.departureMinute,1128);
 assert.equal(result.returnMinute,1157);assert.equal(result.status,'READY_FOR_KITCHEN_ASSESSMENT');
 assert.equal(result.verified,false);
});
test('driver overlap flags AMBER and touching endpoints do not overlap',()=>{
 const input=base();input.existingDriverPlans=[{orderId:'prior',startMinute:1100,endMinute:1126}];
 assert.equal(planDelivery(input).status,'AMBER');
 input.existingDriverPlans[0].endMinute=1125;
 assert.equal(planDelivery(input).status,'READY_FOR_KITCHEN_ASSESSMENT');
 input.existingDriverPlans=[{orderId:'next',startMinute:1157,endMinute:1170}];
 assert.equal(planDelivery(input).conflictingOrderIds.length,0);
});
test('unknown time meaning, duration and coverage stay unverified',()=>{
 for(const update of [{timeBasis:undefined},{route:null},{driverPlanCoverage:undefined},{existingDriverPlans:undefined},
   {loadingMinutes:undefined},{handoverMinutes:-1}])assert.equal(planDelivery({...base(),...update}).status,'UNVERIFIED');
 const input=base();delete input.route.returnSeconds;
 assert.equal(planDelivery(input).status,'UNVERIFIED');
});
test('stale estimates, timezone ambiguity and early food-ready are unverified',()=>{
 for(const update of [{assessedAt:'2026-10-17T16:30:00Z'}, {assessedAt:'2026-10-17T15:30:00Z'},
   {assessedAt:'2026-10-17T16:00:00'},{customerMinute:990}])assert.equal(planDelivery({...base(),...update}).status,'UNVERIFIED');
});
test('collections need no route or driver, plans remain hypothetical and input immutable',()=>{
 assert.equal(planDelivery({orderType:'collection',customerMinute:1140}).foodReadyMinute,1140);
 const input=base(),copy=structuredClone(input);
 planDelivery(input);assert.deepEqual(input,copy);
 assert.match(planDelivery(input).evidenceBasis,/NOT_DRIVER_ACTIVITY/);
});
test('unknown distance-only routes and malformed driver plans cannot generate green',()=>{
 const input=base();input.route={basis:'DISTANCE_ONLY',miles:2};
 assert.equal(planDelivery(input).status,'UNVERIFIED');
 input.route=base().route;input.existingDriverPlans=[{orderId:'bad',startMinute:1150,endMinute:1140}];
 assert.equal(planDelivery(input).status,'UNVERIFIED');
});
test('exact-time helper also enforces agreed food age and exports run search',()=>{
 const input=base();input.route.outboundSeconds=18*60;
 assert.equal(planDelivery(input).reasonCode,'FOOD_TO_DOOR_LIMIT_EXCEEDED');
 assert.equal(typeof require('./master-wok-delivery-shadow').recommendDeliveryRuns,'function');
});
