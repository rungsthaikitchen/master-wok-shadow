'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {earlyFryerConflict}=require('./staging-early-fryer-bound');
const orders=[{orderId:'candidate',placedAt:new Date('2026-11-21T00:00:00')}];
function check(mainDeadline,starterDeadline=1011,qty=3){
 return earlyFryerConflict(orders,{dependencies:[{orderId:'candidate',itemId:'veg-spring-rolls',standalone:true,readyMinute:starterDeadline,counts:{springRollBatch:qty}},
  {orderId:'candidate',itemId:'salt-chickenchips',counts:{crispyChicken:6,chips:6}}]},
  [{itemId:'salt-chickenchips',orderIds:['candidate'],latest:mainDeadline}],{fryerWarmupMinutes:5});
}
test('opening fryer bound distinguishes the tight travel deadline from a genuinely schedulable later deadline',()=>{
 assert.equal(check(1006),'FRYER_WINDOW_CAPACITY_EXCEEDED');
 assert.equal(check(1007,1012),null);
 assert.equal(check(1009,1014),null);
});
test('an upper-bound result never pretends to prove capacity or handles unsupported scope',()=>{
 assert.equal(check(1100,1105),null);assert.equal(check(1006,1011,4),null);
 assert.equal(earlyFryerConflict(orders,{dependencies:[]},[],{}),null);
});
