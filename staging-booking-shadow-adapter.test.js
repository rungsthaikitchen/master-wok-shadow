'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {compareBookingShadow}=require('./staging-booking-shadow-adapter');
const placedAt=new Date(2026,9,17,17,30);
const line=item_id=>({item_id,qty:1,modifiers:[]});
const candidate={order:{orderId:'new',readyMinute:1140,placedAt},
 row:{id:'new',items:[line('panang-curry')]}};
test('candidate is included in validated shadow workload, without approval',()=>{
 const r=compareBookingShadow({orders:[],rows:[],candidate,legacyDecision:'AVAILABLE'});
 assert.equal(r.status,'VALIDATED_SHADOW_PROTOTYPE');
 assert.equal(r.checkedOrders,1);
 assert.equal(r.candidateOrderId,'new');
 assert.equal(r.bookingApprovalAllowed,false);
});
test('existing and proposed orders are both checked',()=>{
 const orders=[{orderId:'existing',readyMinute:1140,placedAt}];
 const rows=[{id:'existing',items:[line('green-curry')]}];
 const r=compareBookingShadow({orders,rows,candidate,legacyDecision:'UNAVAILABLE'});
 assert.equal(r.checkedOrders,2);
 assert.equal(r.legacyDecision,'UNAVAILABLE');
 assert.equal(r.bookingApprovalAllowed,false);
});
test('duplicate candidate fails closed',()=>{
 const r=compareBookingShadow({orders:[candidate.order],rows:[candidate.row],candidate});
 assert.equal(r.status,'UNVERIFIED');
 assert.equal(r.reason,'INVALID_CANDIDATE');
});
test('unknown fried starter fails closed',()=>{
 const r=compareBookingShadow({orders:[],rows:[],candidate:{
  order:candidate.order,row:{id:'new',items:[line('veg-spring-rolls')]}
 }});
 assert.equal(r.shadowDecision,'UNVERIFIED');
 assert.equal(r.bookingApprovalAllowed,false);
});
test('incomplete committed snapshot fails closed',()=>{
 const r=compareBookingShadow({orders:[{orderId:'missing',readyMinute:1140,placedAt}],rows:[],candidate});
 assert.equal(r.reason,'INCOMPLETE_COMMITTED_SNAPSHOT');
});
