'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {readStagingBootstrapConfig}=require('../staging-secure-bootstrap-config');
const digest='a'.repeat(64);
const certificate={status:'CANDIDATE_FOR_STAGING',projectRef:'hvrqgufqjslvgiohgkvu',
 schema:'master_wok_rehearsal',deliveryProjectRef:'ubyjrrsvbbqomitpaidb',
 sourceSha256:digest,releaseId:'master-wok-delivery-2026-11-04'};
const vars={SUPABASE_URL:'https://hvrqgufqjslvgiohgkvu.supabase.co',
 SUPABASE_DB_URL:'postgresql://staging-placeholder',
 MASTER_WOK_RELEASE_ID:certificate.releaseId,
 MASTER_WOK_BOOKING_SECRET:'a'.repeat(40),
 MASTER_WOK_NOTIFICATION_SECRET:'b'.repeat(40),
 MASTER_WOK_DELIVERY_PROJECT_REF:'ubyjrrsvbbqomitpaidb',
 MASTER_WOK_DELIVERY_PUBLIC_KEY:'staging-public-placeholder',
 MASTER_WOK_PAYMENTS:'enabled',MASTER_WOK_REVIEW_APPROVALS:'disabled'};
function read(overrides={},cert=certificate,hash=digest){
 const env={...vars,...overrides};
 return readStagingBootstrapConfig({getEnv:key=>env[key],certificate:cert,sourceSha256:hash});
}
test('reads staging configuration from environment without embedding credentials',()=>{
 const config=read();
 assert.equal(config.secret,vars.MASTER_WOK_BOOKING_SECRET);
 assert.equal(config.notificationSecret,vars.MASTER_WOK_NOTIFICATION_SECRET);
 assert.equal(config.paymentsEnabled,true);
 assert.equal(config.reviewApprovalsEnabled,false);
 assert.equal(config.databaseUrl,vars.SUPABASE_DB_URL);
});
for(const [name,override] of [
 ['wrong project',{SUPABASE_URL:'https://ubyjrrsvbbqomitpaidb.supabase.co'}],
 ['missing database',{SUPABASE_DB_URL:undefined}],
 ['missing booking secret',{MASTER_WOK_BOOKING_SECRET:undefined}],
 ['identical secrets',{MASTER_WOK_NOTIFICATION_SECRET:vars.MASTER_WOK_BOOKING_SECRET}],
 ['wrong delivery project',{MASTER_WOK_DELIVERY_PROJECT_REF:'hvrqgufqjslvgiohgkvu'}],
 ['missing public key',{MASTER_WOK_DELIVERY_PUBLIC_KEY:undefined}],
 ['ambiguous payment flag',{MASTER_WOK_PAYMENTS:undefined}],
 ['ambiguous review flag',{MASTER_WOK_REVIEW_APPROVALS:undefined}]
])test('fails closed for '+name,()=>assert.throws(()=>read(override),/STAGING_|STAGING_PROJECT_REQUIRED/));
test('fails closed for mismatched source digest',()=>{
 assert.throws(()=>read({},certificate,'b'.repeat(64)),/STAGING_BOOTSTRAP_NOT_CONFIGURED/);
});
test('fails closed for production or draft certificate',()=>{
 assert.throws(()=>read({},{...certificate,status:'DRAFT'}),/STAGING_BOOTSTRAP_NOT_CONFIGURED/);
 assert.throws(()=>read({},{...certificate,schema:'public'}),/STAGING_BOOTSTRAP_NOT_CONFIGURED/);
});
