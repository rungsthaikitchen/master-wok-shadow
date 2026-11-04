'use strict';
const assert=require('node:assert/strict');
const {chooseBookingAssessment}=require('./staging-booking-mode');
async function run(){
 let legacyCalls=0,masterCalls=0;
 const legacyAssess=()=>{legacyCalls++;return {status:'LEGACY_OK'};};
 const masterWokAssess=()=>{masterCalls++;return {status:'GREEN',bookingApprovalAllowed:false};};
 const context={acceptedOrders:[],proposedOrder:{}};
 const legacy=chooseBookingAssessment({mode:'LEGACY',legacyAssess,masterWokAssess});
 assert.equal((await legacy(context)).status,'LEGACY_OK');
 assert.equal(legacyCalls,1);assert.equal(masterCalls,0);
 const disabled=chooseBookingAssessment({mode:'MASTER_WOK',legacyAssess,masterWokAssess});
 assert.equal((await disabled(context)).status,'UNVERIFIED');
 assert.equal(legacyCalls,1);assert.equal(masterCalls,1);
 const absent=chooseBookingAssessment({mode:'MASTER_WOK',legacyAssess});
 assert.equal((await absent(context)).status,'UNVERIFIED');
 const error=chooseBookingAssessment({mode:'MASTER_WOK',legacyAssess,masterWokAssess:()=>{throw Error('test');}});
 assert.equal((await error(context)).status,'UNVERIFIED');
 assert.throws(()=>chooseBookingAssessment({mode:'UNKNOWN',legacyAssess}),/UNKNOWN_BOOKING_MODE/);
 const explicitlyAuthorised=chooseBookingAssessment({mode:'MASTER_WOK',legacyAssess,
  masterWokAssess:()=>({status:'GREEN',bookingApprovalAllowed:true})});
 assert.equal((await explicitlyAuthorised(context)).status,'GREEN');
 assert.equal(legacyCalls,1);
 console.log('PASS: staging booking mode defaults to legacy and fails closed for unapproved Master Wok results');
}
run().catch(e=>{console.error(e);process.exitCode=1;});

