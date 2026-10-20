const test=require('node:test'),assert=require('node:assert/strict');
const {replay,validateEventBatch}=require('../master-wok-chronological-replay');
const batch=require('../fixtures/delivery-booking-staging-capture.json');
test('actual staging delivery booking export retains versioned estimates and replays lifecycle',()=>{
 assert.equal(validateEventBatch(batch).length,8);
 const r=replay(batch,{enabled:true});assert.equal(r.status,'REPLAYED');assert.equal(r.decisionCount,4);assert.equal(r.remainingCommitments,0);assert.equal(r.verified,false);
 assert.equal(batch.events[0].order.orderType,'delivery');assert.equal(batch.events[2].order.deliveryReadyEstimate,null);
 assert.equal(batch.events[4].proposalEventId,'delivery-offer-3');assert.equal(batch.events[7].kind,'ORDER_STATE_CHANGED');
 if(process.env.TZ==='Europe/London'){
  assert.deepEqual(r.observations.map(o=>o.prediction),['GREEN','UNVERIFIED','GREEN','UNVERIFIED']);
 }
 assert.equal(batch.events[1].order.targetAt,'2026-10-20T18:00:00.000000Z');
 assert.equal(batch.events[1].order.deliveryReadyEstimate.arrivalAt,'2026-10-20T18:10:00Z');
});
test('missing estimates remain unverified rather than scheduling cooking at arrival time',()=>{
 const s=structuredClone(batch);s.events.forEach(e=>{if(e.order)e.order.deliveryReadyEstimate=null;});
 const r=replay(s,{enabled:true});assert.equal(r.status,'REPLAYED');assert.ok(r.observations.every(o=>o.prediction==='UNVERIFIED'&&o.reasonCode==='DELIVERY_READY_ESTIMATE_REQUIRED'));
});
