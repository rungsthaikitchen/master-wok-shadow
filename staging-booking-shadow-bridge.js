'use strict';
// Read-only integration bridge for rows returned by the existing staging reader.
// Caller supplies the candidate and the legacy decision; no database access here.
const {normalizeStagingOrders}=require('./staging-order-snapshot');
const {londonPlacement}=require('./staging-booking-integration');
const {compareBookingShadow}=require('./staging-booking-shadow-adapter');
function compareStagingBookingSnapshot({committedRows,serviceDate,model,candidate,legacyDecision}){
 const unverified=reason=>({status:'UNVERIFIED',reason,shadowDecision:'UNVERIFIED',
   bookingApprovalAllowed:false});
 try{
  if(!Array.isArray(committedRows)||!model||!candidate||
     !candidate.order||!candidate.row)return unverified('INVALID_SNAPSHOT_INPUT');
  const orders=normalizeStagingOrders({rows:committedRows,model,serviceDate})
    .map(o=>({...o,placedAt:londonPlacement(o.placedAt)}));
  const rows=committedRows.map(r=>({id:r.id,items:r.items}));
  const order={...candidate.order,placedAt:londonPlacement(candidate.order.placedAt)};
  return compareBookingShadow({orders,rows,candidate:{order,row:candidate.row},legacyDecision});
 }catch(error){
  return unverified('SNAPSHOT_NORMALIZATION_FAILED');
 }
}
module.exports={compareStagingBookingSnapshot};
