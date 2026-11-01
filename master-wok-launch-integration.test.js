'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
require('./master-wok-model-bundle');
const {assessCombinedBooking}=require('./master-wok-combined-assessment');
const {prepareStagingBasket}=require('./staging-canonical-basket');
const {relativePlacement}=require('./master-wok-atomic-checkout');
const {reserveWithMasterWok}=require('./master-wok-transaction-writer');
const {scheduleCrossOrderPanang}=require('./staging-cross-order-scheduler');
const model=globalThis.MasterWokModelV1;
function context(items=[{item_id:'stir-crispy',qty:1,modifiers:[]}]){
 const serviceDate='2026-10-30',now='2026-10-30T17:00:00Z';
 const p=prepareStagingBasket({id:'new',createdAt:now,serviceDate,readyMinute:1140,items,model});
 assert.equal(p.status,'PREPARED');
 return {acceptedOrders:[],rawRows:[],serviceDate,
  proposedOrder:{...p.candidate,placedAt:relativePlacement(now,serviceDate),rawRow:p.rawRow,
   validatedHeader:{preferred_time:'2026-10-30T19:00:00Z'}},
  state:{now,availability:{blackouts:[],serviceState:{mode:'normal',capacity_throttle:0}}}};
}
test('actual basket has joint work coverage and whole-basket lead time but no booking authority',()=>{
 const r=assessCombinedBooking(context());
 assert.equal(r.status,'VALIDATED_COMBINED_ASSESSMENT');
 assert.equal(r.bookingApprovalAllowed,false);
 assert.ok(r.leadTime.earliestCandidateWork<r.plan.wok.jobs[0].start);
});
test('spring roll opt-in schedules seven minutes and verifies standalone coverage',()=>{
 const r=assessCombinedBooking(context([{item_id:'veg-spring-rolls',qty:1,modifiers:[]}]),{standaloneSpringRolls:true});
 assert.equal(r.status,'VALIDATED_COMBINED_ASSESSMENT');
 assert.equal(r.plan.fryer.jobs[0].finish-r.plan.fryer.jobs[0].start,7);
 assert.equal(r.bookingApprovalAllowed,false);
});
test('unknown frying and independent starter recipes fail closed',()=>{
 assert.equal(assessCombinedBooking(context([{item_id:'fish-cakes',qty:1,modifiers:[]}])).status,'UNVERIFIED');
 assert.equal(assessCombinedBooking(context([{item_id:'chicken-satay',qty:1,modifiers:[]}])).status,'UNVERIFIED');
});
test('ready-time blackouts have exclusive end boundaries',()=>{
 const c=context();c.state.availability.blackouts=[{active:true,kind:'fully_booked',start_at:'2026-10-30T18:55:00Z',end_at:'2026-10-30T19:00:00Z'}];
 assert.equal(assessCombinedBooking(c).status,'VALIDATED_COMBINED_ASSESSMENT');
 c.state.availability.blackouts[0].end_at='2026-10-30T19:05:00Z';
 assert.equal(assessCombinedBooking(c).reason,'BLACKOUT');
});
test('pause, throttle and closed days cannot silently approve',()=>{
 for(const change of [{mode:'paused',capacity_throttle:0},{mode:'busy',capacity_throttle:0.2}]){
  const c=context();c.state.availability.serviceState=change;
  assert.equal(assessCombinedBooking(c).status,'UNVERIFIED');
 }
 const c=context();c.state.availability.closedDates=['2026-10-30'];
 assert.equal(assessCombinedBooking(c).reason,'OUTSIDE_SERVICE_WINDOW');
});
test('whole basket frying cannot begin before placement plus lead buffer',()=>{
 const c=context();c.state.now='2026-10-30T18:54:00Z';
 assert.equal(assessCombinedBooking(c).status,'UNVERIFIED');
});
test('different spice and kitchen notes cannot batch together',()=>{
 const orders=['a','b'].map(orderId=>({orderId,readyMinute:1140,placedAt:new Date(2026,9,30,17,0)}));
 const rows=orders.map((o,i)=>({id:o.orderId,items:[{item_id:'panang-curry',qty:1,modifiers:[],spice:i,item_note:i?'no onion':''}]}));
 const r=scheduleCrossOrderPanang(orders,rows);
 assert.equal(r.status,'FEASIBLE_PROTOTYPE');assert.equal(r.jobs.length,2);
});
test('prior-day preorder releases at start of service day in every host timezone',()=>{
 assert.equal(relativePlacement('2026-10-29T22:30:00Z','2026-10-30').getHours(),0);
 assert.throws(()=>relativePlacement('2026-10-31T01:00:00Z','2026-10-30'));
});
test('transaction writer rejects explicit non-authority even with GREEN status',async()=>{
 let writes=0;
 const r=await reserveWithMasterWok({connection:{query:async()=>{}},serviceDate:'2026-10-30',key:'test',candidate:{},
  readCommitted:async()=>({acceptedOrders:[]}),assess:async()=>({status:'GREEN',bookingApprovalAllowed:false}),persist:async()=>{writes++;}});
 assert.equal(r.committed,false);assert.equal(writes,0);
});
test('invalid service-control expiry fails closed',()=>{
 const c=context();c.state.availability.serviceState.effective_until='invalid';
 assert.equal(assessCombinedBooking(c).reason,'INVALID_SERVICE_CONTROL_EXPIRY');
});
test('concrete order writer rejects nonfinite trusted totals before any SQL insert',async()=>{
 const {createOrderStore}=require('./master-wok-order-store');let writes=0;
 await assert.rejects(createOrderStore().persist({query:async()=>{writes++;}},
  {key:'x',serviceDate:'2026-10-30',candidate:{validatedHeader:{order_type:'collection',
   preferred_time:'2026-10-30T19:00:00Z',subtotal:NaN,total:10},
   validatedItems:[{item_id:'pad-thai',name:'Pad Thai',unit_price:10,qty:1,modifiers:[]}]}}));
 assert.equal(writes,0);
});
test('request data cannot enable the server-side checkout mode',async()=>{
 const {createAtomicCheckout}=require('./master-wok-atomic-checkout');let connections=0;
 const checkout=createAtomicCheckout({pool:{connect:async()=>{connections++;}},model,
  validateCommercialOrder:async()=>{},readAvailability:async()=>{},assessBooking:async()=>{}});
 assert.equal((await checkout({mode:'MASTER_WOK',bookingApprovalAllowed:true})).status,'LEGACY');
 assert.equal(connections,0);
});
