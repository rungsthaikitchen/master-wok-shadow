'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {createReplayReport}=require('./master-wok-replay-report');
const fixture=require('./fixtures/chronological-synthetic-service.json');
test('report is disabled before reading input or invoking assessment',()=>{
 const source=new Proxy({},{get(){throw Error('must not read');}});
 assert.equal(createReplayReport(source,{assess(){assert.fail();}}).status,'DISABLED');
});
test('input fingerprints ignore JSON key order but detect changed recorded decisions',()=>{
 const options={enabled:true,dataOrigin:'SYNTHETIC',assess:()=>({status:'GREEN',reasonCode:'HYPOTHETICAL_REPLAY'})};
 const first=createReplayReport(fixture,options);
 const reordered=Object.fromEntries(Object.entries(fixture).reverse());
 assert.equal(first.provenance.inputSha256,createReplayReport(reordered,options).provenance.inputSha256);
 const changed=structuredClone(fixture);changed.events.find(e=>e.actualDecision==='DECLINED').actualDecision='ACCEPTED';
 assert.notEqual(first.provenance.inputSha256,createReplayReport(changed,options).provenance.inputSha256);
 assert.equal(first.provenance.assessmentMode,'CUSTOM_ASSESSOR');assert.equal(first.provenance.builtInAssessorSelected,false);
 assert.equal(first.provenance.dataOriginDeclaration,'SYNTHETIC');assert.equal(first.provenance.originIndependentlyVerified,false);
 assert.match(first.provenance.implementationSha256,/^[a-f0-9]{64}$/);
 assert.equal(first.provenance.manifest.length,7);
});
test('unclassified source stays explicit and unexpected origin is refused before assessment',()=>{
 const report=createReplayReport(fixture,{enabled:true});
 assert.equal(report.provenance.dataOriginDeclaration,'UNCLASSIFIED');
 assert.equal(report.provenance.assessmentMode,'BUILT_IN_MODEL');
 const bad=createReplayReport(fixture,{enabled:true,dataOrigin:'PRIVATE_TEXT',assess:()=>assert.fail()});
 assert.equal(bad.reasonCode,'REPORT_ORIGIN_REQUIRED');assert.equal(JSON.stringify(bad).includes('PRIVATE_TEXT'),false);
});
test('matrix counts recorded choices and excludes UNVERIFIED from assessed denominator',()=>{
 const source=structuredClone(fixture),before=structuredClone(source);let n=0;
 const report=createReplayReport(source,{enabled:true,assess:()=>({status:['GREEN','AMBER','UNVERIFIED'][n++%3],reasonCode:'HYPOTHETICAL_REPLAY'})});
 assert.equal(report.status,'REPORTED');
 const cells=Object.values(report.recordedDecisionVsHypotheticalRecommendation);
 assert.equal(cells.flatMap(Object.values).reduce((a,b)=>a+b,0),report.counts.bookingDecisions);
 assert.equal(cells.reduce((n,x)=>n+x.UNVERIFIED,0),report.counts.unverifiedDecisions);
 assert.equal(report.counts.assessedDecisions+report.counts.unverifiedDecisions,report.counts.bookingDecisions);
 assert.equal(report.comparisons.accuracy,null);assert.equal(report.verified,false);
 assert.deepEqual(source,before);
 const json=JSON.stringify(report);
 for(const e of source.events){assert.equal(json.includes(e.eventId),false);if(e.order)assert.equal(json.includes(e.order.orderId),false);}
});
test('rejects saved-state evidence and partial logs without returning partial comparison',()=>{
 for(const mutate of [x=>x.coverage.basis='CURRENT_SAVED_STATE_NOT_DECISION_HISTORY',x=>x.coverage.complete=false,x=>x.events.pop()]){
  const source=structuredClone(fixture);mutate(source);
  const report=createReplayReport(source,{enabled:true,assess:()=>assert.fail('invalid input assessed')});
  assert.equal(report.status,'UNVERIFIED');assert.equal(report.counts,undefined);
 }
});
test('cutover report never represents baseline commitments as historic booking decisions',()=>{
 const e=fixture.events.find(x=>x.order),source={serviceDate:fixture.serviceDate,
  coverage:{...fixture.coverage,basis:'CUTOVER_BASELINE_AND_EVENT_LOG',initialState:'SAVED_STATE_AT_CUTOVER',eventCount:1,lastSequence:1},
  events:[{eventId:'baseline',sequence:1,at:'2026-10-17T14:00:00Z',kind:'CUTOVER_BASELINE',basis:'CURRENT_SAVED_STATE_AT_CUTOVER',
   commitments:[{order:e.order,commitment:'CONFIRMED',proposalEventId:null}],unreservedOrderIds:[]}]};
 const r=createReplayReport(source,{enabled:true,assess:()=>assert.fail()});
 assert.equal(r.status,'REPORTED');assert.equal(r.counts.bookingDecisions,0);assert.equal(r.coverage.baselineCommitments,1);
 assert.equal(r.coverage.preBaselineDecisionHistoryAvailable,false);assert.equal(r.counts.remainingCommitments,1);
});
test('real engine report CLI is opt-in, aggregate-only and fails safely on invalid JSON',()=>{
 const run=(input,enabled)=>spawnSync(process.execPath,['master-wok-replay-report.js'],{cwd:__dirname,input,encoding:'utf8',env:{...process.env,MASTER_WOK_REPLAY_REPORT_ENABLED:enabled?'true':'false'},timeout:20000});
 assert.equal(JSON.parse(run('private invalid data',false).stdout).status,'DISABLED');
 const good=run(JSON.stringify(fixture),true);assert.equal(good.status,0,good.stderr);const r=JSON.parse(good.stdout);
 assert.equal(r.status,'REPORTED');assert.equal(r.counts.bookingDecisions,5);
 if(process.env.TZ==='UTC')assert.equal(r.reasonCounts.SERVICE_TIMEZONE_REQUIRED,4);
 else if(process.env.TZ==='Europe/London'){
  assert.deepEqual(r.recordedDecisionVsHypotheticalRecommendation,{ACCEPTED:{GREEN:2,AMBER:0,UNVERIFIED:1},DECLINED:{GREEN:1,AMBER:0,UNVERIFIED:0},SUGGESTED:{GREEN:1,AMBER:0,UNVERIFIED:0}});
  assert.equal(r.reasonCounts.DELIVERY_READY_ESTIMATE_REQUIRED,1);
 }
 const bad=run('PRIVATE_MALFORMED',true);assert.equal(bad.status,1);assert.equal(bad.stdout.includes('PRIVATE_MALFORMED'),false);
});
