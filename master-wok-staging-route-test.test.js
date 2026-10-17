'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {run}=require('./staging-delivery/route_test');
const env=()=>({MASTER_WOK_ROUTE_TEST_ENABLED:'true',MASTER_WOK_ROUTE_TEST_LIVE_REQUESTS:'true',
 RAILWAY_ENVIRONMENT_NAME:'master-wok-staging',MASTER_WOK_STAGING_GOOGLE_ROUTES_KEY:'test-private-key',
 MASTER_WOK_ROUTE_TEST_INPUT:path.join(__dirname,'staging-delivery/route-test-input.json')});
test('staging runner is disabled by default and rejects production environments',async()=>{
 assert.equal((await run({})).status,'DISABLED');const e=env();e.RAILWAY_ENVIRONMENT_NAME='production';
 assert.equal((await run(e)).reasonCode,'STAGING_ENVIRONMENT_REQUIRED');
});
test('six-request runner reports evidence presence without route contents or secrets',async()=>{
 let calls=0;const result=await run(env(),{transport:async()=>{calls++;return {status:200,data:{routes:[{duration:'300s'}]}};},
 clock:()=> '2026-10-17T17:00:00Z'});
 assert.equal(result.status,'ROUTE_ESTIMATES_CAPTURED');assert.equal(calls,6);assert.equal(result.directionalLegs,6);
 for(const privateText of ['test-private-key','Morley','300','latitude','longitude'])assert.ok(!JSON.stringify(result).includes(privateText));
 assert.equal(result.persistence,'NONE');
});
test('staging runner fails closed on missing key or input without requesting routes',async()=>{
 for(const change of [e=>e.MASTER_WOK_STAGING_GOOGLE_ROUTES_KEY='',e=>e.MASTER_WOK_ROUTE_TEST_INPUT='/private-missing-file']) {
  const e=env();change(e);let calls=0;const r=await run(e,{transport:async()=>calls++});
  assert.equal(r.status,'UNVERIFIED');assert.equal(calls,0);assert.ok(!JSON.stringify(r).includes('private-missing'));
 }
});
