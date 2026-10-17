'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {assessStagingDeliverySource:assess}=require('./master-wok-staging-delivery-source');
const {createStagingComparison:compare}=require('./master-wok-delivery-comparison');
const {makeCases}=require('./staging-delivery/test_cases');
const source=()=>makeCases()[0].source;
test('staging source and comparison are disabled without input by default',()=>{
 assert.equal(assess(null).status,'DISABLED');assert.deepEqual(compare(null,null).records,[]);
});
test('six source scenarios exercise real RTK cooking, driver and combination policy',()=>{
 for(const c of makeCases()) {
  const r=compare(c.caseKey,c.source,{enabled:true});
  assert.equal(r.records[0].prediction,c.expectedPrediction,c.caseKey);
  assert.equal(r.records[0].planKind,c.expectedKind,c.caseKey);
  assert.ok(r.records.every(x=>x.verified===false&&x.sourceEvidence==='CURRENT_SAVED_STATE_NOT_DECISION_HISTORY'));
 }
});
test('production source, non-test rows and incomplete snapshots fail closed',()=>{
 for(const change of [s=>s.projectRef='ubyjrrsvbbqomitpaidb',s=>s.dataOrigin='GOOGLE_ROUTES',s=>s.orders[0].is_test=false,
 s=>s.complete=false,s=>s.expectedOrders++,s=>s.expectedItems++,s=>s.items.pop(),s=>s.orders.push({...s.orders[0]})]) {
  const s=source();change(s);assert.equal(assess(s,{enabled:true}).status,'UNVERIFIED');
 }
});
test('existing orders cannot be omitted from fixed kitchen/driver plan membership',()=>{
 const s=makeCases().find(c=>c.caseKey==='COLLECTION_BUSY').source;s.existingPlan.orders=[];
 assert.equal(assess(s,{enabled:true}).reasonCode,'SOURCE_PLAN_MEMBERSHIP_UNVERIFIED');
});
test('confirmed times override preferred and proposed, but invalid evidence is not substituted',()=>{
 const s=source();s.orders[1].confirmed_time='2026-10-17T18:45:00Z';
 assert.equal(assess(s,{enabled:true}).recommendation.kind,'SEPARATE');
 s.orders[1].confirmed_time='invalid';assert.equal(assess(s,{enabled:true}).status,'UNVERIFIED');
});
test('cancelled candidates and unacknowledged suggested times cannot authorize planning',()=>{
 const s=source();s.orders[0].status='cancelled';assert.equal(assess(s,{enabled:true}).status,'UNVERIFIED');
 s.orders[0].status='pending';s.orders[0].proposed_time='2026-10-17T18:10:00Z';
 assert.equal(assess(s,{enabled:true}).reasonCode,'UNACKNOWLEDGED_TIME_PROPOSAL');
});
test('service-day mismatches and future placement timestamps fail closed',()=>{
 for(const change of [s=>s.orders[0].preferred_time='2026-10-18T18:00:00Z',
 s=>s.orders[0].created_at='2026-10-17T20:00:00Z',s=>s.orders[0].preferred_time='2026-10-17T18:00:01Z']) {
  const s=source();change(s);assert.equal(assess(s,{enabled:true}).status,'UNVERIFIED');
 }
});
test('comparison keys are deterministic, build-bound and revision-sensitive',()=>{
 const s=source(),before=structuredClone(s),a=compare('CASE',s,{enabled:true}),b=compare('CASE',s,{enabled:true});
 assert.deepEqual(a.records,b.records);assert.deepEqual(s,before);
 s.orders[0].status='completed';const c=compare('CASE',s,{enabled:true});
 assert.notEqual(a.records[0].observationKey,c.records[0].observationKey);
 assert.match(a.records[0].buildHash,/^[a-f0-9]{64}$/);assert.equal(c.records[0].observedStatus,'completed');
});
test('comparison records omit locations, route durations, baskets and free text',()=>{
 const s=source();s.orders[0].address='private-location';s.orders[0].name='private-name';
 const text=JSON.stringify(compare('CASE',s,{enabled:true}).records);
 for(const bad of ['private-location','private-name','durationSeconds','panang-curry','latitude','accepted'])assert.ok(!text.includes(bad));
 assert.throws(()=>compare('CASE',{...s,dataOrigin:'REAL_DATA'},{enabled:true}),/SYNTHETIC_STAGING_REQUIRED/);
});
test('Postgres timezone formatting binds the same instant without permitting stale evidence',()=>{
 const s=source();s.assessedAt='2026-10-17T16:00:00+00:00';
 assert.equal(assess(s,{enabled:true}).status,'SHADOW_RECOMMENDATION');
 s.existingPlan.assessedAt='2026-10-17T15:59:59Z';
 assert.equal(assess(s,{enabled:true}).status,'UNVERIFIED');
});
