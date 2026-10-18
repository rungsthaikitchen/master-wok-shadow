'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {run}=require('./staging-delivery/single_delivery_once');
const source=()=>({serviceDate:'2026-10-17',timezone:'Europe/London',completeForServiceDate:true,
 evidenceBasis:'CURRENT_SAVED_STATE_NOT_DECISION_HISTORY',orderCount:1,orders:[{orderId:'private-alias',orderType:'delivery',status:'completed',
 createdAt:'2026-10-17T15:38:48Z',preferred_time:'2026-10-17T16:00:00Z',confirmed_time:'2026-10-17T16:15:00Z',proposed_time:null,
 lines:[{itemId:'panang-curry',qty:1,mods:[{id:'chicken'}]}]}]});
function env(){return {MASTER_WOK_SINGLE_DELIVERY_ENABLED:'true',RAILWAY_ENVIRONMENT_NAME:'master-wok-staging',
 RAILWAY_PROJECT_ID:'7821ad5b-f5c2-4ab4-9206-c3d76eefd4c8',RAILWAY_ENVIRONMENT_ID:'c1b8fad6-dbfc-4188-b4b5-a5dbfbf53279',RAILWAY_SERVICE_NAME:'master-wok-single-delivery-trial',MASTER_WOK_SINGLE_DELIVERY_LIVE_REQUESTS:'true',MASTER_WOK_SINGLE_DELIVERY_REQUEST_BUDGET:'2',
 MASTER_WOK_SINGLE_DELIVERY_SCOPE:'ONE_CUSTOMER_TWO_ROUTES_MEMORY_ONLY',MASTER_WOK_STAGING_GOOGLE_ROUTES_KEY:'fake-secret',
 MASTER_WOK_SINGLE_DELIVERY_PRIVATE_INPUT:JSON.stringify({source:source(),points:{KITCHEN:{lat:53.7,lng:-1.6},CANDIDATE:{lat:53.71,lng:-1.61}}})};}
const clock=()=> '2026-10-18T11:15:00Z';
test('one-customer runner remains off and requires explicit budget/scope/staging',async()=>{
 assert.equal((await run({})).status,'DISABLED');
 for(const field of ['RAILWAY_ENVIRONMENT_NAME','RAILWAY_PROJECT_ID','RAILWAY_ENVIRONMENT_ID','RAILWAY_SERVICE_NAME','MASTER_WOK_SINGLE_DELIVERY_LIVE_REQUESTS','MASTER_WOK_SINGLE_DELIVERY_REQUEST_BUDGET','MASTER_WOK_SINGLE_DELIVERY_SCOPE']){
 let calls=0;const e=env();delete e[field];const r=await run(e,{transport:()=>calls++,clock});assert.equal(calls,0);assert.equal(r.networkRequests,0);}
});
test('two asymmetric provider estimates reach conditional historical kitchen/driver model without disclosure',async()=>{
 let calls=0;const r=await run(env(),{clock,transport:async()=>({status:200,data:{routes:[{duration:++calls===1?'480s':'720s'}]}})});
 assert.equal(calls,2);assert.equal(r.status,'SHADOW_RECOMMENDATION');assert.equal(r.networkRequests,2);
 assert.equal(r.journeyBasis,'CURRENT_ESTIMATES_APPLIED_RETROSPECTIVELY');assert.equal(r.persistence,'NONE');assert.equal(r.verified,false);
 for(const privateValue of ['private-alias','fake-secret','panang-curry','durationSeconds','lat','recommendation'])assert.equal(JSON.stringify(r).includes(privateValue),false);
});
test('earlier commitment, invalid coordinates and malformed menu cause zero requests',async()=>{
 for(const mutate of [s=>s.source.completeForServiceDate=false,s=>s.points.CANDIDATE.lat=999,s=>s.source.orders[0].lines[0].itemId='unknown-item']){
 const e=env(),input=JSON.parse(e.MASTER_WOK_SINGLE_DELIVERY_PRIVATE_INPUT);mutate(input);e.MASTER_WOK_SINGLE_DELIVERY_PRIVATE_INPUT=JSON.stringify(input);
 let calls=0;const r=await run(e,{clock,transport:()=>calls++});assert.equal(calls,0);assert.equal(r.status,'UNVERIFIED');}
});
test('provider failure stops at one request without retries or partial assessment',async()=>{
 let calls=0;const r=await run(env(),{clock,transport:async()=>{calls++;return {status:403};}});
 assert.equal(calls,1);assert.equal(r.networkRequests,1);assert.equal(r.status,'UNVERIFIED');
});
