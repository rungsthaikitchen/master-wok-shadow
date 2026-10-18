#!/usr/bin/env node
'use strict';
// Fixed public landmarks and synthetic baskets only. No input file or DB access.
const {makeCases}=require('./test_cases');
const {runTrial}=require('./route_assessment_trial');
const points=Object.freeze({KITCHEN:{address:'Morley Town Hall, Morley, Leeds, UK'},
 A:{address:'Morley Leisure Centre, Morley, Leeds, UK'},
 B:{address:'Morley Railway Station, Morley, Leeds, UK'}});
function makeFreshTrial(now) {
 const date=new Date(now);if(!Number.isFinite(date.getTime()))throw Error('INVALID_CLOCK');
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',
  year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23',timeZoneName:'longOffset'}).formatToParts(date).map(p=>[p.type,p.value]));
 // Refuse evening/overnight runs rather than silently roll into another service.
 if(Number(parts.hour)<6||Number(parts.hour)>=16)throw Error('DAYTIME_TRIAL_REQUIRED');
 const day=`${parts.year}-${parts.month}-${parts.day}`;
 const offset=parts.timeZoneName==='GMT'?'Z':parts.timeZoneName.replace('GMT','');
 const source=makeCases()[0].source;
 source.serviceDate=day;source.assessedAt=date.toISOString();
 source.existingPlan.serviceDate=day;source.existingPlan.assessedAt=source.assessedAt;
 for(const o of source.orders){o.created_at=new Date(date.getTime()-60000).toISOString();o.preferred_time=`${day}T19:00:00${offset}`;}
 for(const leg of source.legs)leg.estimatedAt=source.assessedAt;
 return {source,points:structuredClone(points),locationBasis:'PUBLIC_LANDMARKS'};
}
async function run(env=process.env,{transport,clock=()=>new Date().toISOString()}={}) {
 if(env.MASTER_WOK_ROUTE_ASSESSMENT_ENABLED!=='true')return {status:'DISABLED',verified:false,networkRequests:0};
 if(env.RAILWAY_ENVIRONMENT_NAME!=='master-wok-staging'||
    env.MASTER_WOK_ROUTE_ASSESSMENT_LIVE_REQUESTS!=='true'||env.MASTER_WOK_ROUTE_ASSESSMENT_REQUEST_BUDGET!=='6')
  return {status:'UNVERIFIED',reasonCode:'BOUNDED_STAGING_APPROVAL_REQUIRED',verified:false,networkRequests:0};
 try {
  return await runTrial(makeFreshTrial(clock()),{enabled:true,allowLiveRequests:true,stage:'staging',
   apiKey:env.MASTER_WOK_STAGING_GOOGLE_ROUTES_KEY,transport,clock});
 } catch(_){return {status:'UNVERIFIED',reasonCode:'TRIAL_FIXTURE_UNVERIFIED',verified:false,networkRequests:0};}
}
if(require.main===module)run().then(result=>{console.log(JSON.stringify(result));
 if(result.status==='UNVERIFIED')process.exitCode=1;
}).catch(()=>{console.log(JSON.stringify({status:'UNVERIFIED',reasonCode:'TRIAL_FAILED',verified:false}));process.exitCode=1;});
module.exports={run,makeFreshTrial};
