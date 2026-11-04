'use strict';
// Server bootstrap only. Prototype status/flags never constitute certification.
// The reviewed certificate binds a particular runtime source digest and project;
// the transaction still requires the operator's matching durable release approval.
const {verifyCombinedCapacity}=require('./master-wok-combined-assessment');
const {createMutationAssessment}=require('./master-wok-mutation-assessment');
const {protectStartedWork}=require('./master-wok-protected-plan');
const REQUIRED_CHECKS=['atomicConcurrency','physicalCoverage','lifecycle','writeFence',
 'commercial','delivery','notifications','wholeService','rollback'];
function validateCertificate(c,{releaseId,sourceSha256,projectRef,schema}={}){
 const staging=projectRef==='hvrqgufqjslvgiohgkvu'&&schema==='master_wok_rehearsal';
 const production=projectRef==='ubyjrrsvbbqomitpaidb'&&schema==='public';
 const candidate=staging&&c?.status==='CANDIDATE_FOR_STAGING';
 if(!c||c.schemaVersion!==1||!(staging||production)||
  (!candidate&&c.status!==(staging?'CERTIFIED_FOR_STAGING':'CERTIFIED_FOR_PRODUCTION'))||
  !/^[A-Za-z0-9._-]{8,128}$/.test(releaseId||'')||c.releaseId!==releaseId||c.projectRef!==projectRef||
  c.schema!==schema||c.modelVersion!=='combined-kitchen-protected-v3'||
  !/^[a-f0-9]{64}$/.test(sourceSha256||'')||c.sourceSha256!==sourceSha256||
  REQUIRED_CHECKS.some(key=>candidate?!['PASS','PENDING'].includes(c.checks?.[key]):c.checks?.[key]!=='PASS')||
  (candidate&&!/^[A-Za-z0-9-]{8,100}-$/.test(c.fixturePrefix||''))||
  (production&&c.fixturePrefix))throw Error('RELEASE_CERTIFICATION_REQUIRED');
 return true;
}
function createReleaseAssessors({certificate,releaseId,sourceSha256,projectRef,schema,model,
 readOrders,readAvailability,planStore}={}){
 validateCertificate(certificate,{releaseId,sourceSha256,projectRef,schema});
 const mutation=createMutationAssessment({model,readOrders,readAvailability,planStore});
 const fail=()=>({status:'UNVERIFIED',reason:'RELEASE_ASSESSMENT_NOT_VERIFIED',bookingApprovalAllowed:false});
 return {
  assessBooking(context){
   // Call the complete validator directly, not an injected prototype assessor.
   const r=verifyCombinedCapacity(context);
   if(r.status!=='VERIFIED_KITCHEN_CAPACITY'||r.plan?.modelVersion!==certificate.modelVersion)return fail();
   try{protectStartedWork(r.plan,0);}catch(_){return fail();}
   return {...r,status:'GREEN',reason:'CERTIFIED_RELEASE_CAPACITY',bookingApprovalAllowed:true};
  },
  async assessMutation(context){
   const r=await mutation(context);
   if(r.status!=='VALIDATED_LIFECYCLE_ASSESSMENT'||
    Object.keys(r.plansByDate||{}).sort().join()!==[...new Set(context.dates)].sort().join())return fail();
   try{for(const p of Object.values(r.plansByDate)){
    if(p.modelVersion!==certificate.modelVersion)return fail();protectStartedWork(p,0);
   }}catch(_){return fail();}
   return {...r,status:'GREEN',reason:'CERTIFIED_RELEASE_LIFECYCLE',bookingApprovalAllowed:true};
  }
 };
}
module.exports={createReleaseAssessors,validateCertificate,REQUIRED_CHECKS};
