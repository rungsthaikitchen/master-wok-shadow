'use strict';
// Offline planning only: no network, source writes, booking decisions or IO.
const uncertain=reasonCode=>({status:'UNVERIFIED',reasonCode,verified:false,
 evidenceBasis:'HYPOTHETICAL_DELIVERY_PLAN_NOT_DRIVER_ACTIVITY'});
const minute=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1440;
function planDelivery(input) {
 if(!input || !['collection','delivery'].includes(input.orderType) || !minute(input.customerMinute))
  return uncertain('INVALID_DELIVERY_INPUT');
 if(input.orderType==='collection' && (input.customerMinute<990||input.customerMinute>1320))
  return uncertain('PLAN_OUTSIDE_SUPPORTED_SERVICE_WINDOW');
 if(input.orderType==='collection') return {status:'READY_FOR_KITCHEN_ASSESSMENT',
  foodReadyMinute:input.customerMinute,driverPlan:null,verified:false,
  evidenceBasis:'HYPOTHETICAL_PLAN_NOT_COOKING_ACTIVITY'};
 if(input.timeBasis!=='CUSTOMER_ARRIVAL') return uncertain('DELIVERY_TIME_MEANING_UNVERIFIED');
 const route=input.route;
 if(!route || route.basis!=='ROUTE_DURATION_ESTIMATE' ||
    !Number.isFinite(route.outboundSeconds)||route.outboundSeconds<=0||route.outboundSeconds>14400||
    !Number.isFinite(route.returnSeconds)||route.returnSeconds<=0||route.returnSeconds>14400)
  return uncertain('OUTBOUND_AND_RETURN_ESTIMATES_REQUIRED');
 // Require clock offsets for freshness checks, not bare local timestamps.
 const offset=s=>typeof s==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(s)&&Number.isFinite(Date.parse(s));
 if(!offset(input.assessedAt)||!offset(route.estimatedAt)||
    !Number.isFinite(input.maxEstimateAgeMinutes)||input.maxEstimateAgeMinutes<=0)
  return uncertain('ROUTE_FRESHNESS_UNVERIFIED');
 const age=(Date.parse(input.assessedAt)-Date.parse(route.estimatedAt))/60000;
 if(age<0 || age>input.maxEstimateAgeMinutes) return uncertain('STALE_OR_FUTURE_ROUTE_ESTIMATE');
 for(const field of ['loadingMinutes','handoverMinutes'])
  if(!Number.isFinite(input[field])||input[field]<0||input[field]>30)
   return uncertain('EXPLICIT_HANDLING_ALLOWANCES_REQUIRED');
 if(!Array.isArray(input.existingDriverPlans)) return uncertain('DRIVER_PLAN_COVERAGE_UNVERIFIED');
 if(input.driverPlanCoverage!=='COMPLETE_FOR_PLANNING_WINDOW') return uncertain('DRIVER_PLAN_COVERAGE_UNVERIFIED');
 for(const trip of input.existingDriverPlans)
  if(!trip || typeof trip.orderId!=='string'||!minute(trip.startMinute)||!minute(trip.endMinute)||trip.endMinute<=trip.startMinute)
   return uncertain('INVALID_DRIVER_PLAN');
 const departureMinute=input.customerMinute-Math.ceil(route.outboundSeconds/60);
 const foodReadyMinute=departureMinute-input.loadingMinutes;
 const returnMinute=input.customerMinute+input.handoverMinutes+Math.ceil(route.returnSeconds/60);
 if(foodReadyMinute<990 || foodReadyMinute>1320 || returnMinute>1440)
  return uncertain('PLAN_OUTSIDE_SUPPORTED_SERVICE_WINDOW');
 if(input.customerMinute-foodReadyMinute>20) return uncertain('FOOD_TO_DOOR_LIMIT_EXCEEDED');
 const conflicts=input.existingDriverPlans.filter(t=>t.startMinute<returnMinute&&t.endMinute>foodReadyMinute).map(t=>t.orderId);
 return {status:conflicts.length?'AMBER':'READY_FOR_KITCHEN_ASSESSMENT',
  reasonCode:conflicts.length?'DRIVER_PLAN_OVERLAP':'KITCHEN_ASSESSMENT_STILL_REQUIRED',
  customerArrivalMinute:input.customerMinute,foodReadyMinute,departureMinute,returnMinute,
  foodToDoorMinutes:input.customerMinute-foodReadyMinute,
  quality:input.customerMinute-foodReadyMinute<15?'PREFERRED':'ACCEPTABLE_FLAGGED',
  driverPlan:{startMinute:foodReadyMinute,endMinute:returnMinute},conflictingOrderIds:conflicts,
  verified:false,evidenceBasis:'HYPOTHETICAL_DELIVERY_PLAN_NOT_DRIVER_ACTIVITY'};
}
module.exports={planDelivery,recommendDeliveryRuns:require('./master-wok-delivery-runs').recommendDeliveryRuns};
