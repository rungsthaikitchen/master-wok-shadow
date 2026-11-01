'use strict';
// Offline readiness diagnostic. Conservative cold-start assumption.
// No fryer switch state is measured; never approves bookings.
function assess({placedMinute,cycles,orderId,warmupMinutes=5}){
 if(!Number.isInteger(placedMinute)||!Array.isArray(cycles)||!orderId||
  !Number.isInteger(warmupMinutes)||warmupMinutes<0)
  return {status:'UNVERIFIED',reason:'INVALID_INPUT',bookingApprovalAllowed:false};
 const relevant=cycles.filter(c=>Array.isArray(c.orderIds)&&c.orderIds.includes(orderId));
 if(cycles.some(c=>!Array.isArray(c.orderIds)))
  return {status:'UNVERIFIED',reason:'MISSING_CYCLE_ATTRIBUTION',bookingApprovalAllowed:false};
 if(!relevant.length)return {status:'NO_CANDIDATE_FRY_CYCLES',bookingApprovalAllowed:false};
 if(relevant.some(c=>!Number.isInteger(c.start)||!Number.isInteger(c.finish)||c.finish<=c.start||!c.basket))
  return {status:'UNVERIFIED',reason:'INVALID_CYCLE',bookingApprovalAllowed:false};
 const earliest=Math.min(...relevant.map(c=>c.start));
 const readyAt=placedMinute+warmupMinutes;
 return {status:earliest>=readyAt?'COLD_FRYER_READY_IN_TIME':'COLD_FRYER_NOT_READY_IN_TIME',
  earliestCandidateFryMinute:earliest,coldReadyMinute:readyAt,warmupMinutes,
  assumptions:'All fryers cold at booking; no prior preheating or shared warmup state inferred.',
  bookingApprovalAllowed:false};
}
module.exports={assess};
