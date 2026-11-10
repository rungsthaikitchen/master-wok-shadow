'use strict';
// Server bootstrap only. Prototype status/flags never constitute certification.
// The reviewed certificate binds a particular runtime source digest and project;
// the transaction still requires the operator's matching durable release approval.
const {verifyCombinedCapacity}=require('./master-wok-combined-assessment');
const {createMutationAssessment}=require('./master-wok-mutation-assessment');
const {protectStartedWork,RING_MODEL_VERSION}=require('./master-wok-protected-plan');
const DELIVERY_CHECKS=['driverReservations','combinedTrips','deliveryCheckout','deliveryRollback'];
const REQUIRED_CHECKS=['atomicConcurrency','physicalCoverage','lifecycle','writeFence',
 'commercial','delivery','notifications','wholeService','rollback'];
function validateCertificate(c,{releaseId,sourceSha256,projectRef,schema}={}){
 const staging=projectRef==='hvrqgufqjslvgiohgkvu'&&schema==='master_wok_rehearsal';
 const production=projectRef==='ubyjrrsvbbqomitpaidb'&&schema==='public';
 const candidate=staging&&c?.status==='CANDIDATE_FOR_STAGING';
 const fourRing=c?.modelVersion===RING_MODEL_VERSION&&
  c?.kitchenConfiguration==='FOUR_RING_ONE_PORTION_V1';
 if(!c||c.schemaVersion!==1||!(staging||production)||
  (!candidate&&c.status!==(staging?'CERTIFIED_FOR_STAGING':'CERTIFIED_FOR_PRODUCTION'))||
  !/^[A-Za-z0-9._-]{8,128}$/.test(releaseId||'')||c.releaseId!==releaseId||c.projectRef!==projectRef||
  c.schema!==schema||!(c.modelVersion==='combined-kitchen-protected-v3'||fourRing)||
  (c.kitchenConfiguration!==undefined&&!fourRing)||
  !/^[a-f0-9]{64}$/.test(sourceSha256||'')||c.sourceSha256!==sourceSha256||
  REQUIRED_CHECKS.some(key=>candidate?!['PASS','PENDING'].includes(c.checks?.[key]):c.checks?.[key]!=='PASS')||
  (candidate&&!/^[A-Za-z0-9-]{8,100}-$/.test(c.fixturePrefix||''))||
  (production&&c.fixturePrefix)||
  (c.deliveryScheduling!==undefined&&c.deliveryScheduling!==1)||
  (c.deliveryScheduling===1&&DELIVERY_CHECKS.some(key=>candidate?!['PASS','PENDING'].includes(c.checks?.[key]):c.checks?.[key]!=='PASS')))throw Error('RELEASE_CERTIFICATION_REQUIRED');
 return true;
}
function createReleaseAssessors({certificate,releaseId,sourceSha256,projectRef,schema,model,
 readOrders,readAvailability,planStore,deliveryCapacity}={}){
 validateCertificate(certificate,{releaseId,sourceSha256,projectRef,schema});
 const stagingSharedRings=certificate.modelVersion===RING_MODEL_VERSION;
 const kitchenOptions=stagingSharedRings?{sharedRings:true,stagingSharedRings:true}:{};
 if((certificate.deliveryScheduling===1)!==!!deliveryCapacity||deliveryCapacity&&
  (typeof deliveryCapacity.verify!=='function'||typeof deliveryCapacity.replan!=='function'))
  throw Error('CERTIFIED_DELIVERY_COMPONENT_REQUIRED');
 if(stagingSharedRings&&deliveryCapacity&&deliveryCapacity.kitchenModelVersion!==RING_MODEL_VERSION)
  throw Error('STAGING_KITCHEN_DELIVERY_MODEL_MISMATCH');
 const mutation=createMutationAssessment({model,readOrders,readAvailability,planStore,deliveryCapacity,stagingSharedRings});
 const fail=()=>({status:'UNVERIFIED',reason:'RELEASE_ASSESSMENT_NOT_VERIFIED',bookingApprovalAllowed:false});
 return {
  assessBooking(context){
   const searchOptions={};
   // Call the complete validator directly, not an injected prototype assessor.
   if(deliveryCapacity)return deliveryCapacity.verify(context,searchOptions).then(finish);
   return finish(verifyCombinedCapacity(context,{...kitchenOptions,...searchOptions}));
   function finish(r){
   if(r.status!=='VERIFIED_KITCHEN_CAPACITY'||r.plan?.modelVersion!==certificate.modelVersion)return fail();
   try{protectStartedWork(r.plan,0);}catch(_){return fail();}
   return {...r,status:'GREEN',reason:'CERTIFIED_RELEASE_CAPACITY',bookingApprovalAllowed:true};
   }
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
module.exports={createReleaseAssessors,validateCertificate,REQUIRED_CHECKS,DELIVERY_CHECKS};
