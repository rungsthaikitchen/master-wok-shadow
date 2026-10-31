'use strict';
// Staging-only cross-resource dependency check. This checks existing plans;
// it does not optimise them or authorise bookings.
function checkFryerWokDependencies(wokPlan,fryerPlan){
 const violations=[];
 if(!wokPlan || wokPlan.status!=='FEASIBLE_PROTOTYPE' ||
    !fryerPlan || fryerPlan.status!=='FRY_ONLY_PROTOTYPE')
  return {status:'UNVERIFIED',reason:'RESOURCE_PLAN_MISSING',violations,bookingApprovalAllowed:false};
 const fryJobs=fryerPlan.jobs||[];
 for(const wok of wokPlan.jobs||[]){
  for(const orderId of wok.orderIds||[]){
   const related=fryJobs.filter(f=>f.orderId===orderId&&f.itemId===wok.itemId);
   for(const fry of related){
    if(fry.finish>wok.start)
     violations.push({orderId,itemId:wok.itemId,fryerFinish:fry.finish,wokStart:wok.start});
   }
  }
 }
 return {status:'UNVERIFIED',
  reason:violations.length?'FRYER_FINISHES_AFTER_WOK_START':'DEPENDENCY_TIMELINE_CHECK_ONLY',
  violations,bookingApprovalAllowed:false};
}
module.exports={checkFryerWokDependencies};
