'use strict';
// Dated offline integration only. No database reads/writes or live booking hooks.
const {createDeliveryKitchenAssessment}=require('./master-wok-delivery-kitchen');
const {recommendDeliveryRuns}=require('./master-wok-delivery-runs');
const {validServiceDate}=require('./master-wok-live-shadow');
const unknown=reasonCode=>({status:'UNVERIFIED',reasonCode,verified:false,
 evidenceBasis:'HYPOTHETICAL_DELIVERY_PLANS_NOT_DRIVER_OR_COOKING_ACTIVITY'});
const id=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(s)&&s!=='KITCHEN';
const stamp=s=>typeof s==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(s)&&Number.isFinite(Date.parse(s));
function assessDeliverySnapshot(input,{enabled=false}={}) {
 if(enabled!==true)return {status:'DISABLED',verified:false};
 try {
  const s=structuredClone(input);
  if(!s||!validServiceDate(s.serviceDate)||s.timezone!=='Europe/London'||!stamp(s.assessedAt))
   return unknown('SERVICE_CLOCK_UNVERIFIED');
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
   timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',
   minute:'2-digit',second:'2-digit',hourCycle:'h23'
  }).formatToParts(new Date(s.assessedAt)).map(p=>[p.type,p.value]));
  const day=`${parts.year}-${parts.month}-${parts.day}`;
  if(day>s.serviceDate)return unknown('PAST_SERVICE_DATE_REFUSED');
  const clock=Number(parts.hour)*60+Number(parts.minute)+Number(parts.second)/60+
   new Date(s.assessedAt).getUTCMilliseconds()/60000;
  // Round UP: fractional decision minutes must never allow cooking in the past.
  const asOfMinute=day<s.serviceDate?990:Math.max(990,Math.ceil(clock));
  if(asOfMinute>1320)return unknown('KITCHEN_WINDOW_FINISHED');
  if(!Array.isArray(s.orders)||s.orders.length<1||s.orders.length>2)return unknown('INVALID_CANDIDATE_ORDERS');
  const candidates=new Set();
  for(const o of s.orders) {
   if(!o||!id(o.orderId)||candidates.has(o.orderId)||o.orderType!=='delivery')return unknown('INVALID_CANDIDATE_ORDERS');
   candidates.add(o.orderId);
  }
  const plan=s.existingPlan;
  if(!plan||plan.complete!==true||plan.basis!=='COMPLETE_HYPOTHETICAL_PLANS'||
     plan.serviceDate!==s.serviceDate||plan.assessedAt!==s.assessedAt||
     !Array.isArray(plan.orders)||plan.orders.length>500||!Array.isArray(plan.driverTrips)||plan.driverTrips.length>500)
   return unknown('EXISTING_PLAN_COVERAGE_UNVERIFIED');
  const existing=new Map(),fixedAllocations=[];
  for(const o of plan.orders) {
   if(!o||!id(o.orderId)||existing.has(o.orderId)||candidates.has(o.orderId)||
      !['collection','delivery'].includes(o.orderType))return unknown('INVALID_EXISTING_ORDER');
   existing.set(o.orderId,o);
   if(o.kitchenRequirement==='NONE') {
    if(o.kitchenAllocation!==null)return unknown('INVALID_EXISTING_KITCHEN_PLAN');
   } else if(o.kitchenRequirement==='REQUIRED'&&o.kitchenAllocation) {
    fixedAllocations.push({orderId:o.orderId,start:o.kitchenAllocation.start,finish:o.kitchenAllocation.finish});
   } else return unknown('INVALID_EXISTING_KITCHEN_PLAN');
   if(o.orderType==='collection'&&o.driverTripId!==null)return unknown('COLLECTION_HAS_DRIVER_TRIP');
   if(o.orderType==='delivery'&&!id(o.driverTripId))return unknown('DELIVERY_DRIVER_TRIP_REQUIRED');
  }
  const trips=new Set(),assigned=new Set(),existingDriverPlans=[];
  for(const trip of plan.driverTrips) {
   if(!trip||!id(trip.tripId)||trips.has(trip.tripId)||!Array.isArray(trip.orderIds)||
      !trip.orderIds.length||trip.orderIds.length>500)return unknown('INVALID_EXISTING_DRIVER_PLAN');
   trips.add(trip.tripId);
   for(const orderId of trip.orderIds) {
    const order=existing.get(orderId);
    if(assigned.has(orderId)||!order||order.orderType!=='delivery'||order.driverTripId!==trip.tripId)
     return unknown('DRIVER_PLAN_MEMBERSHIP_UNVERIFIED');
    assigned.add(orderId);
   }
   existingDriverPlans.push({startMinute:trip.startMinute,endMinute:trip.endMinute});
  }
  if([...existing.values()].some(o=>o.orderType==='delivery'&&!assigned.has(o.orderId)))
   return unknown('DELIVERY_DRIVER_TRIP_REQUIRED');
  // Reject contradictory pre-existing one-driver plans rather than build on them.
  existingDriverPlans.sort((a,b)=>a.startMinute-b.startMinute);
  if(existingDriverPlans.some((t,i)=>!Number.isFinite(t.startMinute)||!Number.isFinite(t.endMinute)||
     t.startMinute<0||t.endMinute>1440||t.endMinute<=t.startMinute||
     (i&&t.startMinute<existingDriverPlans[i-1].endMinute)))return unknown('INVALID_EXISTING_DRIVER_PLAN');
  const assessKitchen=createDeliveryKitchenAssessment({basis:'HYPOTHETICAL_KITCHEN_OCCUPANCY',
   complete:true,asOfMinute,fixedAllocations,orders:s.orders.map(o=>({orderId:o.orderId,lines:o.lines}))});
  const result=recommendDeliveryRuns({timeBasis:'CUSTOMER_ARRIVAL',
   orders:s.orders.map(o=>({orderId:o.orderId,targetMinute:o.targetMinute,handoverMinutes:o.handoverMinutes})),
   loadingMinutes:s.loadingMinutes,minCombinedSavingMinutes:s.minCombinedSavingMinutes,
   earliestFoodReadyMinute:asOfMinute,driverPlanCoverage:'COMPLETE_FOR_PLANNING_WINDOW',existingDriverPlans,
   assessedAt:s.assessedAt,maxEstimateAgeMinutes:s.maxEstimateAgeMinutes,legs:s.legs},{assessKitchen});
  return {...result,serviceDate:s.serviceDate,assessedAt:s.assessedAt,asOfMinute,
   snapshotBasis:'CALLER_ASSERTED_COMPLETE_HYPOTHETICAL_PLANS'};
 } catch(_){return unknown('DELIVERY_SNAPSHOT_UNVERIFIED');}
}
module.exports={assessDeliverySnapshot};
