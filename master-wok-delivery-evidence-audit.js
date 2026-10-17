'use strict';
// Saved-state readiness only. No route requests, plan creation or booking decision.
const {validServiceDate}=require('./master-wok-live-shadow');
const PROJECTS=new Set(['hvrqgufqjslvgiohgkvu','ubyjrrsvbbqomitpaidb']);
const statuses=new Set(['pending','confirmed','accepted','proposed','customer_accepted_time','customer_declined_time','preparing','completed','cancelled']);
const stamp=s=>typeof s==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(s)&&Number.isFinite(Date.parse(s));
const hex=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const safeId=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(s);
function localTarget(value,day){
 if(!stamp(value))return {minute:null,reason:'INVALID_TARGET_TIMESTAMP'};
 const date=new Date(value),p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
  timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'
 }).formatToParts(date).map(x=>[x.type,x.value]));
 if(`${p.year}-${p.month}-${p.day}`!==day)return {minute:null,reason:'EFFECTIVE_TARGET_OUTSIDE_SERVICE_DATE'};
 if(Number(p.second)!==0||date.getUTCMilliseconds()!==0)return {minute:null,reason:'TARGET_NOT_MINUTE_ALIGNED'};
 return {minute:Number(p.hour)*60+Number(p.minute),reason:null};
}
function auditDeliveryEvidence(input,{enabled=false}={}){
 if(enabled!==true)return {status:'DISABLED',verified:false};
 const bad=reasonCode=>({status:'UNVERIFIED',reasonCode,verified:false,recommendation:null,records:[]});
 try{
  const s=structuredClone(input);
  if(!s||s.schemaVersion!==1||!PROJECTS.has(s.projectRef)||s.basis!=='ATOMIC_SAVED_ORDER_STATE'||
    s.sourceRole!=='supabase_read_only_user'||s.sourceEvidence!=='CURRENT_SAVED_STATE_NOT_DECISION_HISTORY'||
    s.completeForServiceDate!==true||!validServiceDate(s.serviceDate)||!stamp(s.observedAt)||
    !hex(s.snapshotHash)||!hex(s.sourceIdentity)||!Array.isArray(s.orders)||s.orders.length>500||s.orderCount!==s.orders.length||
    !Number.isSafeInteger(s.itemCount)||s.itemCount<0||s.itemCount>5000)return bad('SOURCE_COVERAGE_UNVERIFIED');
  const seen=new Set(),records=[];
  let items=0;
  for(const o of s.orders){
   if(!o||!hex(o.orderId)||seen.has(o.orderId)||!stamp(o.createdAt)||Date.parse(o.createdAt)>Date.parse(s.observedAt)||
     !['delivery','collection','UNKNOWN'].includes(o.orderType)||!['FREE','PAID','UNKNOWN'].includes(o.deliveryFeeBand)||
     !['PRESENT','MISSING_OR_INVALID'].includes(o.coordinateEvidence)||!Array.isArray(o.lines)||o.lines.length>100||
     o.lines.some(l=>!l||!safeId(l.itemId)||!Number.isSafeInteger(l.qty)||l.qty<1||l.qty>100||!Array.isArray(l.mods)||
       l.mods.length>30||l.mods.some(m=>!m||!safeId(m.id))))return bad('SOURCE_ORDER_UNVERIFIED');
   seen.add(o.orderId);items+=o.lines.length;
   // UNKNOWN saved statuses are retained as uncertainty rather than silently dropped.
   const status=statuses.has(o.status)?o.status:'UNKNOWN';
   const cancelled=['cancelled','customer_declined_time'].includes(status);
   let targetBasis=o.confirmed_time!=null?'CONFIRMED':o.proposed_time!=null?'PROPOSED':'PREFERRED';
   const target=localTarget(o.confirmed_time??o.proposed_time??o.preferred_time,s.serviceDate);
   const reasons=[];
   if(cancelled)reasons.push('INACTIVE_SAVED_STATUS');
   if(status==='UNKNOWN')reasons.push('UNKNOWN_SAVED_STATUS');
   if(o.orderType==='UNKNOWN')reasons.push('ORDER_TYPE_UNAVAILABLE');
   if(target.reason)reasons.push(target.reason);
   if(!o.lines.length)reasons.push('BASKET_ITEMS_UNAVAILABLE');
   if(!cancelled&&o.proposed_time!=null&&o.confirmed_time==null&&status!=='customer_accepted_time')
    reasons.push('UNACKNOWLEDGED_TIME_PROPOSAL');
   const inScope=!cancelled&&!target.reason;
   if(inScope&&o.orderType==='delivery'){
    if(o.coordinateEvidence!=='PRESENT')reasons.push('DELIVERY_LOCATION_EVIDENCE_UNAVAILABLE');
    reasons.push('DIRECTIONAL_ROUTE_DURATIONS_UNAVAILABLE','COMPLETE_KITCHEN_PLAN_UNAVAILABLE','COMPLETE_DRIVER_PLAN_UNAVAILABLE');
   }
   records.push({orderId:o.orderId,observedStatus:status,orderType:o.orderType,
    targetBasis,targetMinute:target.minute,deliveryFeeBand:o.deliveryFeeBand,
    coordinateEvidence:o.coordinateEvidence,inServiceDate:!target.reason,
    prediction:'UNVERIFIED',reasonCodes:reasons,verified:false});
  }
  if(items!==s.itemCount)return bad('SOURCE_ITEM_COUNT_MISMATCH');
  return {status:'OBSERVED',assessmentScope:'SAVED_STATE_EVIDENCE_AUDIT_ONLY',
   sourceEvidence:s.sourceEvidence,serviceDate:s.serviceDate,observedAt:s.observedAt,
   snapshotHash:s.snapshotHash,sourceIdentity:s.sourceIdentity,
   prediction:'UNVERIFIED',recommendation:null,verified:false,
   deliveryOrders:records.filter(r=>r.orderType==='delivery'&&r.inServiceDate&&!r.reasonCodes.includes('INACTIVE_SAVED_STATUS')).length,
   unknownOrderTypes:records.filter(r=>r.orderType==='UNKNOWN').length,records};
 }catch{return bad('SOURCE_INPUT_UNVERIFIED');}
}
module.exports={auditDeliveryEvidence};
