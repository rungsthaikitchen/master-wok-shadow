'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {chooseBookingAssessment}=require('./staging-booking-mode');
test('default mode uses existing legacy assessor',async()=>{
 let legacy=0,master=0;
 const assess=chooseBookingAssessment({legacyAssess:async()=>{legacy++;return {status:'GREEN'};},masterWokAssess:async()=>{master++;return {status:'GREEN',bookingApprovalAllowed:true};}});
 assert.equal((await assess({})).status,'GREEN');
 assert.equal(legacy,1);assert.equal(master,0);
});
test('unknown mode cannot silently fall back',()=>{
 assert.throws(()=>chooseBookingAssessment({mode:'BROKEN',legacyAssess:async()=>({status:'GREEN'})}),/UNKNOWN_BOOKING_MODE/);
});
test('shadow result cannot approve bookings',async()=>{
 const assess=chooseBookingAssessment({mode:'MASTER_WOK',legacyAssess:async()=>({status:'GREEN'}),masterWokAssess:async()=>({status:'VALIDATED_SHADOW_PROTOTYPE',bookingApprovalAllowed:false})});
 assert.equal((await assess({})).status,'UNVERIFIED');
});
test('master wok failure does not silently switch to legacy',async()=>{
 let legacy=0;
 const assess=chooseBookingAssessment({mode:'MASTER_WOK',legacyAssess:async()=>{legacy++;return {status:'GREEN'};},masterWokAssess:async()=>{throw Error('unavailable');}});
 assert.equal((await assess({})).status,'UNVERIFIED');
 assert.equal(legacy,0);
});
test('master wok GREEN without explicit approval fails closed',async()=>{
 const assess=chooseBookingAssessment({mode:'MASTER_WOK',legacyAssess:async()=>({status:'GREEN'}),masterWokAssess:async()=>({status:'GREEN'})});
 assert.equal((await assess({})).status,'UNVERIFIED');
});
test('explicitly approved GREEN can pass staging mode gate',async()=>{
 const assess=chooseBookingAssessment({mode:'MASTER_WOK',legacyAssess:async()=>({status:'AMBER'}),masterWokAssess:async()=>({status:'GREEN',bookingApprovalAllowed:true})});
 assert.equal((await assess({})).status,'GREEN');
});
