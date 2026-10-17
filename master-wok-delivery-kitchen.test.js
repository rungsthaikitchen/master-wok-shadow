'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createDeliveryKitchenAssessment:make}=require('./master-wok-delivery-kitchen');
const {recommendDeliveryRuns}=require('./master-wok-delivery-runs');
const order=orderId=>({orderId,lines:[{itemId:'panang-curry',qty:1,mods:[{id:'chicken'}]}]});
const snapshot=()=>({basis:'HYPOTHETICAL_KITCHEN_OCCUPANCY',complete:true,asOfMinute:1090,fixedAllocations:[],orders:[order('a')]});
const proposal=ids=>({kind:'COMBINED',proposedFoodReady:ids.map(orderId=>({orderId,foodReadyMinute:1100}))});
test('two independent fits cannot pass a joint ten-minute kitchen window',()=>{
 const s=snapshot();assert.equal(make(s)(proposal(['a'])).status,'FIT');
 s.orders=[order('b')];assert.equal(make(s)(proposal(['b'])).status,'FIT');
 s.orders=[order('a'),order('b')];assert.equal(make(s)(proposal(['a','b'])).status,'NO_FIT');
});
test('fixed collection allocation blocks cooking; exact boundary is allowed',()=>{
 const s=snapshot();s.fixedAllocations=[{orderId:'collection',start:1090,finish:1091}];
 assert.equal(make(s)(proposal(['a'])).status,'NO_FIT');
 s.fixedAllocations[0]={orderId:'collection',start:1080,finish:1090};
 assert.equal(make(s)(proposal(['a'])).status,'FIT');
});
test('complete snapshot, valid menu, coverage and disjoint identities are required',()=>{
 const changes=[s=>s.complete=false,s=>s.basis='CURRENT_SAVED_STATE',s=>s.asOfMinute=989,
 s=>s.orders[0].lines[0].itemId='unknown',s=>s.fixedAllocations=[{orderId:'a',start:1080,finish:1090}],
 s=>s.fixedAllocations=[{orderId:'x',start:1080,finish:1095},{orderId:'y',start:1090,finish:1100}],
 s=>s.orders[0].lines[0].qty=0];
 for(const change of changes){const s=snapshot();change(s);assert.equal(make(s)(proposal(['a'])).status,'UNVERIFIED');}
});
test('incomplete and duplicate joint proposals fail closed',()=>{
 const s=snapshot();s.orders.push(order('b'));const assess=make(s);
 assert.equal(assess(proposal(['a'])).status,'UNVERIFIED');
 assert.equal(assess(proposal(['a','a'])).status,'UNVERIFIED');
});
test('actual hypothetical finish is returned and inputs and later calls are isolated',()=>{
 const s=snapshot();s.asOfMinute=990;const before=structuredClone(s),assess=make(s);
 const p=proposal(['a']);const result=assess(p);
 assert.equal(result.foodReadyByOrder[0].foodReadyMinute,1090);
 assert.equal(result.verified,false);assert.deepEqual(s,before);
 result.timeline[0].finish=0;s.orders[0].lines=[];p.proposedFoodReady[0].foodReadyMinute=0;
 assert.equal(assess(proposal(['a'])).foodReadyByOrder[0].foodReadyMinute,1090);
});
test('delivery search runs through the real kitchen model offline',()=>{
 const s=snapshot();s.asOfMinute=1120;
 const input={timeBasis:'CUSTOMER_ARRIVAL',orders:[{orderId:'a',targetMinute:1140,handoverMinutes:1}],
 loadingMinutes:1,earliestFoodReadyMinute:1120,minCombinedSavingMinutes:1,
 driverPlanCoverage:'COMPLETE_FOR_PLANNING_WINDOW',existingDriverPlans:[],
 assessedAt:'2026-10-17T17:00:00Z',maxEstimateAgeMinutes:15,
 legs:[['KITCHEN','a'],['a','KITCHEN']].map(([from,to])=>({from,to,durationSeconds:300,
 basis:'ROUTE_DURATION_ESTIMATE',estimatedAt:'2026-10-17T17:00:00Z'}))};
 const r=recommendDeliveryRuns(input,{assessKitchen:make(s)});
 assert.equal(r.status,'SHADOW_RECOMMENDATION');
 assert.ok(r.recommendation.deliveries.every(d=>d.foodToDoorMinutes<=20&&d.foodReadyMinute>=1130));
 s.fixedAllocations=[{orderId:'collection',start:1120,finish:1200}];
 assert.equal(recommendDeliveryRuns(input,{assessKitchen:make(s)}).status,'UNVERIFIED');
});
