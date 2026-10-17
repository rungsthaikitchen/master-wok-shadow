#!/usr/bin/env node
'use strict';
// One-shot, isolated service; no server, scheduler, persistence or DB credentials.
const fs=require('node:fs');
const {collectGoogleStagingRoutes}=require('../master-wok-google-routes');
async function run(env=process.env,{transport,clock}={}) {
 if(env.MASTER_WOK_ROUTE_TEST_ENABLED!=='true')return {status:'DISABLED',verified:false,networkRequests:0};
 if(env.RAILWAY_ENVIRONMENT_NAME!=='master-wok-staging'||env.MASTER_WOK_ROUTE_TEST_LIVE_REQUESTS!=='true')
  return {status:'UNVERIFIED',reasonCode:'STAGING_ENVIRONMENT_REQUIRED',verified:false,networkRequests:0};
 try {
  const file=env.MASTER_WOK_ROUTE_TEST_INPUT;
  if(typeof file!=='string'||!file.startsWith('/'))throw Error();
  const fd=fs.openSync(file,'r');let input;
  try {
   if(!fs.fstatSync(fd).isFile())throw Error();
   const bytes=Buffer.alloc(65537),size=fs.readSync(fd,bytes,0,bytes.length,null);
   if(size>65536)throw Error();input=JSON.parse(bytes.subarray(0,size).toString('utf8'));
  } finally {fs.closeSync(fd);}
  const result=await collectGoogleStagingRoutes(input,{enabled:true,allowLiveRequests:true,stage:'staging',
   apiKey:env.MASTER_WOK_STAGING_GOOGLE_ROUTES_KEY,maxRequests:6,transport,clock});
  // No coordinates, durations, raw provider body or secret in Railway stdout.
  return {status:result.status,verified:false,networkRequests:result.networkRequests,
   ...(result.reasonCode?{reasonCode:result.reasonCode}:{}),
   ...(result.status==='ROUTE_ESTIMATES_CAPTURED'?{directionalLegs:result.legs.length,
    durationEvidence:'PRESENT',provider:'GOOGLE_ROUTES',attribution:'Google Maps',persistence:'NONE'}:{})};
 } catch(_){return {status:'UNVERIFIED',reasonCode:'STAGING_INPUT_UNVERIFIED',verified:false,networkRequests:0};}
}
if(require.main===module)run().then(r=>{
 console.log(JSON.stringify(r));
 if(r.status==='UNVERIFIED')process.exitCode=1;
}).catch(()=>{console.log(JSON.stringify({status:'UNVERIFIED',reasonCode:'STAGING_TEST_FAILED',verified:false}));process.exitCode=1;});
module.exports={run};
