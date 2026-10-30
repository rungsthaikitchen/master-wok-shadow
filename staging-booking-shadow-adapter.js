'use strict';
// Offline, read-only shadow comparison adapter. No DB calls, booking writes or approvals.
const {planCoordinatedKitchen}=require('./staging-coordinated-kitchen');
const {validateKitchenTimeline}=require('./staging-kitchen-launch-validator');
function compareBookingShadow({orders,rows,candidate,legacyDecision}){
 const blocked=(reason,extra={})=>({status:'UNVERIFIED',reason,
  shadowDecision:'UNVERIFIED',legacyDecision:legacyDecision??null,
  bookingApprovalAllowed:false,...extra});
 if(!Array.isArray(orders)||!Array.isArray(rows)||!candidate||
    !candidate.order||!candidate.row)return blocked('INVALID_SHADOW_INPUT');
 const o=candidate.order,r=candidate.row,id=String(o.orderId||'');
 if(!id||String(r.id)!==id||orders.some(x=>String(x.orderId)===id)||
    rows.some(x=>String(x.id)===id)||!Number.isInteger(o.readyMinute)||
    !(o.placedAt instanceof Date)||!Number.isFinite(o.placedAt.getTime())||
    !Array.isArray(r.items)||!r.items.length)return blocked('INVALID_CANDIDATE');
 const combinedOrders=[...orders,o],combinedRows=[...rows,r];
 if(combinedOrders.length!==combinedRows.length||
    combinedOrders.some(x=>!combinedRows.some(y=>String(y.id)===String(x.orderId))))
  return blocked('INCOMPLETE_COMMITTED_SNAPSHOT');
 const plan=planCoordinatedKitchen(combinedOrders,combinedRows);
 const validation=validateKitchenTimeline(combinedOrders,plan);
 const validated=plan.status==='COORDINATED_PROTOTYPE'&&
   validation.status==='VALIDATED_STAGING_TIMELINE';
 return {status:validated?'VALIDATED_SHADOW_PROTOTYPE':'UNVERIFIED',
  reason:validated?'STAGING_ONLY_NOT_BOOKING_APPROVAL':plan.reason,
  shadowDecision:validated?'PROTOTYPE_FITS':'UNVERIFIED',
  legacyDecision:legacyDecision??null,
  candidateOrderId:id,committedOrders:orders.length,
  checkedOrders:combinedOrders.length,planStatus:plan.status,
  validationStatus:validation.status,validationIssues:validation.issues,
  // Diagnostic only: distinguish impossible windows, search limits and fryer blockers.
  planFailureReason:validated?null:(plan.wok?.reason||plan.fryer?.reason||plan.reason),
  curryHoldPolicy:validated?plan.curryHoldPolicy:null,
  bookingApprovalAllowed:false};
}
module.exports={compareBookingShadow};
