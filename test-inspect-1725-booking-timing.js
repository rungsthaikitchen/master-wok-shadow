'use strict';
const assert=require('node:assert/strict');
const {assess}=require('./inspect-1725-booking-timing');
const trace={slot:'17:25',bookingMomentUK:'17:15',wokJobs:[
 {itemId:'pad-thai',start:'17:17',finish:'17:25',orderIds:['offline-candidate']},
 {itemId:'green-curry',start:'17:19',finish:'17:25',orderIds:['offline-candidate']},
 {itemId:'stir-crispy',start:'17:20',finish:'17:25',orderIds:['offline-candidate']},
 {itemId:'pad-see-ew',start:'17:11',finish:'17:21',orderIds:['prior']}
],fryerCycles:[{type:'crispyChicken',basket:'large',start:1035,finish:1040,deadline:1040},
 {type:'chips',basket:'small-1',start:1043,finish:1048,deadline:1048}]};
const result=assess(trace);
assert.equal(result.leadTimeMinutes,10);
assert.equal(result.earliestCandidateRelevantActivity,'17:15');
assert.equal(result.requiresImmediateProduction,true);
assert.equal(result.startsBeforeBooking,false);
assert.equal(result.candidateWokJobs.length,3);
assert.equal(result.possiblyCandidateFryerCycles.length,1);
assert.equal(result.fryerCycleAttributionVerified,false);
assert.equal(result.bookingApprovalAllowed,false);
console.log('PASS: booking-moment timing diagnostic remains read-only and non-authoritative');

