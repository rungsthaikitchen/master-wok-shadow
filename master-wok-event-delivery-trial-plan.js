'use strict';
// Fixed synthetic routes; real planner calculations. No provider or production IO.
const {deriveDeliveryEventEstimates}=require('./master-wok-event-delivery-projection');
function prepareTrialPlans(assessedAt,{enabled=false}={}){
 if(enabled!==true)return {status:'DISABLED',verified:false,networkRequests:0};
 const serviceDate='2026-10-20',orderId='synthetic-delivery-trial';
 const lines=[{itemId:'panang-curry',qty:1,mods:[{id:'chicken'}]}],plans={},evidence=[];
 for(const [eventId,targetAt,kind] of [['delivery-create','2026-10-20T17:00:00Z','RESERVATION_SET'],['delivery-offer-1','2026-10-20T18:00:00Z','BOOKING_DECISION'],['delivery-offer-3','2026-10-20T19:00:00Z','BOOKING_DECISION']]){
  const event={eventId,sequence:1,at:assessedAt,kind,order:{orderId,orderType:'delivery',targetAt,lines:structuredClone(lines),deliveryReadyEstimate:null},...(kind==='RESERVATION_SET'?{commitment:'PROPOSED'}:{actualDecision:'SUGGESTED'})};
  const targetMinute=(Number(targetAt.slice(11,13))+1)*60; // This fixed October service is BST.
  const snapshot={serviceDate,timezone:'Europe/London',assessedAt,orders:[{orderId,orderType:'delivery',targetMinute,lines:structuredClone(lines)}],
   existingPlan:{complete:true,basis:'COMPLETE_HYPOTHETICAL_PLANS',serviceDate,assessedAt,orders:[],driverTrips:[]},maxEstimateAgeMinutes:15,
   legs:[{from:'KITCHEN',to:orderId,durationSeconds:300,basis:'ROUTE_DURATION_ESTIMATE',estimatedAt:assessedAt},{from:orderId,to:'KITCHEN',durationSeconds:480,basis:'ROUTE_DURATION_ESTIMATE',estimatedAt:assessedAt}]};
  const result=deriveDeliveryEventEstimates({serviceDate,events:[event],snapshot},{enabled:true});
  if(result.status!=='ESTIMATES_PREPARED')throw Error('FIXED_DELIVERY_PLAN_UNVERIFIED');
  const ref='synthetic-'+eventId+'-routes';
  plans[eventId]={basis:'PREPARED_HYPOTHETICAL_DELIVERY_PLAN',eventId,orderId,targetAt,lines:structuredClone(lines),routeEvidenceRef:ref,estimate:result.estimates[0].deliveryReadyEstimate};
  evidence.push({reference:ref,basis:'SYNTHETIC_ROUTE_FIXTURE_WITH_REAL_PLANNER',snapshot,result});
 }
 return {status:'TRIAL_PLANS_PREPARED',plans,evidence,verified:false,networkRequests:0};
}
module.exports={prepareTrialPlans};
if(require.main===module){
 try{
  if(process.env.MASTER_WOK_DELIVERY_PLAN_TRIAL_ENABLED!=='true')process.stdout.write(JSON.stringify(prepareTrialPlans(null)));
  else{
   const fs=require('node:fs'),input=fs.readFileSync(0,'utf8');if(Buffer.byteLength(input)>4096)throw Error();
   process.stdout.write(JSON.stringify(prepareTrialPlans(JSON.parse(input).assessedAt,{enabled:true})));
  }
 }catch(_){process.stdout.write(JSON.stringify({status:'UNVERIFIED',verified:false,reasonCode:'FIXED_DELIVERY_PLAN_FAILED'}));process.exitCode=1;}
}
