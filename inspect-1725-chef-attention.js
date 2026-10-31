'use strict';
// Offline chef-attention diagnostic: reports overlaps, does not claim a staffing limit.
// Conservative hypothetical lead-time threshold is configurable, not RTK policy.
const fs=require('node:fs');
const {inspect}=require('./inspect-1725-slot');
function assess(trace,{minimumLeadMinutes=15,simultaneousJobReviewThreshold=2}={}){
 if(!Number.isInteger(minimumLeadMinutes)||minimumLeadMinutes<0||
    !Number.isInteger(simultaneousJobReviewThreshold)||simultaneousJobReviewThreshold<1)
   throw Error('INVALID_THRESHOLDS');
 const jobs=trace.wokJobs.map(j=>({...j,startMinute:Number(j.start.slice(0,2))*60+Number(j.start.slice(3)),
   finishMinute:Number(j.finish.slice(0,2))*60+Number(j.finish.slice(3))}));
 const boundaries=[...new Set(jobs.flatMap(j=>[j.startMinute,j.finishMinute]))].sort((a,b)=>a-b);
 const overlaps=[];
 for(let i=0;i<boundaries.length-1;i++){
  const start=boundaries[i],finish=boundaries[i+1];
  if(start===finish)continue;
  const active=jobs.filter(j=>j.startMinute<finish&&j.finishMinute>start);
  if(active.length>=simultaneousJobReviewThreshold)
   overlaps.push({start:clock(start),finish:clock(finish),jobs:active.map(j=>({itemId:j.itemId,orderIds:j.orderIds})),concurrentJobs:active.length});
 }
 const candidateOverlaps=overlaps.filter(o=>o.jobs.some(j=>j.orderIds.includes('offline-candidate')));
 const leadTimeBelowThreshold=trace.minutesFromBookingToCollection<minimumLeadMinutes;
 return {slot:trace.slot,leadTimeMinutes:trace.minutesFromBookingToCollection,
  hypotheticalMinimumLeadMinutes:minimumLeadMinutes,leadTimeBelowThreshold,
  thresholdIsNotConfirmedRTKPolicy:true,simultaneousJobReviewThreshold,
  overlapIntervals:overlaps,candidateOverlapIntervals:candidateOverlaps,
  maxConcurrentJobs:Math.max(0,...overlaps.map(x=>x.concurrentJobs)),
  operationalStatus:leadTimeBelowThreshold||candidateOverlaps.length?'REQUIRES_KITCHEN_REVIEW':'STILL_UNVERIFIED',
  chefAttentionModelValidated:false,comparisonVerified:false,bookingApprovalAllowed:false};
}
function clock(n){return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');}
if(require.main===module){
 const [snapshotPath,htmlPath,leadArg]=process.argv.slice(2);
 if(!snapshotPath||!htmlPath)throw Error('Usage: node inspect-1725-chef-attention.js <snapshot.json> <index.html> [hypothetical-minimum-lead-minutes]');
 const minimumLeadMinutes=leadArg===undefined?15:Number(leadArg);
 const trace=inspect(JSON.parse(fs.readFileSync(snapshotPath,'utf8')),fs.readFileSync(htmlPath,'utf8'));
 console.log(JSON.stringify(assess(trace,{minimumLeadMinutes}),null,2));
}
module.exports={assess};
