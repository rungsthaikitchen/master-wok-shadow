const test=require('node:test'),assert=require('node:assert/strict');
const batch=require('../fixtures/delivery-booking-authenticated-capture.json');
const {replay,validateEventBatch}=require('../master-wok-chronological-replay');
const {prepareTrialPlans}=require('../master-wok-event-delivery-trial-plan');
test('authenticated delivery capture preserves real planner estimates and missing-evidence result',()=>{
 assert.equal(validateEventBatch(batch).length,6);
 const r=replay(batch,{enabled:true});assert.equal(r.status,'REPLAYED');assert.equal(r.decisionCount,3);assert.equal(r.remainingCommitments,0);assert.equal(r.verified,false);
 if(process.env.TZ==='Europe/London')assert.deepEqual(r.observations.map(o=>o.prediction),['GREEN','UNVERIFIED','GREEN']);
 assert.equal(batch.events[2].order.deliveryReadyEstimate,null);
 assert.equal(batch.events[4].proposalEventId,'delivery-offer-3');assert.equal(batch.events[5].kind,'RESERVATION_RELEASED');
 const at=batch.events[0].order.deliveryReadyEstimate.estimatedAt;
 const plans=prepareTrialPlans(at,{enabled:true});assert.equal(plans.status,'TRIAL_PLANS_PREPARED');
 for(const e of batch.events.filter(e=>e.order?.deliveryReadyEstimate)){
  assert.deepEqual(e.order.deliveryReadyEstimate,plans.plans[e.eventId].estimate);
  assert.equal(Date.parse(e.order.deliveryReadyEstimate.arrivalAt)-Date.parse(e.order.deliveryReadyEstimate.foodReadyAt),17*60000);
 }
});
test('a later estimate cannot be backfilled into the earlier decision event',()=>{
 const changed=structuredClone(batch);
 changed.events[1].order.deliveryReadyEstimate.estimatedAt=changed.events[3].at;
 assert.throws(()=>validateEventBatch(changed),/DELIVERY_ESTIMATE_CONTRACT_REQUIRED/);
});
