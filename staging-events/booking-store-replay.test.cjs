const test=require('node:test');
const assert=require('node:assert/strict');
const batch=require('../fixtures/booking-store-staging-capture.json');
const {replay,validateEventBatch}=require('../master-wok-chronological-replay.js');

test('actual staging transaction capture replays complete basket and offer lifecycle',()=>{
 assert.equal(validateEventBatch(batch).length,8);
 assert.equal(batch.events[0].order.lines.length,2);
 const result=replay(batch,{enabled:true});
 assert.equal(result.status,'REPLAYED');
 assert.equal(result.decisionCount,4);
 assert.equal(result.remainingCommitments,0);
 assert.equal(result.verified,false);
 assert.equal(result.networkRequests,0);
 if(process.env.TZ==='Europe/London') assert.ok(result.observations.every(x=>x.prediction==='GREEN'));
 else assert.ok(result.observations.every(x=>x.reasonCode==='SERVICE_TIMEZONE_REQUIRED'));
 assert.ok(result.observations.every(x=>x.verified===false));
 assert.equal(batch.events[2].order.targetAt,'2026-10-20T18:00:00.000000Z');
 assert.equal(batch.events[3].proposalEventId,'offer-1');
 assert.equal(batch.events[5].response,'REJECTED');
 assert.equal(batch.events[7].reason,'CANCELLED');
});
test('changing the captured offer identity cannot silently confirm another offer',()=>{
 const changed=structuredClone(batch);
 changed.events[3].proposalEventId='not-current';
 assert.throws(()=>validateEventBatch(changed));
 assert.equal(replay(changed,{enabled:true}).status,'UNVERIFIED');
});
