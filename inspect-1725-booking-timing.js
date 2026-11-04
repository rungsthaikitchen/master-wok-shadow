'use strict';
// Read-only offline booking-moment timing diagnostic; no invented RTK lead-time policy.
const fs=require('node:fs');
const {inspect}=require('./inspect-1725-slot');
function minute(s){const m=/^(\d{2}):(\d{2})$/.exec(s);if(!m)throw Error('INVALID_TIME_'+s);return Number(m[1])*60+Number(m[2]);}
function clock(n){return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');}
function assess(trace){
 const placed=minute(trace.bookingMomentUK);
 const collection=minute(trace.slot);
 const jobs=trace.wokJobs.filter(j=>j.orderIds.includes('offline-candidate')).map(j=>({
  itemId:j.itemId,start:j.start,finish:j.finish,minutesAfterBooking:minute(j.start)-placed,
  startsBeforeBooking:minute(j.start)<placed
 }));
 const cycles=trace.fryerCycles.filter(c=>c.start>=placed-30&&c.deadline<=collection&&c.finish<=collection)
  .map(c=>({type:c.type,basket:c.basket,start:clock(c.start),finish:clock(c.finish),
   minutesAfterBooking:c.start-placed,startsBeforeBooking:c.start<placed}));
 const earliest=Math.min(...jobs.map(j=>minute(j.start)),...cycles.map(c=>minute(c.start)));
 const margin=earliest-placed;
 return {slot:trace.slot,bookingMomentUK:trace.bookingMomentUK,
  leadTimeMinutes:collection-placed,
  earliestCandidateRelevantActivity:clock(earliest),
  minutesBetweenBookingAndEarliestActivity:margin,
  candidateWokJobs:jobs,possiblyCandidateFryerCycles:cycles,
  fryerCycleAttributionVerified:false,
  requiresImmediateProduction:margin===0,
  startsBeforeBooking:margin<0,
  preparationAndOrderAcknowledgementTimeModelled:false,
  customerLeadTimePolicyVerified:false,
  chefAttentionModelValidated:false,
  verdict:'TIMING_REVIEW_REQUIRED',
  warning:'Fryer cycles lack order IDs; matching by timing is indicative only. No customer booking decision is inferred.',
  bookingApprovalAllowed:false};
}
if(require.main===module){
 const [snapshotPath,htmlPath]=process.argv.slice(2);
 if(!snapshotPath||!htmlPath)throw Error('Usage: node inspect-1725-booking-timing.js <snapshot.json> <index.html>');
 const trace=inspect(JSON.parse(fs.readFileSync(snapshotPath,'utf8')),fs.readFileSync(htmlPath,'utf8'));
 console.log(JSON.stringify(assess(trace),null,2));
}
module.exports={assess};
