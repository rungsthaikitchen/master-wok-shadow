#!/usr/bin/env node
'use strict';
// One approved customer, two directed requests. Input stays private/in memory.
const {prepareScenario,assessRetrospectiveSingle}=require('../master-wok-retrospective-single');
const {collectGoogleStagingRoutes}=require('../master-wok-google-routes');
const failure=(reasonCode,networkRequests=0)=>({status:'UNVERIFIED',reasonCode,networkRequests,verified:false});
async function run(env=process.env,{transport,clock=()=>new Date().toISOString()}={}){
 if(env.MASTER_WOK_SINGLE_DELIVERY_ENABLED!=='true')return {status:'DISABLED',verified:false,networkRequests:0};
 if(env.RAILWAY_ENVIRONMENT_NAME!=='master-wok-staging'||
    env.RAILWAY_PROJECT_ID!=='7821ad5b-f5c2-4ab4-9206-c3d76eefd4c8'||
    env.RAILWAY_ENVIRONMENT_ID!=='c1b8fad6-dbfc-4188-b4b5-a5dbfbf53279'||
    env.RAILWAY_SERVICE_NAME!=='master-wok-single-delivery-trial'||env.MASTER_WOK_SINGLE_DELIVERY_LIVE_REQUESTS!=='true'||
    env.MASTER_WOK_SINGLE_DELIVERY_REQUEST_BUDGET!=='2'||
    env.MASTER_WOK_SINGLE_DELIVERY_SCOPE!=='ONE_CUSTOMER_TWO_ROUTES_MEMORY_ONLY')return failure('EXPLICIT_STAGING_SCOPE_REQUIRED');
 let requests=0;
 try{
  const text=env.MASTER_WOK_SINGLE_DELIVERY_PRIVATE_INPUT;
  if(typeof text!=='string'||Buffer.byteLength(text)>500000)return failure('PRIVATE_INPUT_UNVERIFIED');
  const input=JSON.parse(text);
  if(input.source?.orders?.length!==1)return failure('SINGLE_ORDER_PRIVATE_INPUT_REQUIRED');
  const scenario=prepareScenario(input.source);
  // Reject malformed menus or infeasible best-case kitchen inputs before quota.
  const preflight=assessRetrospectiveSingle(input.source,{basis:'SIMULATED_SENSITIVITY',outboundSeconds:0,returnSeconds:0},{enabled:true});
  if(preflight.status!=='SHADOW_RECOMMENDATION')return failure('PRE_PROVIDER_PREFLIGHT_UNVERIFIED');
  const captured=await collectGoogleStagingRoutes({orders:[{orderId:'CANDIDATE',orderType:'delivery'}],points:input.points},
   {enabled:true,allowLiveRequests:true,stage:'staging',maxRequests:2,
    apiKey:env.MASTER_WOK_STAGING_GOOGLE_ROUTES_KEY,transport,clock});
  requests=captured.networkRequests;
  if(captured.status!=='ROUTE_ESTIMATES_CAPTURED')return failure(captured.reasonCode,requests);
  const outbound=captured.legs.find(l=>l.from==='KITCHEN'&&l.to==='CANDIDATE');
  const back=captured.legs.find(l=>l.from==='CANDIDATE'&&l.to==='KITCHEN');
  const result=assessRetrospectiveSingle(input.source,{basis:'CURRENT_ESTIMATES_APPLIED_RETROSPECTIVELY',
   capturedAt:captured.assessedAt,outboundSeconds:outbound.durationSeconds,returnSeconds:back.durationSeconds},{enabled:true});
  // No coordinates, durations, baskets, aliases, detailed plan or raw body in logs.
  return {status:result.status,reasonCode:result.reasonCode,networkRequests:requests,verified:false,
   evidenceBasis:result.evidenceBasis,journeyBasis:result.journeyBasis,clockMapping:result.clockMapping,
   serviceDate:scenario.serviceDate,persistence:'NONE',provider:'GOOGLE_ROUTES',attribution:'Google Maps'};
 }catch(_){return failure('SINGLE_DELIVERY_TRIAL_FAILED',requests);}
}
if(require.main===module)run().then(r=>{console.log(JSON.stringify(r));if(r.status==='UNVERIFIED')process.exitCode=1;})
 .catch(()=>{console.log(JSON.stringify(failure('SINGLE_DELIVERY_TRIAL_FAILED')));process.exitCode=1;});
module.exports={run};
