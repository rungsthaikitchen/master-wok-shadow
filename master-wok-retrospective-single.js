'use strict';
// Explicit retrospective sensitivity analysis. No HTTP, DB, checkout or persistence.
const {assessRtkDeliverySnapshot}=require('./master-wok-rtk-delivery-assessment');
const {validServiceDate}=require('./master-wok-live-shadow');
const unknown=reasonCode=>({status:'UNVERIFIED',reasonCode,verified:false});
const stamp=s=>typeof s==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(s)&&Number.isFinite(Date.parse(s));
function local(value){
 if(!stamp(value))throw Error();
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)).map(x=>[x.type,x.value]));
 return {day:`${p.year}-${p.month}-${p.day}`,minute:Number(p.hour)*60+Number(p.minute),seconds:Number(p.second),ms:new Date(value).getUTCMilliseconds()};
}
function prepareScenario(source){
 const s=structuredClone(source);
 if(!s||!validServiceDate(s.serviceDate)||s.timezone!=='Europe/London'||
    s.evidenceBasis!=='CURRENT_SAVED_STATE_NOT_DECISION_HISTORY'||!Array.isArray(s.orders)||!s.orders.length||
    s.orders.length>500||s.orderCount!==s.orders.length)throw Error();
 const fullCoverage=s.completeForServiceDate===true;
 const minimalCoverage=s.completeForServiceDate===false&&s.coverageBasis==='FIRST_SAVED_ORDER_WITH_PRIOR_COVERAGE'&&
  s.orders.length===1&&Number.isSafeInteger(s.totalSavedOrderCount)&&s.totalSavedOrderCount>=1&&s.totalSavedOrderCount<=500&&
  s.earlierSavedOrderCount===0&&s.candidateCreationTieCount===1&&/^[a-f0-9]{64}$/.test(s.sourceSnapshotHash||'');
 if(!fullCoverage&&!minimalCoverage)throw Error();
 const ids=new Set();
 for(const o of s.orders){
  if(!o||typeof o.orderId!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(o.orderId)||o.orderId==='KITCHEN'||ids.has(o.orderId)||
     !stamp(o.createdAt)||!['delivery','collection'].includes(o.orderType)||
     !['pending','confirmed','completed','cancelled','customer_declined_time'].includes(o.status))throw Error();
  ids.add(o.orderId);
 }
 s.orders.sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt)||a.orderId.localeCompare(b.orderId));
 const first=s.orders[0];
 // An empty prior plan is permitted ONLY for the unique first saved order.
 // Never skip earlier collections/cancellations based on their final saved status.
 if(first.orderType!=='delivery'||!['confirmed','completed'].includes(first.status)||
    (s.orders[1]&&Date.parse(first.createdAt)===Date.parse(s.orders[1].createdAt)))throw Error();
 if(first.proposed_time!=null&&first.confirmed_time==null)throw Error();
 for(const f of ['preferred_time','proposed_time','confirmed_time'])if(first[f]!=null&&!stamp(first[f]))throw Error();
 const target=first.confirmed_time??first.proposed_time??first.preferred_time;
 const t=local(target),placed=local(first.createdAt);
 if(t.day!==s.serviceDate||placed.day!==s.serviceDate||t.seconds||t.ms)throw Error();
 if(!Array.isArray(first.lines)||!first.lines.length||first.lines.some(l=>
    (l.invalidModifierCount!=null&&l.invalidModifierCount!==0)||
    (l.modifierShape!=null&&l.modifierShape!=='array')))throw Error();
 return {serviceDate:s.serviceDate,timezone:'Europe/London',assessedAt:first.createdAt,
  orders:[{orderId:'CANDIDATE',orderType:'delivery',targetMinute:t.minute,
   lines:first.lines.map(l=>({itemId:l.itemId,qty:l.qty,mods:structuredClone(l.mods??[])}))}],
  existingPlan:{complete:true,basis:'COMPLETE_HYPOTHETICAL_PLANS',serviceDate:s.serviceDate,
   assessedAt:first.createdAt,orders:[],driverTrips:[]},maxEstimateAgeMinutes:15};
}
function assessRetrospectiveSingle(source,journey,{enabled=false}={}){
 if(enabled!==true)return {status:'DISABLED',verified:false};
 try{
  const scenario=prepareScenario(source);
  if(!journey||!['SIMULATED_SENSITIVITY','CURRENT_ESTIMATES_APPLIED_RETROSPECTIVELY'].includes(journey.basis)||
     !Number.isFinite(journey.outboundSeconds)||!Number.isFinite(journey.returnSeconds)||
     journey.outboundSeconds<0||journey.returnSeconds<0||journey.outboundSeconds>14400||journey.returnSeconds>14400)
   return unknown('DIRECTIONAL_ESTIMATES_REQUIRED');
  if(journey.basis==='CURRENT_ESTIMATES_APPLIED_RETROSPECTIVELY'&&(!stamp(journey.capturedAt)||
     Date.parse(journey.capturedAt)<Date.parse(scenario.assessedAt)))return unknown('CAPTURE_PROVENANCE_REQUIRED');
  // The engine's internal clock is an explicitly hypothetical scenario clock.
  // Current estimates are NEVER presented as measurements made on service day.
  const legs=[{from:'KITCHEN',to:'CANDIDATE',durationSeconds:journey.outboundSeconds},
   {from:'CANDIDATE',to:'KITCHEN',durationSeconds:journey.returnSeconds}].map(l=>({...l,
    basis:'ROUTE_DURATION_ESTIMATE',estimatedAt:scenario.assessedAt}));
  const result=assessRtkDeliverySnapshot({...scenario,legs},{enabled:true});
  return {status:result.status,reasonCode:result.reasonCode,verified:false,
   evidenceBasis:'RETROSPECTIVE_CONDITIONAL_SCENARIO_NOT_DECISION_HISTORY',
   targetBasis:source.orders.find(o=>o.createdAt===scenario.assessedAt)?.confirmed_time!=null?'SAVED_CONFIRMED':'SAVED_PREFERRED',
   scenarioAssessedAt:scenario.assessedAt,journeyBasis:journey.basis,
   originalRouteCapturedAt:journey.capturedAt??null,
   clockMapping:'DURATIONS_APPLIED_TO_HYPOTHETICAL_HISTORICAL_CLOCK_NOT_BACKDATED_MEASUREMENTS',
   assumptions:['NO_EARLIER_ORDERS_IN_COMPLETE_SAVED_SNAPSHOT','NO_UNRECORDED_WORK_OR_DRIVER_COMMITMENTS',
    'SAVED_TARGET_ASSUMED_IN_FORCE_AT_PLACEMENT_NOT_ESTABLISHED','MODEL_COOKING_TIMINGS'],
   result};
 }catch(_){return unknown('RETROSPECTIVE_SOURCE_UNVERIFIED');}
}
module.exports={prepareScenario,assessRetrospectiveSingle};
