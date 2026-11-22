'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createStagingEdgeHandler}=require('../staging-secure-edge-entry');
const digest='a'.repeat(64);
const certificate={status:'CANDIDATE_FOR_STAGING',projectRef:'hvrqgufqjslvgiohgkvu',
 schema:'master_wok_rehearsal',deliveryProjectRef:'ubyjrrsvbbqomitpaidb',
 sourceSha256:digest,releaseId:'master-wok-delivery-2026-11-04'};
const vars={SUPABASE_URL:'https://hvrqgufqjslvgiohgkvu.supabase.co',
 SUPABASE_DB_URL:'postgresql://example.invalid/staging',
 MASTER_WOK_RELEASE_ID:certificate.releaseId,
 MASTER_WOK_BOOKING_SECRET:'a'.repeat(40),
 MASTER_WOK_NOTIFICATION_SECRET:'b'.repeat(40),
 MASTER_WOK_DELIVERY_PROJECT_REF:certificate.deliveryProjectRef,
 MASTER_WOK_DELIVERY_PUBLIC_KEY:'example-public-key',
 MASTER_WOK_PAYMENTS:'enabled',MASTER_WOK_REVIEW_APPROVALS:'disabled'};
test('passes environment-only configuration into deployment runtime',()=>{
 let poolOptions,received;
 const handler=()=>({success:true});
 const result=createStagingEdgeHandler({
  getEnv:key=>vars[key],certificate,sourceSha256:digest,model:{},
  createPool:options=>{poolOptions=options;return {connected:true};},
  createDeploymentRuntime:options=>{received=options;return handler;}
 });
 assert.equal(result,handler);
 assert.equal(poolOptions.connectionString,vars.SUPABASE_DB_URL);
 assert.equal(received.secret,vars.MASTER_WOK_BOOKING_SECRET);
 assert.equal(received.notificationSecret,vars.MASTER_WOK_NOTIFICATION_SECRET);
 assert.equal(received.projectRef,certificate.projectRef);
 assert.equal(received.paymentsEnabled,true);
 assert.equal(received.reviewApprovalsEnabled,false);
});
test('fails closed without creating pool when environment is invalid',async()=>{
 let calls=0;
 const handler=createStagingEdgeHandler({
  getEnv:key=>key==='MASTER_WOK_BOOKING_SECRET'?undefined:vars[key],
  certificate,sourceSha256:digest,
  createPool:()=>{calls++;return {};},
  createDeploymentRuntime:()=>{calls++;return ()=>{};}
 });
 const response=await handler();
 assert.equal(response.status,503);
 assert.deepEqual(await response.json(),{error:'RELEASE_NOT_CERTIFIED_OR_CONFIGURED'});
 assert.equal(calls,0);
});
test('fails closed on runtime constructor error without exposing exception',async()=>{
 const handler=createStagingEdgeHandler({
  getEnv:key=>vars[key],certificate,sourceSha256:digest,
  createPool:()=>({}),createDeploymentRuntime:()=>{throw Error('PRIVATE_DATABASE_ERROR');}
 });
 const response=await handler();
 assert.equal(response.status,503);
 assert.doesNotMatch(await response.text(),/PRIVATE_DATABASE_ERROR/);
});

test('fails closed if environment access throws',async()=>{
 let created=false;
 const handler=createStagingEdgeHandler({
  getEnv:()=>{throw Error('PRIVATE_ENVIRONMENT_ERROR');},
  certificate,sourceSha256:digest,
  createPool:()=>{created=true;return {};},
  createDeploymentRuntime:()=>()=>{}
 });
 const response=await handler();
 assert.equal(response.status,503);
 assert.equal(created,false);
 assert.doesNotMatch(await response.text(),/PRIVATE_ENVIRONMENT_ERROR/);
});
test('fails closed if pool construction throws without exposing connection details',async()=>{
 const handler=createStagingEdgeHandler({
  getEnv:key=>vars[key],certificate,sourceSha256:digest,
  createPool:()=>{throw Error('PRIVATE_DATABASE_CONNECTION_STRING');},
  createDeploymentRuntime:()=>()=>{}
 });
 const response=await handler();
 assert.equal(response.status,503);
 assert.doesNotMatch(await response.text(),/PRIVATE_DATABASE_CONNECTION_STRING/);
});
