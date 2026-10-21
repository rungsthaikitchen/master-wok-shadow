'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fixture=require('../fixtures/cross-date-authenticated-capture.json');
const {compareTransferBundle}=require('../master-wok-transfer-bundle');
test('authenticated paired export retains one provisional reservation after acceptance, return move and completion',()=>{
 const r=compareTransferBundle(fixture,{enabled:true});
 assert.equal(r.status,'COMPARED');assert.equal(r.transferCount,3);
 assert.equal(fixture.streams.reduce((n,s)=>n+s.batch.events.length,0),10);
 assert.deepEqual(r.results.map(s=>[s.result.serviceDate,s.result.remainingCommitments]),[['2026-10-21',1],['2026-10-22',0]]);
 assert.equal(r.results.reduce((n,s)=>n+s.result.decisionCount,0),3);
 assert.ok(r.results.every(s=>s.result.observations.every(o=>o.actualDecision==='SUGGESTED'&&o.verified===false)));
 // The opt-in server replay now handles explicit zero Rung workload.
 assert.ok(r.results.every(s=>s.result.observations.every(o=>o.prediction===(Intl.DateTimeFormat().resolvedOptions().timeZone==='Europe/London'?'GREEN':'UNVERIFIED'))));
});
test('separate offline curry sensitivity confirms the authenticated fixture limitation is not a failed transfer pairing',()=>{
 const prior=process.env.TZ;process.env.TZ='Europe/London';
 try{
  const b=structuredClone(fixture);
  for(const s of b.streams)for(const e of s.batch.events)if(e.order)e.order.lines=[{itemId:'panang-curry',qty:1,mods:[{id:'chicken'}]}];
  const r=compareTransferBundle(b,{enabled:true});assert.equal(r.status,'COMPARED');
  assert.ok(r.results.every(s=>s.result.observations.every(o=>o.prediction==='GREEN'&&o.verified===false)));
 }finally{if(prior===undefined)delete process.env.TZ;else process.env.TZ=prior;}
});
