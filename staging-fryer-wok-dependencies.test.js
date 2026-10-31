'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {checkFryerWokDependencies}=require('./staging-fryer-wok-dependencies');
const wok=start=>({status:'FEASIBLE_PROTOTYPE',jobs:[{itemId:'stir-crispy',orderIds:['A'],start}]});
const fryer=finish=>({status:'FRY_ONLY_PROTOTYPE',jobs:[{orderId:'A',itemId:'stir-crispy',finish}]});
test('frying completed before wok start is not a timing violation',()=>{
 const r=checkFryerWokDependencies(wok(1130),fryer(1125));
 assert.equal(r.violations.length,0);
 assert.equal(r.bookingApprovalAllowed,false);
});
test('frying finishing after wok starts is a dependency violation',()=>{
 const r=checkFryerWokDependencies(wok(1120),fryer(1125));
 assert.equal(r.reason,'FRYER_FINISHES_AFTER_WOK_START');
 assert.equal(r.violations.length,1);
});
test('frying finishing at wok start is permitted in diagnostic',()=>{
 const r=checkFryerWokDependencies(wok(1125),fryer(1125));
 assert.equal(r.violations.length,0);
});
test('missing resource plan fails closed',()=>{
 const r=checkFryerWokDependencies(null,fryer(1125));
 assert.equal(r.status,'UNVERIFIED');
 assert.equal(r.reason,'RESOURCE_PLAN_MISSING');
});
