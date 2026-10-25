const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const crypto=require('node:crypto');
const {prepareCheckout,PROJECT}=require('./checkout-production-field-adapter.cjs');
const shapes=require('../fixtures/checkout-source-shapes-25-oct.json');
const columns=require('../fixtures/checkout-column-contract-25-oct.json');
const ORDER='8269cd25-5959-5263-bba7-1dd2c25df88c',REQUEST='24e52bf5-67a6-55fd-a243-d3099eb05577',CUSTOMER='7629f38e-9e24-5478-8413-e0848ef04cd3';
function sample(page='index.html',overrides={}){
 const context={customerId:CUSTOMER,submitTotals:{subtotal:24,delivery_fee:0,delivery_straight_line_miles:null,delivery_route_miles:null,delivery_distance_source:null,total:20,loyalty_discount:3,loyalty_points_redeem_pending:30,loyalty_points_earned_pending:20,loyalty_reward_applied:true,loyalty_expected_balance:100},totalDiscount:4,disc:{discount:1},appliedDiscountCode:null,appliedDiscountAmount:0,orderType:'collection',notes:'Synthetic private kitchen note',orderRef:'SYNTHETIC-1',payment_preference:'cash',preferredTimeISO:'2026-10-26T18:30:00Z',asapRequested:false,communicationPreference:'sms',idempotencyKey:REQUEST,orderId:ORDER,item_id:'green-curry',kitchenLoad:1,line:{name:'Synthetic menu display name',unitPrice:12,qty:2,mods:[{id:'chicken',name:'Synthetic modifier display name',delta:0}],spice:2,img:'/synthetic/private-image.png'},...overrides};
 context.finalPreferredTimeISO=context.finalPreferredTimeISO??context.preferredTimeISO;
 const shape=shapes.pages[page];
 for(const kind of ['order','items'])assert.equal(crypto.createHash('sha256').update(shape[kind].expression).digest('hex'),shape[kind].sha256);
 const order=JSON.parse(JSON.stringify(vm.runInNewContext('('+shape.order.expression+')',context))),item=JSON.parse(JSON.stringify(vm.runInNewContext('('+shape.items.expression+')',context)));
 return {enabled:true,project:PROJECT,sourcePage:page,orderId:ORDER,orderAlias:'synthetic-full-checkout',order,items:[item]};
}
test('disabled mapping reads neither private inputs nor a transport',()=>{
 const options={get order(){throw Error('private input accessed');}};assert.equal(prepareCheckout(options).sourceRequests,0);
});
test('all three actual source shapes are schema-compatible and retained exactly',()=>{
 for(const page of Object.keys(shapes.pages)){
  const input=sample(page),before=structuredClone(input),result=prepareCheckout(input);
  assert.deepEqual(result.privateWrite,{order:before.order,items:before.items});assert.equal(result.binding.requestId,REQUEST);
  assert.equal(result.evidenceBasis,'CHECKOUT_MAPPING_NOT_PERSISTENCE_OR_DECISION_HISTORY');assert.equal(result.verified,false);assert.equal(result.sourceRequests,0);
  for(const key of Object.keys(input.order))assert.ok(columns.tables.orders[key]);
  for(const key of Object.keys(input.items[0]))assert.ok(columns.tables.order_items[key]);
 }
});
test('current duplicate discount_label assignment is reproduced, not silently corrected',()=>{
 const input=sample();assert.equal(shapes.pages['index.html'].order.keys.filter(k=>k==='discount_label').length,2);
 assert.equal(input.order.discount,4);assert.equal(input.order.loyalty_discount,3);assert.equal(input.order.discount_label,null);
 const result=prepareCheckout(input);assert.equal(result.privateWrite.order.discount_label,null);assert.ok(result.diagnostics.includes('DISCOUNT_LABEL_ABSENT'));
});
test('coupon and loyalty fields retain their distinct current meanings without recalculation',()=>{
 const input=sample('index.html',{appliedDiscountCode:'SYNTHETIC',appliedDiscountAmount:2});input.order.total=18;
 const result=prepareCheckout(input);assert.deepEqual(result.privateWrite.order,input.order);assert.equal(result.privateWrite.order.discount_amount,2);assert.equal(result.privateWrite.order.loyalty_discount,3);
 assert.ok(result.diagnostics.includes('STORED_TOTAL_DIFFERS_FROM_SUBTOTAL_MINUS_DISCOUNT_PLUS_FEE'));
});
test('private values cannot leak into the engine allowlist, including optional item notes',()=>{
 const input=sample();input.items[0].item_note='Synthetic private item note';const r=prepareCheckout(input),exported=JSON.stringify(r.engineProjection);
 for(const value of [CUSTOMER,ORDER,REQUEST,input.order.notes,input.order.order_ref,input.items[0].name,input.items[0].img,input.items[0].item_note,'unit_price','discount','payment_preference','communication_preference','kitchen_load','spice'])assert.equal(exported.includes(value),false);
 assert.equal(r.privateWrite.items[0].item_note,input.items[0].item_note);assert.equal(r.engineProjection.orderId,'synthetic-full-checkout');assert.deepEqual(r.engineProjection.lines,[{itemId:'green-curry',qty:2,mods:[{id:'chicken'}]}]);
});
test('legacy absent fields stay absent; explicit nulls stay null and snapshots are isolated',()=>{
 const input=sample('index_inline_ordering_refactor.html');const r=prepareCheckout(input);
 assert.equal(Object.hasOwn(r.privateWrite.order,'discount_code'),false);assert.equal(Object.hasOwn(r.privateWrite.items[0],'kitchen_load'),false);assert.equal(r.privateWrite.items[0].spice,2);
 input.items[0].modifiers[0].id='beef';input.order.notes='changed later';assert.equal(r.privateWrite.items[0].modifiers[0].id,'chicken');assert.notEqual(r.privateWrite.order.notes,input.order.notes);
 const main=sample();main.items[0].spice=null;assert.equal(prepareCheckout(main).privateWrite.items[0].spice,null);
});
test('delivery arrival target and distance do not become invented travel or food-ready times',()=>{
 const input=sample();Object.assign(input.order,{order_type:'delivery',delivery_fee:0,delivery_route_miles:0,delivery_straight_line_miles:null,delivery_distance_source:'synthetic-route',preferred_time:'2026-10-25T19:00:00+00:00'});
 const r=prepareCheckout(input);assert.equal(r.engineProjection.targetAt,input.order.preferred_time);assert.equal(r.engineProjection.deliveryReadyEstimate,null);assert.equal(r.privateWrite.order.delivery_route_miles,0);assert.ok(r.diagnostics.includes('DELIVERY_READY_ESTIMATE_MISSING'));
});
test('ASAP or missing target preserves private request but refuses a speculative engine target',()=>{
 for(const change of [o=>o.asap_requested=true,o=>o.preferred_time=null,o=>o.preferred_time='2026-02-30T19:00:00Z']){
  const input=sample();change(input.order);const r=prepareCheckout(input);assert.deepEqual(r.privateWrite.order,input.order);assert.equal(r.engineProjection,null);assert.ok(r.diagnostics.includes('REQUEST_TARGET_UNVERIFIED'));
 }
});
test('unknown fields, cross-order items, malformed values and production configuration are refused safely',()=>{
 for(const change of [x=>x.order.secret='sensitive',x=>x.items[0].order_id=CUSTOMER,x=>x.items[0].qty=0,x=>x.order.subtotal=NaN,x=>x.order.subtotal='24.00',x=>x.items[0].modifiers[0].token='sensitive',x=>x.project='ubyjrrsvbbqomitpaidb',x=>delete x.order.notes]){
  const input=sample();change(input);assert.throws(()=>prepareCheckout(input),/^Error: CHECKOUT_FIELD_MAPPING_REFUSED$/);
 }
});
test('extra monetary precision is retained for review without rounding or silently rejecting the booking',()=>{
 for(const change of [x=>x.order.discount_amount=0.123,x=>x.items[0].unit_price=12.001,x=>x.items[0].modifiers[0].delta=0.001]){
  const input=sample();change(input);const r=prepareCheckout(input);assert.deepEqual(r.privateWrite,{order:input.order,items:input.items});assert.ok(r.diagnostics.includes('MONETARY_PRECISION_UNVERIFIED'));
 }
});
