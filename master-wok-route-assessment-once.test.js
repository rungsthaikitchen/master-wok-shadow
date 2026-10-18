'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {run,makeFreshTrial}=require('./staging-delivery/route_assessment_once');
const env={MASTER_WOK_ROUTE_ASSESSMENT_ENABLED:'true',MASTER_WOK_ROUTE_ASSESSMENT_LIVE_REQUESTS:'true',
 MASTER_WOK_ROUTE_ASSESSMENT_REQUEST_BUDGET:'6',RAILWAY_ENVIRONMENT_NAME:'master-wok-staging',MASTER_WOK_STAGING_GOOGLE_ROUTES_KEY:'fake-key'};
test('entrypoint off by default and requires all scope flags',async()=>{
 assert.equal((await run({})).status,'DISABLED');
 for(const key of ['MASTER_WOK_ROUTE_ASSESSMENT_LIVE_REQUESTS','MASTER_WOK_ROUTE_ASSESSMENT_REQUEST_BUDGET','RAILWAY_ENVIRONMENT_NAME']){
 let calls=0;const e={...env};delete e[key];const r=await run(e,{transport:()=>calls++});assert.equal(calls,0);assert.equal(r.networkRequests,0);
 }
});
test('fresh fixture follows London date and summer/winter arrival offsets',()=>{
 for(const [now,target] of [['2026-10-18T08:00:00Z','2026-10-18T19:00:00+01:00'],['2026-11-01T08:00:00Z','2026-11-01T19:00:00+00:00']]){
 const s=makeFreshTrial(now).source;assert.equal(s.orders[0].preferred_time,target);assert.equal(s.existingPlan.assessedAt,now.replace('Z','.000Z'));
 }
 assert.throws(()=>makeFreshTrial('2026-10-18T16:00:00Z'));
});
test('one shot consumes six fake requests and prints no customer/provider details',async()=>{
 let calls=0;const r=await run(env,{clock:()=> '2026-10-18T08:00:00Z',transport:async()=>{
 calls++;return {status:200,data:{routes:[{duration:'180s'}]}};
 }});assert.equal(calls,6);assert.equal(r.status,'SHADOW_RECOMMENDATION');assert.equal(r.verified,false);
 assert.equal(JSON.stringify(r).includes('Morley'),false);assert.equal(r.persistence,'NONE');
});
