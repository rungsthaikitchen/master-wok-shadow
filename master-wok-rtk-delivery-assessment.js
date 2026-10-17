'use strict';
// RTK's approved offline/staging profile. No production activation or transport.
const policy=require('./master-wok-rtk-delivery-policy.json');
const {assessDeliverySnapshot}=require('./master-wok-delivery-assessment');
function assessRtkDeliverySnapshot(input,{enabled=false}={}) {
 if(enabled!==true)return {status:'DISABLED',verified:false};
 try {
  const s=structuredClone(input);
  if(!s||!Array.isArray(s.orders))throw Error();
  const result=assessDeliverySnapshot({...s,loadingMinutes:policy.loadingMinutes,
   minCombinedSavingMinutes:policy.minCombinedSavingMinutes,
   orders:s.orders.map(o=>({...o,handoverMinutes:policy.handoverMinutes}))},{enabled:true});
  // Generic routing may favour improved freshness or combined-only feasibility.
  // RTK's approved threshold is stricter: demonstrate at least five minutes saved.
  if(result.recommendation?.kind==='COMBINED'&&
     (!Number.isFinite(result.combinedDriverMinutesSaved)||result.combinedDriverMinutesSaved<policy.minCombinedSavingMinutes)) {
   if(result.separateAlternative) {
    result.recommendation=structuredClone(result.separateAlternative);
    result.reasonCode='RTK_MINIMUM_COMBINED_SAVING_NOT_MET';
   } else {
    result.status='UNVERIFIED';result.reasonCode='RTK_COMBINED_SAVING_UNVERIFIED';
    result.recommendation=null;
   }
  }
  return {...result,policyId:policy.policyId,policyScope:policy.scope};
 } catch(_){return {status:'UNVERIFIED',reasonCode:'RTK_DELIVERY_INPUT_UNVERIFIED',verified:false,policyId:policy.policyId};}
}
module.exports={assessRtkDeliverySnapshot};
