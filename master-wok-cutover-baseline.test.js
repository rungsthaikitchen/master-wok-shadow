'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {replay,validateEventBatch}=require('./master-wok-chronological-replay');
const fixture=require('./fixtures/cutover-baseline-synthetic.json');
const fresh=()=>structuredClone(fixture);
function cut(b,n){b.events=b.events.slice(0,n);b.coverage.eventCount=n;b.coverage.lastSequence=n;b.coverage.throughAt=b.events.at(-1).at;return b;}
test('cutover seeds reservations without inventing historical decisions or cooking activity',()=>{
 const input=fresh(),before=JSON.stringify(input),snapshots=[];
 const r=replay(input,{enabled:true,assess:s=>{snapshots.push(s.snapshot);return {status:'GREEN',reasonCode:'HYPOTHETICAL_REPLAY'};}});
 assert.equal(r.status,'REPLAYED');assert.equal(r.historicalDecisionCoverage,false);assert.equal(r.baselineAt,input.events[0].at);assert.equal(r.baselineCommitments,2);assert.equal(r.coverageBasis,'CUTOVER_BASELINE_AND_EVENT_LOG');
 assert.equal(r.decisionCount,2);assert.equal(r.remainingCommitments,1);assert.equal(r.observations[0].priorCommitments,2);assert.equal(r.observations[0].priorProposed,1);
 assert.equal(snapshots[1].reservations.length,2);assert.ok(snapshots[1].reservations.every(o=>o.orderId!=='synthetic-a'));
 assert.equal(JSON.stringify(input),before);assert.equal(r.verified,false);
 const baselineOnly=replay(cut(fresh(),1),{enabled:true});assert.equal(baselineOnly.decisionCount,0);assert.equal(baselineOnly.remainingCommitments,2);assert.deepEqual(baselineOnly.observations,[]);
});
test('baseline offer acceptance keeps one reservation and replacement/rejection cannot resurrect old time',()=>{
 const r=replay(cut(fresh(),3),{enabled:true,assess:()=>({status:'GREEN'})});assert.equal(r.remainingCommitments,3);
 const rejected=replay(cut(fresh(),5),{enabled:true,assess:()=>({status:'GREEN'})});assert.equal(rejected.remainingCommitments,2);
 const stale=fresh();stale.events[4].proposalEventId='opaque-pre-cutover-offer-a';assert.equal(replay(stale,{enabled:true}).reasonCode,'STALE_PROPOSAL_RESPONSE');assert.deepEqual(replay(stale,{enabled:true}).observations,[]);
});
test('cutover rejects missing coverage, duplicate/private/partial rows and invented proposal revisions',()=>{
 const variants=[];
 let b=fresh();b.coverage.complete=false;variants.push(b);
 b=fresh();b.coverage.basis='DECISION_EVENT_LOG';variants.push(b);
 b=fresh();b.events[0].kind='RESERVATION_SET';variants.push(b);
 b=fresh();b.events[0].commitments[0].proposalEventId=null;variants.push(b);
 b=fresh();b.events[0].commitments[0].order.lines=[];variants.push(b);
 b=fresh();b.events[0].commitments[0].order.email='private';variants.push(b);
 b=fresh();b.events[0].unreservedOrderIds.push('synthetic-a');variants.push(b);
 b=fresh();b.events[0].commitments.push(structuredClone(b.events[0].commitments[0]));variants.push(b);
 b=fresh();b.events[1].at=b.events[0].at;variants.push(b);
 b=fresh();b.events[1].at='2026-10-21T12:00:00.000001Z';variants.push(b); // no fabricated sub-millisecond ordering
 for(const v of variants){const r=replay(v,{enabled:true});assert.equal(r.status,'UNVERIFIED');assert.deepEqual(r.observations,[]);}
});
test('advance-service baseline remains explicit and missing delivery timing remains unverified',()=>{
 const b=fresh();b.serviceDate='2026-10-22';for(const e of b.events){if(e.order)e.order.targetAt=e.order.targetAt.replace('2026-10-21','2026-10-22');if(e.commitments)for(const row of e.commitments)row.order.targetAt=row.order.targetAt.replace('2026-10-21','2026-10-22');}
 assert.equal(validateEventBatch(b).length,7);assert.equal(replay(b,{enabled:true,assess:()=>({status:'GREEN'})}).decisionCount,2);
 b.events[0].commitments[0].order.orderType='delivery';const r=replay(b,{enabled:true});assert.equal(r.observations[0].prediction,'UNVERIFIED');assert.equal(r.observations[0].reasonCode,'DELIVERY_READY_ESTIMATE_REQUIRED');
 assert.equal(replay(b).status,'DISABLED');
});
