'use strict';
// Read-only website snapshot bridge; never changes booking decisions.
const {compareBookingShadow}=require('./staging-booking-shadow-adapter');
const {londonPlacement}=require('./staging-booking-integration');
const ACTIVE=new Set(['confirmed','accepted','preparing','ready','completed']);
function normalize(row){
 if(!row||!row.id||!row.created_at||!Array.isArray(row.order_items)||!row.order_items.length)throw Error('INCOMPLETE_WEBSITE_ORDER');
 const ready=row.confirmed_time||row.proposed_time||row.preferred_time;
 if(!ready||!Number.isFinite(Date.parse(ready)))throw Error('INVALID_READY_TIME');
 const d=londonPlacement(ready);
 const items=row.order_items.map(x=>{
  if(typeof x?.item_id!=='string'||!Number.isInteger(x.qty)||x.qty<=0||!Array.isArray(x.modifiers))throw Error('MISSING_DISH_DETAIL');
  return {item_id:x.item_id,qty:x.qty,modifiers:x.modifiers};
 });
 return {order:{orderId:String(row.id),placedAt:londonPlacement(row.created_at),readyMinute:d.getHours()*60+d.getMinutes()},row:{id:String(row.id),items}};
}
function compareWebsiteShadow({committedRows,candidateRow,legacyDecision=null}={}){
 const blocked=reason=>({status:'UNVERIFIED',reason,legacyDecision,bookingApprovalAllowed:false,legacyAvailabilityUnchanged:true});
 try{
  if(!Array.isArray(committedRows))return blocked('INVALID_WEBSITE_SNAPSHOT');
  const active=committedRows.filter(x=>x&&ACTIVE.has(String(x.status).toLowerCase())).map(normalize);
  const candidate=normalize(candidateRow);
  const result=compareBookingShadow({orders:active.map(x=>x.order),rows:active.map(x=>x.row),candidate,legacyDecision});
  return {...result,bookingApprovalAllowed:false,legacyAvailabilityUnchanged:true};
 }catch(error){return blocked(error.message);}
}
module.exports={compareWebsiteShadow,normalize};
