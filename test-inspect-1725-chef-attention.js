'use strict';
const assert=require('node:assert/strict');
const {assess}=require('./inspect-1725-chef-attention');
const trace={slot:'17:25',minutesFromBookingToCollection:10,wokJobs:[
 {itemId:'pad-thai',start:'17:17',finish:'17:25',orderIds:['offline-candidate']},
 {itemId:'green-curry',start:'17:19',finish:'17:25',orderIds:['offline-candidate']},
 {itemId:'stir-crispy',start:'17:20',finish:'17:25',orderIds:['offline-candidate']},
 {itemId:'pad-see-ew',start:'17:11',finish:'17:21',orderIds:['prior']}
]};
const result=assess(trace);
assert.equal(result.leadTimeBelowThreshold,true);
assert.equal(result.maxConcurrentJobs,4);
assert(result.candidateOverlapIntervals.some(x=>x.start==='17:20'&&x.finish==='17:21'&&x.concurrentJobs===4));
assert(result.candidateOverlapIntervals.some(x=>x.start==='17:21'&&x.finish==='17:25'&&x.concurrentJobs===3));
assert.equal(result.operationalStatus,'REQUIRES_KITCHEN_REVIEW');
assert.equal(result.bookingApprovalAllowed,false);
assert.equal(result.chefAttentionModelValidated,false);
assert.equal(assess({...trace,minutesFromBookingToCollection:20,wokJobs:[]}).operationalStatus,'STILL_UNVERIFIED');
console.log('PASS: offline chef overlap and hypothetical lead-time checks remain non-authoritative');
