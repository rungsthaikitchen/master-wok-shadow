'use strict';
// Staging-only booking-mode gate. Does not grant shadow prototypes booking rights.
// A mode is selected explicitly by trusted server configuration, never checkout input.
const MODES=Object.freeze({LEGACY:'LEGACY',MASTER_WOK:'MASTER_WOK'});
function chooseBookingAssessment({mode=MODES.LEGACY,legacyAssess,masterWokAssess}={}){
 if(mode!==MODES.LEGACY&&mode!==MODES.MASTER_WOK)
  throw Error('UNKNOWN_BOOKING_MODE');
 if(typeof legacyAssess!=='function')throw Error('LEGACY_ASSESSOR_REQUIRED');
 return async context=>{
  if(mode===MODES.LEGACY)return legacyAssess(context);
  if(typeof masterWokAssess!=='function')
   return {status:'UNVERIFIED',reason:'MASTER_WOK_ASSESSOR_UNAVAILABLE'};
  try{
   const result=await masterWokAssess(context);
   // Shadow validity is NOT permission to commit; both explicit authorisation
   // and a GREEN result are required from a future launch-certified assessor.
   if(result?.status==='GREEN'&&result.bookingApprovalAllowed===true)
    return result;
   return {status:'UNVERIFIED',reason:'MASTER_WOK_NOT_AUTHORISED'};
  }catch(_){
   return {status:'UNVERIFIED',reason:'MASTER_WOK_ASSESSMENT_FAILED'};
  }
 };
}
module.exports={MODES,chooseBookingAssessment};
