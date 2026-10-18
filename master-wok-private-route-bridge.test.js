'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {run}=require('./master-wok-private-route-bridge');
const now='2026-10-18T18:00:00Z';
function input(){
 const privateJson=JSON.stringify({sourceObservedAt:now,source:{serviceDate:'2026-10-17',timezone:'Europe/London',
  evidenceBasis:'CURRENT_SAVED_STATE_NOT_DECISION_HISTORY',completeForServiceDate:false,
  coverageBasis:'FIRST_SAVED_ORDER_WITH_PRIOR_COVERAGE',orderCount:1,totalSavedOrderCount:3,
  earlierSavedOrderCount:0,candidateCreationTieCount:1,sourceSnapshotHash:'a'.repeat(64),
  orders:[{orderId:'fixture',orderType:'delivery',status:'completed',createdAt:'2026-10-17T15:45:00Z',
   preferred_time:'2026-10-17T16:00:00Z',proposed_time:'2026-10-17T16:30:00Z',confirmed_time:'2026-10-17T16:30:00Z',
   lines:[{itemId:'panang-curry',qty:1,mods:[{id:'chicken'}]}]}]},
  points:{KITCHEN:{lat:51.5,lng:-0.12},CANDIDATE:{lat:51.51,lng:-0.13}}});
 return {privateJson,bindingHash:crypto.createHash('sha256').update(privateJson).digest('hex'),sourceIdentity:'b'.repeat(64),mode:'PREPARE'};
}
const options={enabled:true,clock:()=>now};
test('bridge defaults off and preflights without provider calls',async()=>{
 assert.equal((await run(null)).status,'DISABLED');
 const r=await run(input(),{...options,transport:()=>assert.fail('network')});
 assert.equal(r.status,'PREPARED');assert.match(r.candidate.buildHash,/^[a-f0-9]{64}$/);
 assert.equal(r.candidate.serviceDate,'2026-10-17');
});
test('two directed simulated calls produce aggregate only and enforce binding',async()=>{
 const i=input(),p=await run(i,options);i.mode='CAPTURE';i.candidate=p.candidate;
 let calls=0;const transport=async()=>{calls++;return {status:200,data:{routes:[{duration:'480s'}]}};};
 const config={...options,allowLiveRequests:true,stage:'staging',apiKey:'synthetic',transport};
 const r=await run(i,config);
 assert.equal(calls,2);assert.equal(r.status,'CAPTURED');assert.equal(r.envelope.result.status,'SHADOW_RECOMMENDATION');
 assert.equal(r.envelope.result.networkRequests,2);assert.equal(r.envelope.result.verified,false);
 for(const word of ['privateJson','durationSeconds','latitude','panang-curry','fixture'])assert.ok(!JSON.stringify(r).includes(word));
 calls=0;i.candidate.sourceHash='f'.repeat(64);assert.equal((await run(i,config)).status,'UNVERIFIED');assert.equal(calls,0);
});
test('tampering stale source and live gate refusal happen before provider calls',async()=>{
 const i=input();i.privateJson+=' ';assert.equal((await run(i,options)).status,'UNVERIFIED');
 assert.equal((await run(input(),{...options,clock:()=> '2026-10-18T18:04:00Z'})).status,'UNVERIFIED');
 const j=input();j.candidate=(await run(j,options)).candidate;j.mode='CAPTURE';
 assert.equal((await run(j,{...options,transport:()=>assert.fail('network')})).status,'UNVERIFIED');
});
test('provider failure does not retry and exposes no private error detail',async()=>{
 const i=input();i.candidate=(await run(i,options)).candidate;i.mode='CAPTURE';let calls=0;
 const r=await run(i,{...options,allowLiveRequests:true,stage:'staging',apiKey:'synthetic',
  transport:async()=>{calls++;throw Error('PRIVATE_ADDRESS');}});
 assert.equal(calls,1);assert.equal(r.status,'UNVERIFIED');assert.ok(!JSON.stringify(r).includes('PRIVATE_ADDRESS'));
});
