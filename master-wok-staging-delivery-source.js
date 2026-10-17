'use strict';
// Synthetic staging rows only. No network, source writes or route lookup.
const {assessRtkDeliverySnapshot}=require('./master-wok-rtk-delivery-assessment');
const {validServiceDate}=require('./master-wok-live-shadow');
const bad=reasonCode=>({status:'UNVERIFIED',reasonCode,verified:false});
const stamp=s=>typeof s==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(s)&&Number.isFinite(Date.parse(s));
const alias=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(s);
function assessStagingDeliverySource(input,{enabled=false}={}) {
 if(enabled!==true)return {status:'DISABLED',verified:false};
 try {
  const s=structuredClone(input);
  if(!s||s.projectRef!=='hvrqgufqjslvgiohgkvu'||s.dataOrigin!=='SYNTHETIC_STAGING'||
     s.basis!=='ATOMIC_STAGING_FIXTURE_QUERY'||s.complete!==true||!validServiceDate(s.serviceDate)||
     !stamp(s.assessedAt)||!Array.isArray(s.orders)||s.orders.length>500||!Array.isArray(s.items)||s.items.length>5000||
     s.expectedOrders!==s.orders.length||s.expectedItems!==s.items.length)
   return bad('STAGING_SOURCE_COVERAGE_UNVERIFIED');
  if(!Array.isArray(s.candidateIds)||s.candidateIds.length<1||s.candidateIds.length>2||
     new Set(s.candidateIds).size!==s.candidateIds.length)return bad('INVALID_CANDIDATE_IDS');
  // Postgres JSON uses +00:00; fixture evidence may use Z. Bind the same instant
  // canonically without accepting an actually older/newer planning snapshot.
  s.assessedAt=new Date(s.assessedAt).toISOString();
  if(stamp(s.existingPlan?.assessedAt))s.existingPlan.assessedAt=new Date(s.existingPlan.assessedAt).toISOString();
  const orders=new Map(),lines=new Map(),itemIds=new Set();
  for(const row of s.orders) {
   if(!row||!alias(row.orderId)||orders.has(row.orderId)||row.is_test!==true||
      !stamp(row.created_at)||Date.parse(row.created_at)>Date.parse(s.assessedAt)||
      !['collection','delivery'].includes(row.order_type)||
      !['pending','confirmed','completed','cancelled','customer_declined'].includes(row.status))
    return bad('STAGING_ORDER_UNVERIFIED');
   orders.set(row.orderId,row);lines.set(row.orderId,[]);
  }
  for(const item of s.items) {
   if(!item||typeof item.id!=='string'||itemIds.has(item.id)||!orders.has(item.orderId)||
      typeof item.item_id!=='string'||!Number.isSafeInteger(item.qty)||item.qty<1||item.qty>100||
      !Array.isArray(item.modifiers)||item.modifiers.length>30||item.modifiers.some(m=>!m||typeof m.id!=='string'))
    return bad('STAGING_ITEMS_UNVERIFIED');
   itemIds.add(item.id);lines.get(item.orderId).push({itemId:item.item_id,qty:item.qty,mods:item.modifiers.map(m=>({id:m.id}))});
  }
  if([...lines.values()].some(l=>!l.length||l.length>100))return bad('STAGING_ITEMS_UNVERIFIED');
  const active=[...orders.values()].filter(o=>!['cancelled','customer_declined'].includes(o.status));
  // A proposed time awaiting the customer's agreement is not a firm commitment.
  if(active.some(o=>o.status==='pending'&&o.proposed_time&&!o.confirmed_time))return bad('UNACKNOWLEDGED_TIME_PROPOSAL');
  const candidates=s.candidateIds.map(orderId=>orders.get(orderId));
  if(candidates.some(o=>!o||o.order_type!=='delivery'||!active.includes(o)))return bad('CANDIDATE_ORDER_UNVERIFIED');
  const existing=active.filter(o=>!s.candidateIds.includes(o.orderId));
  if(!s.existingPlan||!Array.isArray(s.existingPlan.orders)||
     s.existingPlan.orders.length!==existing.length||existing.some(o=>
      s.existingPlan.orders.filter(p=>p.orderId===o.orderId&&p.orderType===o.order_type).length!==1))
   return bad('SOURCE_PLAN_MEMBERSHIP_UNVERIFIED');
  function target(row) {
   const value=row.confirmed_time??row.proposed_time??row.preferred_time;
   if(!stamp(value))throw Error();
   const date=new Date(value),parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
    timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'
   }).formatToParts(date).map(p=>[p.type,p.value]));
   if(`${parts.year}-${parts.month}-${parts.day}`!==s.serviceDate||Number(parts.second)!==0||date.getUTCMilliseconds()!==0)throw Error();
   return Number(parts.hour)*60+Number(parts.minute);
  }
  const result=assessRtkDeliverySnapshot({serviceDate:s.serviceDate,timezone:'Europe/London',assessedAt:s.assessedAt,
   orders:candidates.map(o=>({orderId:o.orderId,orderType:'delivery',targetMinute:target(o),lines:lines.get(o.orderId)})),
   existingPlan:s.existingPlan,legs:s.legs,maxEstimateAgeMinutes:s.maxEstimateAgeMinutes},{enabled:true});
  return {...result,sourceEvidence:'CURRENT_SAVED_STATE_NOT_DECISION_HISTORY',dataOrigin:'SYNTHETIC_STAGING'};
 } catch(_){return bad('STAGING_SOURCE_INPUT_UNVERIFIED');}
}
module.exports={assessStagingDeliverySource};
