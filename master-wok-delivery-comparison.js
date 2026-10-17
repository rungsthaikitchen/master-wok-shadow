'use strict';
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {assessStagingDeliverySource}=require('./master-wok-staging-delivery-source');
// These staging records deliberately cannot claim exact real booking decisions.
function modelBuildHash() {
 const files=['master-wok.js','master-wok-model-bundle.js','master-wok-live-shadow.js',
  'master-wok-delivery-runs.js','master-wok-delivery-kitchen.js','master-wok-delivery-assessment.js',
  'master-wok-rtk-delivery-assessment.js','master-wok-rtk-delivery-policy.json',
  'master-wok-staging-delivery-source.js','master-wok-delivery-comparison.js'];
 const hash=crypto.createHash('sha256');
 for(const file of files){hash.update(file+'\0');hash.update(fs.readFileSync(path.join(__dirname,file)));}
 return hash.digest('hex');
}
function createStagingComparison(caseKey,source,{enabled=false}={}) {
 if(enabled!==true)return {status:'DISABLED',verified:false,records:[]};
 if(typeof caseKey!=='string'||!/^[A-Z0-9_]{1,64}$/.test(caseKey)||source?.dataOrigin!=='SYNTHETIC_STAGING'||
    source?.projectRef!=='hvrqgufqjslvgiohgkvu')throw Error('SYNTHETIC_STAGING_REQUIRED');
 const frozen=structuredClone(source),result=assessStagingDeliverySource(frozen,{enabled:true});
 const hash=modelBuildHash(),sourceHash=crypto.createHash('sha256').update(JSON.stringify(frozen)).digest('hex');
 const statuses=new Map((Array.isArray(frozen.orders)?frozen.orders:[]).map(o=>[o.orderId,o.status]));
 const prediction=result.status==='SHADOW_RECOMMENDATION'?'RECOMMENDED':'UNVERIFIED';
 const records=(Array.isArray(frozen.candidateIds)?frozen.candidateIds:[]).map(orderId=>{
  if(typeof orderId!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(orderId))throw Error('INVALID_TEST_ALIAS');
  const observedStatus=['pending','confirmed','completed','cancelled','customer_declined'].includes(statuses.get(orderId))?
   statuses.get(orderId):'unknown';
  const record={schemaVersion:1,caseKey,orderAlias:orderId,dataOrigin:'SYNTHETIC_STAGING',
   sourceEvidence:'CURRENT_SAVED_STATE_NOT_DECISION_HISTORY',serviceDate:frozen.serviceDate,
   assessedAt:frozen.assessedAt,sourceHash,buildHash:hash,policyId:'rtk-delivery-shadow-2026-10-17-v1',
   observedStatus,prediction,reasonCode:/^[A-Z0-9_]{1,64}$/.test(result.reasonCode||'')?result.reasonCode:'ASSESSMENT_UNVERIFIED',
   planKind:result.recommendation?.kind??null,verified:false};
  return {observationKey:crypto.createHash('sha256').update(JSON.stringify(record)).digest('hex'),...record};
 });
 return {status:result.status,reasonCode:result.reasonCode,verified:false,result,records};
}
module.exports={createStagingComparison,modelBuildHash};
