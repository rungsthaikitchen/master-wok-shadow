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


test('duplicate identical lines attribute whole portions once across shared one-portion batches',()=>{
 for(const itemId of ['stir-crispy','salt-chickenchips']){
  const line=qty=>({item_id:itemId,qty,modifiers:[],spice:1});
  const items=[line(2),line(4)],key=JSON.stringify([1140,itemId,[],1,null]);
  const jobs=Array.from({length:6},(_,i)=>({itemId,orderIds:['A'],recipeKey:key,start:1120+i*2,portionAllocations:[{orderId:'A',qty:1}]}));
  const r=planFryerBeforeWok(orders,[{id:'A',items}],{status:'FEASIBLE_PROTOTYPE',jobs});assert.equal(r.status,'PREREQUISITES_PLACED_PROTOTYPE',itemId);
  const counts={};for(const job of r.jobs)for(const a of job.allocations)counts[a.type]=(counts[a.type]||0)+a.qty;
  assert.equal(counts.crispyChicken,6);if(itemId==='salt-chickenchips')assert.equal(counts.chips,6);
  assert.ok(r.jobs.every(j=>j.allocations.every(a=>a.orderId==='A'&&Number.isInteger(a.qty))));
 }
});
test('different spice recipes still cannot borrow each other’s attributed fryer batches',()=>{
 const items=[{item_id:'stir-crispy',qty:2,modifiers:[],spice:1},{item_id:'stir-crispy',qty:4,modifiers:[],spice:2}];
 const key=JSON.stringify([1140,'stir-crispy',[],1,null]);
 const jobs=Array.from({length:6},(_,i)=>({itemId:'stir-crispy',orderIds:['A'],recipeKey:key,start:1120+i*2,portionAllocations:[{orderId:'A',qty:1}]}));
 assert.equal(planFryerBeforeWok(orders,[{id:'A',items}],{status:'FEASIBLE_PROTOTYPE',jobs}).reason,'FRY_WOK_BATCH_MAPPING_UNVERIFIED');
});
