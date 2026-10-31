'use strict';
// Staging-only historical replay. No writes, no booking approval, no customer details in output.
// Usage: node staging-historical-replay-runner.js 2026-10-17
const {readStagingOrders}=require('./staging-order-reader');
const {replay}=require('./staging-readonly-replay');
async function main(){
 const serviceDate=process.argv[2];
 const includeTestOrders=process.argv[3]==='--include-test-orders';
 if(process.argv.length>4 || (process.argv[3] && !includeTestOrders))throw Error('INVALID_REPLAY_OPTION');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate||''))throw Error('SERVICE_DATE_REQUIRED_YYYY_MM_DD');
 if(process.env.CONFIRM_STAGING_ONLY!=='YES')throw Error('STAGING_CONFIRMATION_REQUIRED');
 const raw=process.env.STAGING_DATABASE_URL;
 if(!raw)throw Error('STAGING_DATABASE_URL_REQUIRED');
 const url=new URL(raw);
 const host=url.hostname.toLowerCase(),user=decodeURIComponent(url.username);
 const ref='hvrqgufqjslvgiohgkvu';
 const direct=host==='db.'+ref+'.supabase.co'&&user==='postgres';
 const pooler=/^aws-[0-9]+-[a-z0-9-]+[.]pooler[.]supabase[.]com$/.test(host)&&user==='postgres.'+ref;
 if(!direct&&!pooler)throw Error('NOT_VERIFIED_STAGING_DATABASE_HOST_OR_USER','INVALID_REPLAY_OPTION');
 const {Client}=require('pg');
 const client=new Client({connectionString:raw,connectionTimeoutMillis:10000});
 try{
  await client.connect();
  await client.query('BEGIN READ ONLY');
  let rows;
  try{
   rows=await readStagingOrders(client,serviceDate,{includeTestOrders});
  }finally{
   await client.query('ROLLBACK');
  }
  if(rows.length===0){
   process.stdout.write(JSON.stringify({serviceDate,includeTestOrders,ordersFetched:0,status:'NO_STAGING_DATA',bookingApprovalAllowed:false})+'\n');
   return;
  }
  const result=replay({serviceDate,orders:rows});
  const summary={
   serviceDate,includeTestOrders,ordersFetched:rows.length,committed:result.committed,
   scheduled:result.scheduled,noWokReservation:result.noWokReservation,excluded:result.excluded,
   feasible:result.feasible,rawFeasible:result.rawFeasible,baselineReason:result.reason,\n   baselineJobsByReadyMinute:result.jobsByReadyMinute,\n   crossOrderPrototype:{status:result.crossOrderPrototype?.status||'NOT_REPORTED',reason:result.crossOrderPrototype?.reason||null,productionBatches:result.crossOrderPrototype?.productionBatches??null,searchMethod:result.crossOrderPrototype?.searchMethod||null,capacityDiagnostic:result.crossOrderPrototype?.capacityDiagnostic||null,deadlinePressure:(result.crossOrderPrototype?.deadlinePressure||[]).map(p=>({readyMinute:p.readyMinute,batches:p.batches,cookingMinutes:p.cookingMinutes,minimumMinutesIncludingResets:p.minimumMinutesIncludingResets,earliestBatchStart:p.earliestBatchStart,latestBatchFinish:p.latestBatchFinish}))},
   historicalShadow:{tested:result.historicalShadow.tested,validated:result.historicalShadow.validated,unverified:result.historicalShadow.unverified},
   websiteBridgeReplay:{tested:result.websiteBridgeReplay.tested,validated:result.websiteBridgeReplay.validated,unverified:result.websiteBridgeReplay.unverified},
   fryerStatus:result.fryerDiagnostic?.status||'NOT_REPORTED',
   bookingApprovalAllowed:false,legacyDecisionAvailable:false
  };
  process.stdout.write(JSON.stringify(summary,null,2)+'\n');
 }finally{await client.end();}
}
main().catch(error=>{
 // Avoid printing connection strings, SQL or customer data from lower-level errors.
 const safe=new Set(['SERVICE_DATE_REQUIRED_YYYY_MM_DD','STAGING_CONFIRMATION_REQUIRED','STAGING_DATABASE_URL_REQUIRED','NOT_VERIFIED_STAGING_DATABASE_HOST_OR_USER']);
 process.stderr.write('STAGING_HISTORICAL_REPLAY_UNVERIFIED: '+(safe.has(error.message)?error.message:'REPLAY_OR_DATABASE_ERROR')+'\n');
 process.exitCode=1;
});
