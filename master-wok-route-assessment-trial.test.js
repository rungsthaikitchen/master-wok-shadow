'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {runTrial}=require('./staging-delivery/route_assessment_trial');
const {makeCases}=require('./staging-delivery/test_cases');
const input=()=>({source:makeCases()[0].source,locationBasis:'PUBLIC_LANDMARKS',
 points:{KITCHEN:{address:'Public landmark kitchen'},A:{address:'Public landmark A'},B:{address:'Public landmark B'}}});
const options=()=>({enabled:true,allowLiveRequests:true,stage:'staging',apiKey:'test-only',
 clock:()=> '2026-10-17T16:00:00Z',transport:async()=>({status:200,data:{routes:[{duration:'180s'}]}})});
test('trial defaults off and refuses production without requests',async()=>{
 assert.equal((await runTrial(input())).status,'DISABLED');
 let calls=0;const r=await runTrial(input(),{...options(),stage:'production',transport:()=>calls++});
 assert.equal(r.networkRequests,0);assert.equal(calls,0);
});
test('six directed estimates reach actual kitchen and driver assessment without leaking routes',async()=>{
 let calls=0;const opts=options();const transport=opts.transport;
 const r=await runTrial(input(),{...opts,transport:async x=>{calls++;return transport(x);}});
 assert.equal(calls,6);assert.equal(r.status,'SHADOW_RECOMMENDATION');
 assert.equal(r.comparisonRecords,2);assert.equal(r.persistence,'NONE');assert.equal(r.verified,false);
 const text=JSON.stringify(r);for(const secret of ['Public landmark','durationSeconds','test-only','sourceHash','recommendation'])assert.equal(text.includes(secret),false);
});
test('bad source fails before billable requests',async()=>{
 for(const mutate of [s=>s.source.orders[0].is_test=false,s=>s.source.expectedItems=999,
  s=>s.source.existingPlan.complete=false,s=>s.source.candidateIds=['A']]){
 const s=input();mutate(s);let calls=0;
 const r=await runTrial(s,{...options(),transport:()=>calls++});assert.equal(calls,0);assert.equal(r.status,'UNVERIFIED');
 }
});
test('partial provider failure does not assess or expose partial matrix',async()=>{
 let calls=0;const r=await runTrial(input(),{...options(),transport:async()=>{
 calls++;return calls===3?{status:500}:{status:200,data:{routes:[{duration:'180s'}]}};
 }});assert.equal(r.networkRequests,3);assert.equal(r.status,'UNVERIFIED');assert.equal(r.comparisonRecords,undefined);
});
test('old fixture cannot spend a fresh route budget',async()=>{
 let calls=0;const r=await runTrial(input(),{...options(),clock:()=> '2026-10-18T16:00:00Z',transport:()=>calls++});
 assert.equal(calls,0);assert.equal(r.reasonCode,'FRESH_TRIAL_SOURCE_REQUIRED');
});
