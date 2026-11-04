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
test('unknown menu item fails closed',()=>{
 const r=compareBookingShadow({orders:[],rows:[],candidate:{
  order:candidate.order,row:{id:'new',items:[line('unrecognised-menu-item')]}
 }});
 assert.equal(r.shadowDecision,'UNVERIFIED');
 assert.equal(r.bookingApprovalAllowed,false);
});
test('incomplete committed snapshot fails closed',()=>{
 const r=compareBookingShadow({orders:[{orderId:'missing',readyMinute:1140,placedAt}],rows:[],candidate});
 assert.equal(r.reason,'INCOMPLETE_COMMITTED_SNAPSHOT');
});

test('standalone spring rolls do not consume wok capacity but block unverified fryer load',()=>{
 const r=compareBookingShadow({orders:[],rows:[],candidate:{
  order:candidate.order,row:{id:'new',items:[line('veg-spring-rolls')]}
 }});
 assert.equal(r.status,'UNVERIFIED');
 assert.equal(r.planFailureReason,'FRY_RECIPES_UNMODELLED');
 assert.equal(r.bookingApprovalAllowed,false);
});

test('eleventh Panang can fit through batching without booking approval',()=>{
 const orders=[],rows=[];
 for(let i=0;i<10;i++){
  const id='busy-'+i;
  orders.push({orderId:id,readyMinute:1140,placedAt:new Date(2026,9,17,17,0)});
  rows.push({id,items:[line('panang-curry')]});
 }
 const r=compareBookingShadow({orders,rows,candidate});
 assert.equal(r.status,'VALIDATED_SHADOW_PROTOTYPE');
 assert.equal(r.curryHoldPolicy,'EXCEPTION_20_MINUTES');
 assert.equal(r.planFailureReason,null);
 assert.equal(r.bookingApprovalAllowed,false);
});
test('late eleventh Panang fails closed with a specific blocker',()=>{
 const orders=[],rows=[];
 for(let i=0;i<10;i++){
  const id='late-'+i;
  orders.push({orderId:id,readyMinute:1140,placedAt:new Date(2026,9,17,18,50)});
  rows.push({id,items:[line('panang-curry')]});
 }
 const r=compareBookingShadow({orders,rows,candidate:{order:{...candidate.order,
  placedAt:new Date(2026,9,17,18,50)},row:candidate.row}});
 assert.equal(r.status,'UNVERIFIED');
 assert.equal(typeof r.planFailureReason,'string');
 assert.equal(r.bookingApprovalAllowed,false);
});
test('light Panang candidate reports preferred curry holding policy',()=>{
 const r=compareBookingShadow({orders:[],rows:[],candidate});
 assert.equal(r.curryHoldPolicy,'PREFERRED_10_MINUTES');
 assert.equal(r.planFailureReason,null);
});
