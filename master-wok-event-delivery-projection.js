'use strict';
// Offline preparation only: no event persistence, booking decision or actual activity.
const {isDeepStrictEqual}=require('node:util');
const {assessRtkDeliverySnapshot}=require('./master-wok-rtk-delivery-assessment');
const {validateEventBatch}=require('./master-wok-chronological-replay');
const unknown=reasonCode=>({status:'UNVERIFIED',reasonCode,verified:false,networkRequests:0});
function checked(events,serviceDate){
 return validateEventBatch({serviceDate,events:events.map((e,i)=>({...e,sequence:i+1})),coverage:{basis:'DECISION_EVENT_LOG',complete:true,eventCount:events.length,firstSequence:1,lastSequence:events.length,initialState:'NO_PRIOR_SERVICE_COMMITMENTS',throughAt:events.at(-1).at}});
}
function londonMinute(at){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(at)).map(p=>[p.type,p.value]));
 if(Number(parts.second)!==0||Date.parse(at)%60000!==0)throw Error();
 return Number(parts.hour)*60+Number(parts.minute);
}
function deriveDeliveryEventEstimates(input,{enabled=false}={}){
 if(enabled!==true)return {status:'DISABLED',verified:false,networkRequests:0};
 try{
  const {serviceDate,events,snapshot}=structuredClone(input);
  if(!Array.isArray(events)||events.length<1||events.length>2||!snapshot||snapshot.serviceDate!==serviceDate||snapshot.timezone!=='Europe/London')return unknown('DELIVERY_EVENT_BINDING_REQUIRED');
  checked(events,serviceDate);
  if(!Array.isArray(snapshot.orders)||snapshot.orders.length!==events.length)return unknown('DELIVERY_EVENT_BINDING_REQUIRED');
  const ids=new Set();
  for(const e of events){
   if(!['BOOKING_DECISION','RESERVATION_SET'].includes(e.kind)||e.order.orderType!=='delivery'||e.order.deliveryReadyEstimate!==null||e.at!==snapshot.assessedAt||ids.has(e.order.orderId))return unknown('DELIVERY_EVENT_BINDING_REQUIRED');
   ids.add(e.order.orderId);
   const matches=snapshot.orders.filter(o=>o.orderId===e.order.orderId);
   if(matches.length!==1||matches[0].orderType!=='delivery'||matches[0].targetMinute!==londonMinute(e.order.targetAt)||!isDeepStrictEqual(matches[0].lines,e.order.lines))return unknown('DELIVERY_EVENT_BINDING_REQUIRED');
  }
  if(!Number.isFinite(snapshot.maxEstimateAgeMinutes)||snapshot.maxEstimateAgeMinutes<=0||snapshot.maxEstimateAgeMinutes>30)return unknown('DELIVERY_ROUTE_FRESHNESS_REQUIRED');
  const assessment=assessRtkDeliverySnapshot(snapshot,{enabled:true});
  if(assessment.status!=='SHADOW_RECOMMENDATION')return unknown('DELIVERY_PLAN_UNVERIFIED');
  const plan=assessment.recommendation;
  const estimates=events.map(e=>{
   const rows=plan.deliveries.filter(d=>d.orderId===e.order.orderId);
   if(rows.length!==1)throw Error();
   const d=rows[0],target=londonMinute(e.order.targetAt);
   const at=minute=>new Date(Date.parse(e.order.targetAt)+(minute-target)*60000).toISOString();
   return {eventId:e.eventId,orderId:e.order.orderId,deliveryReadyEstimate:{foodReadyAt:at(d.foodReadyMinute),arrivalAt:at(d.arrivalMinute),estimatedAt:e.at,basis:'DELIVERY_PLANNER_ESTIMATE'}};
  });
  // Validate against the real replay contract; the source events remain untouched.
  checked(events.map((e,i)=>({...e,order:{...e.order,deliveryReadyEstimate:estimates[i].deliveryReadyEstimate}})),serviceDate);
  return {status:'ESTIMATES_PREPARED',verified:false,networkRequests:0,evidenceBasis:'HYPOTHETICAL_DELIVERY_PLANS_NOT_DRIVER_OR_COOKING_ACTIVITY',policyId:assessment.policyId,estimates,
   hypotheticalDriverPlan:{kind:plan.kind,trips:structuredClone(plan.trips)}};
 }catch(_){return unknown('DELIVERY_EVENT_PROJECTION_UNVERIFIED');}
}
module.exports={deriveDeliveryEventEstimates};
