'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {planFryerBeforeWok}=require('./staging-fryer-before-wok');
const orders=[{orderId:'A',readyMinute:1140,placedAt:new Date(2026,9,17,17,30)}];
const rows=(qty=1)=>[{id:'A',items:[{item_id:'stir-crispy',qty,modifiers:[]}]}];
const wok=start=>({status:'FEASIBLE_PROTOTYPE',jobs:[{itemId:'stir-crispy',orderIds:['A'],start}]});
test('three crispy chicken portions fry before their wok starts',()=>{
 const r=planFryerBeforeWok(orders,rows(3),wok(1130));
 assert.equal(r.status,'PREREQUISITES_PLACED_PROTOTYPE');
 assert.equal(r.jobs.length,1);
 assert.equal(r.jobs[0].portions,3);
 assert.ok(r.jobs[0].finish<=1130);
 assert.equal(r.bookingApprovalAllowed,false);
});
test('fryer prerequisites before kitchen production window fail closed',()=>{
 const r=planFryerBeforeWok(orders,rows(),wok(993));
 assert.equal(r.status,'UNVERIFIED');
 assert.equal(r.reason,'FRY_BEFORE_WOK_CAPACITY_UNVERIFIED');
});
test('ambiguous mapping to multiple wok batches fails closed',()=>{
 const r=planFryerBeforeWok(orders,rows(),{status:'FEASIBLE_PROTOTYPE',jobs:[
  {itemId:'stir-crispy',orderIds:['A'],start:1120},
  {itemId:'stir-crispy',orderIds:['A'],start:1130}
 ]});
 assert.equal(r.reason,'FRY_WOK_BATCH_MAPPING_UNVERIFIED');
});
test('unknown fried starters fail closed',()=>{
 const r=planFryerBeforeWok(orders,[{id:'A',items:[{item_id:'veg-spring-rolls',qty:1,modifiers:[]}]}],wok(1130));
 assert.equal(r.reason,'FRY_RECIPES_UNMODELLED');
});
