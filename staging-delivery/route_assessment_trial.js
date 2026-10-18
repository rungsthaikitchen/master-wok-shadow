'use strict';
// One-shot composition boundary. No database, filesystem writes or scheduler.
const {collectGoogleStagingRoutes}=require('../master-wok-google-routes');
const {createStagingComparison}=require('../master-wok-delivery-comparison');
async function runTrial(input,{enabled=false,allowLiveRequests=false,stage,apiKey,transport,clock}={}) {
 const fail=(reasonCode,networkRequests=0)=>({status:'UNVERIFIED',reasonCode,verified:false,networkRequests});
 if(enabled!==true)return {status:'DISABLED',verified:false,networkRequests:0};
 if(stage!=='staging'||allowLiveRequests!==true)return fail('STAGING_ROUTE_ACCESS_NOT_ENABLED');
 try {
  const s=structuredClone(input);
  const now=(clock||(()=>new Date().toISOString()))();
  const age=Date.parse(now)-Date.parse(s?.source?.assessedAt);
  if(!Number.isFinite(age)||age<0||age>15*60000)return fail('FRESH_TRIAL_SOURCE_REQUIRED');
  // This first trial accepts only the reviewed two-candidate synthetic contract.
  // An empty plan is hypothetical fixture evidence, never real driver availability.
  if(s?.source?.dataOrigin!=='SYNTHETIC_STAGING'||s.source.projectRef!=='hvrqgufqjslvgiohgkvu'||
     s.source.candidateIds?.join(',')!=='A,B'||s.source.orders?.length!==2||
     s.source.existingPlan?.orders?.length!==0||s.source.existingPlan?.driverTrips?.length!==0||
     s.source.existingPlan?.basis!=='COMPLETE_HYPOTHETICAL_PLANS'||s.source.expectedOrders!==2||
     s.source.orders.some(o=>o.is_test!==true)||s.locationBasis!=='PUBLIC_LANDMARKS')
   return fail('SYNTHETIC_TRIAL_REQUIRED');
  // Validate source contract using explicitly synthetic legs before spending quota.
  const preflight=createStagingComparison('ROUTE_TRIAL',s.source,{enabled:true});
  if(preflight.status!=='SHADOW_RECOMMENDATION')return fail('TRIAL_PREFLIGHT_UNVERIFIED');
  const captured=await collectGoogleStagingRoutes({orders:[{orderId:'A',orderType:'delivery'},
   {orderId:'B',orderType:'delivery'}],points:s.points},{enabled:true,allowLiveRequests:true,
   stage,apiKey,maxRequests:6,transport,clock});
  if(captured.status!=='ROUTE_ESTIMATES_CAPTURED')return fail(captured.reasonCode,captured.networkRequests);
  // Bind plan and assessment to capture time; reject a different service day below.
  const source={...s.source,assessedAt:captured.assessedAt,legs:captured.legs,
   existingPlan:{...s.source.existingPlan,assessedAt:captured.assessedAt}};
  const compared=createStagingComparison('ROUTE_TRIAL',source,{enabled:true});
  // Provider-derived timing, hashes and route choices remain in memory only.
  return {status:compared.status,reasonCode:compared.reasonCode,verified:false,
   networkRequests:captured.networkRequests,directionalLegs:captured.legs.length,
   comparisonRecords:compared.records.length,persistence:'NONE',
   evidenceBasis:'SYNTHETIC_HYPOTHETICAL_PLANS',provider:'GOOGLE_ROUTES',attribution:'Google Maps'};
 } catch(_){return fail('TRIAL_INPUT_UNVERIFIED');}
}
module.exports={runTrial};
