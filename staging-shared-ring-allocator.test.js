'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {allocateSharedRings}=require('./staging-shared-ring-allocator');
const job=(itemId,earliest=1040,latest=1040)=>({
 itemId,earliest,latest,duration:5,readyMinute:1050,holdingLimitMinutes:10
});
test('noodles, small stir fry and two curries can use four rings',()=>{
 const r=allocateSharedRings([
  job('pad-thai'),job('stir-basil'),job('panang-curry'),job('green-curry')
 ]);
 assert.equal(r.status,'PHYSICAL_FIT_PROTOTYPE');
 assert.equal(new Set(r.jobs.map(x=>x.vessel)).size,4);
 assert.equal(r.chefConcurrencyVerified,false);
 assert.equal(r.bookingApprovalAllowed,false);
});
test('fifth simultaneous vessel fails closed',()=>{
 const r=allocateSharedRings([
  job('pad-thai'),job('stir-basil'),job('panang-curry'),job('green-curry'),job('red-curry')
 ]);
 assert.equal(r.status,'UNVERIFIED');
});
test('two large woks only, with no small wok substitution for noodles',()=>{
 const r=allocateSharedRings([job('pad-thai'),job('pad-see-ew'),job('fried-rice')]);
 assert.equal(r.status,'UNVERIFIED');
});
test('unclassified cooking vessels fail closed',()=>{
 assert.equal(allocateSharedRings([job('unknown-dish')]).reason,'VESSEL_ELIGIBILITY_UNVERIFIED');
});
test('vessel reset requires a minute between consecutive batches',()=>{
 const r=allocateSharedRings([
  job('pad-thai',1040,1040),job('pad-see-ew',1040,1040),job('fried-rice',1045,1045)
 ]);
 assert.equal(r.status,'UNVERIFIED');
});
