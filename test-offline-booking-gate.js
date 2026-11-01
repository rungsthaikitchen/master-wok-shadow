'use strict';
// Regression: real offline Master Wok combined results are diagnostic, not booking authorisation.
// No database connection, no checkout writes, no network calls.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {run}=require('./generate-combined-offline-slot-report');
const {chooseBookingAssessment}=require('./staging-booking-mode');
async function main(){
 const [snapshotPath,htmlPath]=process.argv.slice(2);
 if(!snapshotPath||!htmlPath)throw Error('Usage: node test-offline-booking-gate.js <snapshot.json> <index.html>');
 const report=run(JSON.parse(fs.readFileSync(snapshotPath,'utf8')),fs.readFileSync(htmlPath,'utf8'));
 assert.equal(report.bookingApprovalAllowed,false);
 const eligible=report.rows.filter(r=>r.combined==='PROTOTYPE_FIT_LEAD_AND_COLD_FRYER_ONLY');
 assert.ok(eligible.length>0,'Expected at least one prototype-fit candidate for this fixture');
 const gate=chooseBookingAssessment({
  mode:'MASTER_WOK',
  legacyAssess:()=>({status:'GREEN'}),
  masterWokAssess:async()=>({
   status:'GREEN',
   bookingApprovalAllowed:report.bookingApprovalAllowed,
   diagnostic:eligible[0].combined
  })
 });
 const decision=await gate({acceptedOrders:[],proposedOrder:{}});
 assert.equal(decision.status,'UNVERIFIED');
 assert.equal(decision.reason,'MASTER_WOK_NOT_AUTHORISED');
 const legacy=chooseBookingAssessment({mode:'LEGACY',legacyAssess:()=>({status:'GREEN'})});
 assert.equal((await legacy({})).status,'GREEN');
 console.log('PASS: real offline Master Wok prototype cannot authorise booking; legacy mode remains independent');
 console.log('Prototype combined fits='+eligible.length+'; bookingApprovalAllowed=false');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
