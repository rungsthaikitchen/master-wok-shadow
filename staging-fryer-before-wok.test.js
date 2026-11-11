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
test('standalone spring rolls have unverified fryer workload',()=>{
 const r=planFryerBeforeWok(orders,[{id:'A',items:[{item_id:'veg-spring-rolls',qty:1,modifiers:[]}]}],wok(1130));
 assert.equal(r.status,'UNVERIFIED');
 assert.equal(r.reason,'FRY_RECIPES_UNMODELLED');
 assert.equal(r.jobs.length,0);
 assert.equal(r.bookingApprovalAllowed,false);
});

test('standalone fry can use twenty-minute fallback without extending prerequisite holds',()=>{
 const basket=[{id:'A',items:[{item_id:'veg-spring-rolls',qty:1,modifiers:[]}]}];
 const options={standaloneSpringRolls:true,fryerBlackouts:[{start:1120,finish:1140}]};
 assert.equal(planFryerBeforeWok(orders,basket,wok(1130),options).status,'UNVERIFIED');
 const extended=planFryerBeforeWok(orders,basket,wok(1130),{...options,holdingLimitMinutes:20});
 assert.equal(extended.status,'PREREQUISITES_PLACED_PROTOTYPE');
 assert.equal(extended.jobs[0].finish,1120);
 assert.equal(extended.jobs[0].readyMinute-extended.jobs[0].finish,20);
 assert.equal(extended.bookingApprovalAllowed,false);
 const prerequisite=planFryerBeforeWok(orders,rows(),wok(1140),{holdingLimitMinutes:20,fryerBlackouts:[{start:1120,finish:1140}]});
 assert.equal(prerequisite.status,'UNVERIFIED');
});

