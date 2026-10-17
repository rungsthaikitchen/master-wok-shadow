'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {auditDeliveryEvidence:audit}=require('./master-wok-delivery-evidence-audit');
function fixture(){return {schemaVersion:1,projectRef:'ubyjrrsvbbqomitpaidb',basis:'ATOMIC_SAVED_ORDER_STATE',
 sourceRole:'supabase_read_only_user',sourceEvidence:'CURRENT_SAVED_STATE_NOT_DECISION_HISTORY',
 completeForServiceDate:true,serviceDate:'2026-10-17',observedAt:'2026-10-17T16:00:00Z',snapshotHash:'a'.repeat(64),sourceIdentity:'b'.repeat(64),
 orderCount:1,itemCount:1,orders:[{orderId:'c'.repeat(64),createdAt:'2026-10-17T12:00:00Z',status:'confirmed',orderType:'delivery',
 deliveryFeeBand:'FREE',coordinateEvidence:'PRESENT',preferred_time:'2026-10-17T18:00:00Z',proposed_time:null,confirmed_time:null,
 lines:[{itemId:'panang-curry',qty:1,mods:[{id:'chicken'}]}]}]};}
const run=s=>audit(s,{enabled:true});
test('saved delivery audit defaults off and never issues recommendations',()=>{
 assert.equal(audit(null).status,'DISABLED');const r=run(fixture());
 assert.equal(r.status,'OBSERVED');assert.equal(r.prediction,'UNVERIFIED');assert.equal(r.recommendation,null);
 assert.equal(r.deliveryOrders,1);assert.equal(r.records[0].targetMinute,1140);
 assert.deepEqual(r.records[0].reasonCodes,['DIRECTIONAL_ROUTE_DURATIONS_UNAVAILABLE','COMPLETE_KITCHEN_PLAN_UNAVAILABLE','COMPLETE_DRIVER_PLAN_UNAVAILABLE']);
});
test('free deliveries require exactly the same journey evidence as paid ones',()=>{
 const s=fixture(),free=run(s);s.orders[0].deliveryFeeBand='PAID';
 assert.deepEqual(run(s).records[0].reasonCodes,free.records[0].reasonCodes);
 s.orders[0].coordinateEvidence='MISSING_OR_INVALID';assert.ok(run(s).records[0].reasonCodes.includes('DELIVERY_LOCATION_EVIDENCE_UNAVAILABLE'));
});
test('effective target uses confirmed then proposed then preferred, without silent fallback',()=>{
 const s=fixture();s.orders[0].confirmed_time='2026-10-17T18:20:00Z';s.orders[0].proposed_time='2026-10-17T18:10:00Z';
 assert.equal(run(s).records[0].targetMinute,1160);assert.equal(run(s).records[0].targetBasis,'CONFIRMED');
 s.orders[0].confirmed_time=null;assert.equal(run(s).records[0].targetMinute,1150);
 assert.ok(run(s).records[0].reasonCodes.includes('UNACKNOWLEDGED_TIME_PROPOSAL'));
 s.orders[0].status='customer_accepted_time';assert.ok(!run(s).records[0].reasonCodes.includes('UNACKNOWLEDGED_TIME_PROPOSAL'));
 s.orders[0].confirmed_time='invalid';assert.equal(run(s).records[0].targetMinute,null);
});
test('cancellations are inactive; completed saved status never proves finished kitchen or driver activity',()=>{
 const s=fixture();s.orders[0].status='cancelled';assert.equal(run(s).deliveryOrders,0);
 assert.deepEqual(run(s).records[0].reasonCodes,['INACTIVE_SAVED_STATUS']);
 s.orders[0].status='completed';assert.equal(run(s).prediction,'UNVERIFIED');
 assert.ok(run(s).records[0].reasonCodes.includes('COMPLETE_DRIVER_PLAN_UNAVAILABLE'));
});
test('wrong-day effective targets are excluded even if preferred time matched the query day',()=>{
 const s=fixture();s.orders[0].confirmed_time='2026-10-18T18:00:00Z';
 const r=run(s);assert.equal(r.deliveryOrders,0);assert.equal(r.records[0].targetMinute,null);
 assert.ok(r.records[0].reasonCodes.includes('EFFECTIVE_TARGET_OUTSIDE_SERVICE_DATE'));
});
test('unknown types, statuses and empty baskets remain explicit uncertainty',()=>{
 const s=fixture();s.orders[0].orderType='UNKNOWN';s.orders[0].status='other';s.orders[0].lines=[];s.itemCount=0;
 const r=run(s);assert.equal(r.unknownOrderTypes,1);
 assert.deepEqual(r.records[0].reasonCodes,['UNKNOWN_SAVED_STATUS','ORDER_TYPE_UNAVAILABLE','BASKET_ITEMS_UNAVAILABLE']);
});
test('coverage, duplicate aliases, item count and invalid source metadata fail closed',()=>{
 for(const change of [s=>s.completeForServiceDate=false,s=>s.projectRef='other',s=>s.sourceRole='postgres',
  s=>s.orderCount++,s=>s.itemCount++,s=>s.orders.push({...s.orders[0]}),s=>s.orders[0].createdAt='2026-10-17T19:00:00Z',
  s=>s.orders[0].lines[0].qty=true]){
  const s=fixture();change(s);assert.equal(run(s).status,'UNVERIFIED');assert.deepEqual(run(s).records,[]);
 }
});
test('London winter and summer clocks do not depend on process timezone',()=>{
 for(const [day,stamp] of [['2026-10-17','2026-10-17T18:00:00Z'],['2026-12-17','2026-12-17T19:00:00Z']]){
  const s=fixture();s.serviceDate=day;s.observedAt=day+'T16:00:00Z';s.orders[0].createdAt=day+'T12:00:00Z';s.orders[0].preferred_time=stamp;
  assert.equal(run(s).records[0].targetMinute,1140);
 }
});
test('audit is immutable and omits baskets, coordinates, raw customer fields and fabricated plans',()=>{
 const s=fixture();s.orders[0].customerName='PRIVATE';s.orders[0].customer_lat=53.7;
 s.legs=[{durationSeconds:60}];s.existingPlan={complete:true};const before=structuredClone(s),r=run(s);
 assert.deepEqual(s,before);const text=JSON.stringify(r);
 for(const marker of ['PRIVATE','customer_lat','panang-curry','durationSeconds','existingPlan'])assert.ok(!text.includes(marker));
 assert.equal(r.recommendation,null);assert.equal(r.verified,false);
});
test('an empty saved-state day is observed but never advertised as available capacity',()=>{
 const s=fixture();s.orders=[];s.orderCount=0;s.itemCount=0;const r=run(s);
 assert.equal(r.status,'OBSERVED');assert.equal(r.deliveryOrders,0);assert.deepEqual(r.records,[]);
 assert.equal(r.prediction,'UNVERIFIED');assert.equal(r.recommendation,null);
});
