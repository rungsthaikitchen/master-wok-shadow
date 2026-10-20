const test=require('node:test'),assert=require('node:assert/strict');
const {prepareTrialPlans:prepare}=require('./master-wok-event-delivery-trial-plan');
test('fixed delivery trial plans are default off',()=>assert.equal(prepare(null).status,'DISABLED'));
test('real planner evidence resolves every prepared offer and includes asymmetric return journey',()=>{
 const r=prepare('2026-10-20T07:00:00Z',{enabled:true});assert.equal(r.status,'TRIAL_PLANS_PREPARED');assert.equal(r.evidence.length,3);assert.equal(r.networkRequests,0);
 for(const plan of Object.values(r.plans)){
  const e=r.evidence.find(e=>e.reference===plan.routeEvidenceRef);assert.ok(e);assert.equal(e.result.verified,false);
  assert.deepEqual(e.result.estimates[0].deliveryReadyEstimate,plan.estimate);
  const t=e.result.hypotheticalDriverPlan.trips[0];assert.equal(t.departureMinute-t.startMinute,2);assert.equal(t.endMinute-t.arrivals[0].arrivalMinute,10);
 }
});
