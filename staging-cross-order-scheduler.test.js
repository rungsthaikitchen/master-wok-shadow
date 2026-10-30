'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {scheduleCrossOrderPanang:schedule}=require('./staging-cross-order-scheduler');
function sample(n,placed='2026-10-17T17:00:00Z',ready=1140){
 const orders=[],rows=[];
 for(let i=0;i<n;i++){
   const id='o'+i;orders.push({orderId:id,readyMinute:ready,placedAt:new Date(placed)});
   rows.push({id,items:[{item_id:'panang-curry',qty:1,modifiers:[]}]});
 }
 return {orders,rows};
}
test('ten identical Panangs fit three batches with 20-minute hold',()=>{
 const x=sample(10),r=schedule(x.orders,x.rows);
 assert.equal(r.status,'FEASIBLE_PROTOTYPE');
 assert.equal(r.productionBatches,3);
 assert.equal(Math.max(...r.jobs.map(j=>j.holdingMinutes)),18);
 assert.equal(r.bookingApprovalAllowed,false);
});
test('orders placed after required cooking starts fail closed',()=>{
 const x=sample(10,'2026-10-17T18:50:00Z');
 assert.equal(schedule(x.orders,x.rows).status,'UNVERIFIED');
});
test('unmodelled dish fails closed',()=>{
 const x=sample(1);x.rows[0].items[0].item_id='pad-thai';
 assert.equal(schedule(x.orders,x.rows).reason,'UNSUPPORTED_MIXED_PRODUCTION');
});
test('different modifiers are never combined',()=>{
 const x=sample(2);x.rows[1].items[0].modifiers=[{id:'chicken'}];
 const r=schedule(x.orders,x.rows);
 assert.equal(r.productionBatches,2);
 assert.equal(r.status,'UNVERIFIED');
});
