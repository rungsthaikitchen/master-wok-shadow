'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {prepareScenario,assessRetrospectiveSingle:assess}=require('./master-wok-retrospective-single');
const source=()=>({serviceDate:'2026-10-17',timezone:'Europe/London',completeForServiceDate:true,
 evidenceBasis:'CURRENT_SAVED_STATE_NOT_DECISION_HISTORY',orderCount:1,orders:[{orderId:'first',orderType:'delivery',status:'completed',
 createdAt:'2026-10-17T15:38:48.733364+00:00',preferred_time:'2026-10-17T16:00:00Z',confirmed_time:'2026-10-17T16:15:00Z',
 proposed_time:'2026-10-17T16:15:00Z',lines:[{itemId:'panang-curry',qty:1,mods:[{id:'chicken'}]}]}]});
const journey={basis:'SIMULATED_SENSITIVITY',outboundSeconds:480,returnSeconds:540};
test('retrospective tool defaults off and preserves confirmed target and placement clock',()=>{
 assert.equal(assess(null,null).status,'DISABLED');const s=prepareScenario(source());
 assert.equal(s.orders[0].targetMinute,1035);assert.equal(s.assessedAt,'2026-10-17T15:38:48.733364+00:00');
 const r=assess(source(),journey,{enabled:true});assert.equal(r.status,'SHADOW_RECOMMENDATION');assert.equal(r.verified,false);
 assert.equal(r.result.asOfMinute,999);assert.equal(r.targetBasis,'SAVED_CONFIRMED');
});
test('earlier collection or cancelled order cannot silently disappear from plan coverage',()=>{
 for(const status of ['confirmed','cancelled']){const s=source();s.orders.push({...structuredClone(s.orders[0]),orderId:'earlier',orderType:'collection',status,createdAt:'2026-10-17T15:00:00Z'});s.orderCount++;
 assert.equal(assess(s,journey,{enabled:true}).status,'UNVERIFIED');}
});
test('missing return, partial snapshot, tied placement and unacknowledged proposal fail closed',()=>{
 assert.equal(assess(source(),{...journey,returnSeconds:null},{enabled:true}).status,'UNVERIFIED');
 for(const change of [s=>s.completeForServiceDate=false,s=>s.orderCount=2,s=>s.orders[0].confirmed_time=null,
 s=>{s.orders.push({...s.orders[0],orderId:'tie'});s.orderCount++;}]){
 const s=source();change(s);assert.equal(assess(s,journey,{enabled:true}).status,'UNVERIFIED');}
});
test('current capture timestamp is retained distinctly from the scenario clock',()=>{
 const s=source(),before=structuredClone(s),capturedAt='2026-10-18T11:15:00Z';
 const r=assess(s,{...journey,basis:'CURRENT_ESTIMATES_APPLIED_RETROSPECTIVELY',capturedAt},{enabled:true});
 assert.equal(r.originalRouteCapturedAt,capturedAt);assert.notEqual(r.scenarioAssessedAt,capturedAt);
 assert.match(r.clockMapping,/NOT_BACKDATED/);assert.deepEqual(s,before);
 assert.equal(assess(s,{...journey,basis:'CURRENT_ESTIMATES_APPLIED_RETROSPECTIVELY'},{enabled:true}).status,'UNVERIFIED');
});
test('twenty-minute limit and driver return are enforced through the real planner',()=>{
 const r=assess(source(),journey,{enabled:true});const plan=r.result.recommendation;
 assert.ok(plan.deliveries.every(d=>Math.abs(d.deviationMinutes)<=10&&d.foodToDoorMinutes<=20));
 assert.ok(plan.trips[0].endMinute>plan.deliveries[0].arrivalMinute);
 assert.equal(assess(source(),{...journey,outboundSeconds:1260},{enabled:true}).status,'UNVERIFIED');
});
