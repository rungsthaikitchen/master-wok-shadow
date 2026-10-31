'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {assessFryer}=require('./staging-fryer-capacity');
const orders=[{orderId:'a',readyMinute:1140}];
const rows=items=>[{id:'a',items}];
const line=(item_id,qty=1,modifiers=[])=>({item_id,qty,modifiers});
test('crispy chicken receives a provisional fryer timeline but no booking approval',()=>{
 const r=assessFryer(orders,rows([line('stir-crispy',2)]));
 assert.equal(r.status,'FRY_ONLY_PROTOTYPE');
 assert.equal(r.jobs.length,2);
 assert.ok(r.jobs.every(j=>j.finish<=1140&&j.start>=990));
 assert.equal(r.bookingApprovalAllowed,false);
});
test('fryer-only starters remain unverified until recipes are modelled',()=>{
 const r=assessFryer(orders,rows([line('veg-spring-rolls')]));
 assert.equal(r.status,'UNVERIFIED');
 assert.equal(r.reason,'FRY_ONLY_TIMING_UNKNOWN');
});
test('fryer timeline never claims wok dependency is satisfied',()=>{
 const r=assessFryer(orders,rows([line('stir-basil',1,[{id:'tofu'}])]));
 assert.equal(r.reason,'WOK_DEPENDENCIES_NOT_LINKED');
 assert.equal(r.bookingApprovalAllowed,false);
});
test('overloaded fryer workload fails closed',()=>{
 const r=assessFryer(orders,rows([line('stir-crispy',40)]));
 assert.equal(r.status,'UNVERIFIED');
 assert.equal(r.reason,'FRY_CAPACITY_UNVERIFIED');
});
