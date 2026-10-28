'use strict';
// Offline aggregate only: replay validates the event contract before assessment.
// Recorded booking choices are not labels for kitchen feasibility or accuracy.
const {replay}=require('./master-wok-chronological-replay');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':
 value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);
function provenance(input,options){
 const files=['master-wok-replay-report.js','master-wok-chronological-replay.js','master-wok-server-adapter.js',
  'master-wok-live-shadow.js','master-wok-model-bundle.js','master-wok.js','master-wok-shadow.js'];
 const manifest=files.map(file=>({file,sha256:sha(fs.readFileSync(path.join(__dirname,file)))}));
 return {inputSha256:sha(canonical(input)),implementationSha256:sha(canonical(manifest)),manifest,
  assessmentMode:options.assess?'CUSTOM_ASSESSOR':'BUILT_IN_MODEL',
  builtInAssessorSelected:!options.assess,
  dataOriginDeclaration:options.dataOrigin||'UNCLASSIFIED',originIndependentlyVerified:false,
  runtime:{node:process.versions.node,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone}};
}
function createReplayReport(input,options={}){
 if(options.enabled!==true)return {status:'DISABLED',verified:false,networkRequests:0};
 if(![undefined,'UNCLASSIFIED','SYNTHETIC','RECORDED_EVENT_EXPORT'].includes(options.dataOrigin))
  return {status:'UNVERIFIED',reasonCode:'REPORT_ORIGIN_REQUIRED',verified:false,networkRequests:0};
 const result=replay(input,options);
 if(result.status!=='REPLAYED')return {status:'UNVERIFIED',reasonCode:result.reasonCode,verified:false,networkRequests:0};
 let identity;
 try{identity=provenance(input,options);}
 catch(_){return {status:'UNVERIFIED',reasonCode:'REPORT_PROVENANCE_UNAVAILABLE',verified:false,networkRequests:0};}
 const matrix=Object.fromEntries(['ACCEPTED','DECLINED','SUGGESTED'].map(d=>[d,{GREEN:0,AMBER:0,UNVERIFIED:0}]));
 const reasons={};let proposed=0;
 for(const observation of result.observations){
  matrix[observation.actualDecision][observation.prediction]++;
  reasons[observation.reasonCode]=(reasons[observation.reasonCode]||0)+1;
  if(observation.priorProposed>0)proposed++;
 }
 const assessed=result.observations.filter(x=>x.prediction!=='UNVERIFIED').length;
 return {status:'REPORTED',schemaVersion:2,verified:false,networkRequests:0,provenance:identity,
  serviceDate:result.serviceDate,evidenceBasis:result.evidenceBasis,
  coverage:{basis:result.coverageBasis||'DECISION_EVENT_LOG',throughAt:result.coverageThroughAt,
   baselineAt:result.baselineAt||null,baselineCommitments:result.baselineCommitments??0,
   preBaselineDecisionHistoryAvailable:result.historicalDecisionCoverage===false?false:null,
   independentlyVerified:false},
  counts:{bookingDecisions:result.decisionCount,assessedDecisions:assessed,
   unverifiedDecisions:result.decisionCount-assessed,decisionsWithPriorProposals:proposed,
   remainingCommitments:result.remainingCommitments},
  recordedDecisionVsHypotheticalRecommendation:matrix,reasonCounts:reasons,
  comparisons:{currentEngineRecommendation:'NOT_CAPTURED',actualKitchenOutcome:'NOT_CAPTURED',
   actualDeliveryOutcome:'NOT_CAPTURED',accuracy:null},
  limitations:['EVENT_COVERAGE_IS_INPUT_DECLARATION','BOOKING_DECISION_IS_NOT_ENGINE_RECOMMENDATION',
   'HYPOTHETICAL_PLAN_IS_NOT_CONFIRMED_KITCHEN_ACTIVITY','NO_OUTCOME_ACCURACY_CLAIM']};
}
module.exports={createReplayReport};
if(require.main===module){
 if(process.env.MASTER_WOK_REPLAY_REPORT_ENABLED!=='true')process.stdout.write(JSON.stringify(createReplayReport(null)));
 else{
  let data='',size=0,oversize=false;
  process.stdin.on('data',chunk=>{size+=chunk.length;if(size>5000000){oversize=true;data='';}else if(!oversize)data+=chunk;});
  process.stdin.on('end',()=>{
   let result;
   try{if(oversize)throw Error();result=createReplayReport(JSON.parse(data),{enabled:true,dataOrigin:process.env.MASTER_WOK_REPLAY_REPORT_DATA_ORIGIN});}
   catch(_){result={status:'UNVERIFIED',reasonCode:'REPORT_INPUT_REFUSED',verified:false,networkRequests:0};}
   process.stdout.write(JSON.stringify(result));if(result.status!=='REPORTED')process.exitCode=1;
  });
 }
}
