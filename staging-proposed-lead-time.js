'use strict';
// Offline only: no booking approval.
function assess({placedMinute,readyMinute,jobs,bufferMinutes=10}){
 if(!Number.isInteger(placedMinute)||!Number.isInteger(readyMinute)||!Array.isArray(jobs)||!jobs.length||!Number.isInteger(bufferMinutes)||bufferMinutes<0)
  return {status:'UNVERIFIED',bookingApprovalAllowed:false};
 if(jobs.some(j=>!Number.isInteger(j.start)||!Number.isInteger(j.finish)||j.finish<=j.start))
  return {status:'UNVERIFIED',bookingApprovalAllowed:false};
 const duration=Math.max(...jobs.map(j=>j.finish))-Math.min(...jobs.map(j=>j.start));
 const available=readyMinute-placedMinute,required=duration+bufferMinutes;
 return {status:available>=required?'MEETS_PROPOSED_LEAD_TIME':'BELOW_PROPOSED_LEAD_TIME',
  projectedCookingMinutes:duration,bufferMinutes,availableMinutes:available,requiredMinutes:required,
  shortfallMinutes:Math.max(0,required-available),
  warning:'Candidate wok-job span only; fryer attribution, prep and booking availability not verified.',
  bookingApprovalAllowed:false};
}
module.exports={assess};
