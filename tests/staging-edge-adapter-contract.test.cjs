'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {assertStagingEdgeAdapter}=require('../staging-edge-adapter-contract');
const digest='a'.repeat(64);
const certificate={status:'CANDIDATE_FOR_STAGING',projectRef:'hvrqgufqjslvgiohgkvu',schema:'master_wok_rehearsal',deliveryProjectRef:'ubyjrrsvbbqomitpaidb',sourceSha256:digest};
const args={getEnv:()=>undefined,createPool:()=>{},serve:()=>{},model:{},certificate,sourceSha256:digest};
test('accepts staging-only adapter interface without executing it',()=>{
 assert.equal(assertStagingEdgeAdapter(args),true);
});
test('rejects missing Edge interfaces and model',()=>{
 assert.throws(()=>assertStagingEdgeAdapter({...args,serve:null}),/EDGE_ADAPTER_REQUIRED/);
 assert.throws(()=>assertStagingEdgeAdapter({...args,model:null}),/EDGE_MODEL_AND_CERTIFICATE_REQUIRED/);
});
test('rejects production and mismatched staging certificates',()=>{
 assert.throws(()=>assertStagingEdgeAdapter({...args,certificate:{...certificate,projectRef:'ubyjrrsvbbqomitpaidb'}}),/EDGE_STAGING_CERTIFICATE_REQUIRED/);
 assert.throws(()=>assertStagingEdgeAdapter({...args,sourceSha256:'b'.repeat(64)}),/EDGE_STAGING_CERTIFICATE_REQUIRED/);
 assert.throws(()=>assertStagingEdgeAdapter({...args,certificate:{...certificate,status:'DRAFT'}}),/EDGE_STAGING_CERTIFICATE_REQUIRED/);
});
