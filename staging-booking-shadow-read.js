'use strict';
// Read-only staging integration entry point. The supplied connection must be
// read-only; this function never opens a transaction or invokes booking writes.
const {readStagingOrders}=require('./staging-order-reader');
const {compareStagingBookingSnapshot}=require('./staging-booking-shadow-bridge');
async function compareStagingBookingReadOnly({connection,serviceDate,model,candidate,legacyDecision}){
 if(!connection||typeof connection.query!=='function')
  return {status:'UNVERIFIED',reason:'INVALID_READ_CONNECTION',shadowDecision:'UNVERIFIED',bookingApprovalAllowed:false};
 try{
  const committedRows=await readStagingOrders(connection,serviceDate);
  return compareStagingBookingSnapshot({committedRows,serviceDate,model,candidate,legacyDecision});
 }catch(error){
  return {status:'UNVERIFIED',reason:'STAGING_READ_FAILED',
   shadowDecision:'UNVERIFIED',bookingApprovalAllowed:false};
 }
}
module.exports={compareStagingBookingReadOnly};
