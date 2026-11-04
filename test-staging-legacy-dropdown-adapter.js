'use strict';
const assert=require('node:assert/strict');
const {captureDisplayedLegacySlots}=require('./staging-legacy-dropdown-adapter');
const document={getElementById(id){assert.equal(id,'cust-preferred-time-select');return {options:[
 {value:'',disabled:false},{value:'17:00',disabled:false},
 {value:'17:05',disabled:true},{value:'21:05',disabled:false}
]};}};
const result=captureDisplayedLegacySlots({document,serviceDate:'2026-10-30',basketLines:[{itemId:'pad-thai',qty:1,mods:[]}]});
assert.deepEqual(result.decisions,[
 {time:'17:00',legacyAllowed:true,window:'NORMAL'},
 {time:'17:05',legacyAllowed:false,window:'NORMAL'},
 {time:'21:05',legacyAllowed:true,window:'OVERRUN'}
]);
assert.equal(result.bookingApprovalAllowed,false);
assert.equal(result.masterWokStatus,'NOT_ASSESSED');
assert.throws(()=>captureDisplayedLegacySlots({document:null,serviceDate:'2026-10-30',basketLines:[]}),/DOCUMENT_REQUIRED/);
console.log('PASS: staging dropdown adapter captures displayed decisions without mutation');
