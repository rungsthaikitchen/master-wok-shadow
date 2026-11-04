'use strict';
// Read-only conversion of the staging SQL snapshot to the website shadow shape.
// The staging reader returns `items`; the website adapter expects `order_items`.
const {compareWebsiteShadow}=require('./staging-website-shadow-bridge');
function toWebsiteShape(row){
 if(!row||!Array.isArray(row.items))throw Error('INCOMPLETE_STAGING_SNAPSHOT');
 return {...row,order_items:row.items};
}
function compareStagingSnapshot({committedRows,candidateRow,legacyDecision=null}={}){
 const blocked=reason=>({status:'UNVERIFIED',reason,legacyDecision,
   bookingApprovalAllowed:false,legacyAvailabilityUnchanged:true});
 try{
  if(!Array.isArray(committedRows))return blocked('INVALID_STAGING_SNAPSHOT');
  const converted=committedRows.map(toWebsiteShape);
  return compareWebsiteShadow({committedRows:converted,
    candidateRow:toWebsiteShape(candidateRow),legacyDecision});
 }catch(error){return blocked(error.message);}
}
module.exports={compareStagingSnapshot,toWebsiteShape};
