'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {planCoordinatedKitchen}=require('./staging-coordinated-kitchen');
const {scheduleCrossOrderPanang}=require('./staging-cross-order-scheduler');
const orders=[{orderId:'A',readyMinute:1140,placedAt:new Date(2026,9,17,17,30)}];
const rows=items=>[{id:'A',items}];
const line=(item_id,qty=1)=>({item_id,qty,modifiers:[]});
test('default wok scheduler still fails closed on crispy chicken',()=>{
 const r=scheduleCrossOrderPanang(orders,rows([line('stir-crispy')]));
 assert.equal(r.status,'UNVERIFIED');
 assert.equal(r.bookingApprovalAllowed,false);
});
test('coordinated staging prototype places crispy chicken frying before wok',()=>{
 const r=planCoordinatedKitchen(orders,rows([line('stir-crispy',3)]));
 assert.equal(r.status,'COORDINATED_PROTOTYPE');
 assert.equal(r.bookingApprovalAllowed,false);
 assert.ok(r.fryer.jobs.every(f=>f.finish<=r.wok.jobs[0].start));
});
test('standalone fried starters prevent complete coordinated kitchen validation',()=>{
 const r=planCoordinatedKitchen(orders,rows([line('stir-crispy'),line('veg-spring-rolls')]));
 assert.equal(r.status,'UNVERIFIED');
 assert.equal(r.reason,'FRY_RECIPES_UNMODELLED');
 assert.equal(r.bookingApprovalAllowed,false);
});

test('holding policy prefers ten minutes and retries twenty for non-curry mains',()=>{
 const small=planCoordinatedKitchen(orders,rows([line('pad-thai',2)]));
 assert.equal(small.holdingLimitMinutes,10);
 const large=planCoordinatedKitchen(orders,rows([line('pad-thai',4)]));
 assert.equal(large.status,'COORDINATED_PROTOTYPE');
 assert.equal(large.holdingLimitMinutes,20);
 assert.ok(large.wok.jobs.some(j=>j.readyMinute-j.finish>10));
 assert.ok(large.wok.jobs.every(j=>j.readyMinute-j.finish<=20));
 assert.equal(large.bookingApprovalAllowed,false);
});

test('microwave batches use the same preferred and maximum holding policy',()=>{
 const options={confirmedStarterRecipes:true};
 const small=planCoordinatedKitchen(orders,rows([line('pork-dumplings',3)]),options);
 assert.equal(small.holdingLimitMinutes,10);
 const large=planCoordinatedKitchen(orders,rows([line('pork-dumplings',9)]),options);
 assert.equal(large.status,'COORDINATED_PROTOTYPE');
 assert.equal(large.holdingLimitMinutes,20);
 assert.equal(large.auxiliary.jobs.reduce((n,j)=>n+j.portions,0),9);
 assert.ok(large.auxiliary.jobs.some(j=>j.readyMinute-j.finish>10));
 assert.ok(large.auxiliary.jobs.every(j=>j.readyMinute-j.finish<=20));
 assert.equal(planCoordinatedKitchen(orders,rows([line('pork-dumplings',12)]),options).status,'UNVERIFIED');
});

test('customer £150 examples coordinate rings, fryer and microwave with independent coverage checks',()=>{
 const examples=require('./staging-tests/large-basket-examples');
 const {validateKitchenTimeline}=require('./staging-kitchen-launch-validator');
 const {priceBasket}=require('./master-wok-commercial');
 const orders=[{orderId:'large',readyMinute:1215,placedAt:new Date(2026,10,7,15)}];
 for(const [name,items] of Object.entries(examples)){
  assert.equal(priceBasket(items).subtotalCents,15000);
  const rows=[{id:'large',items}];
  const p=planCoordinatedKitchen(orders,rows,{sharedRings:true,confirmedStarterRecipes:true,standaloneSpringRolls:true});
  assert.equal(p.bookingApprovalAllowed,false);
  if(name==='noodles'||name==='stirFries'){
   assert.equal(p.status,'UNVERIFIED');
   assert.equal(p.wok.reason,name==='noodles'?'FIXED_RING_WORKLOAD_EXCEEDS_WINDOW':'SEARCH_LIMIT');continue;
  }
  assert.equal(p.status,'COORDINATED_PROTOTYPE',name);
  assert.equal(p.resourceModel,'FOUR_SHARED_RINGS');
  assert.equal(p.chefConcurrencyVerified,false);
  assert.equal(validateKitchenTimeline(orders,p,rows).status,'VALIDATED_STAGING_TIMELINE',name);
  assert.ok(p.wok.jobs.some(a=>p.wok.jobs.some(b=>a!==b&&a.start<b.finish&&b.start<a.finish)),name);
  const bad=structuredClone(p);bad.auxiliary.jobs=[];
  assert.ok(validateKitchenTimeline(orders,bad,rows).issues.some(i=>i.code==='AUXILIARY_COVERAGE_INVALID'));
  const missingFry=structuredClone(p);missingFry.fryer.jobs=[];
  assert.ok(validateKitchenTimeline(orders,missingFry,rows).issues.some(i=>i.code==='FRYER_COVERAGE_INVALID'));
 }
});

test('original £50, £100 and tripled £150 baskets fit with independently validated coverage',()=>{
 const {validateKitchenTimeline}=require('./staging-kitchen-launch-validator');
 const {priceBasket}=require('./master-wok-commercial');
 for(const qty of [1,2,3]){
  const items=[['pork-dumplings'],['red-curry','chicken',1],['stir-pepper','beef',1],
   ['chef-pad-thai','pork',1],['fried-rice','chicken'],['jasmine-rice'],['coconut-rice'],['chips']]
   .map(([item_id,protein,spice=0])=>({item_id,qty,modifiers:protein?[{id:protein}]:[],spice}));
  assert.equal(priceBasket(items).subtotalCents,5000*qty);
  const orders=[{orderId:'original',readyMinute:1215,placedAt:new Date(2026,10,7,15)}],rows=[{id:'original',items}];
  const p=planCoordinatedKitchen(orders,rows,{sharedRings:true,confirmedStarterRecipes:true,standaloneSpringRolls:true});
  assert.equal(p.status,'COORDINATED_PROTOTYPE');
  assert.ok([10,20].includes(p.holdingLimitMinutes));
  assert.equal(validateKitchenTimeline(orders,p,rows).status,'VALIDATED_STAGING_TIMELINE');
  assert.equal(p.bookingApprovalAllowed,false);
 }
});

