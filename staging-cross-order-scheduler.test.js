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
test('fryer-dependent dish fails closed',()=>{
 const x=sample(1);x.rows[0].items[0].item_id='stir-crispy';
 assert.equal(schedule(x.orders,x.rows).reason,'UNSUPPORTED_MIXED_PRODUCTION');
});
test('different modifiers are never combined',()=>{
 const x=sample(2);x.rows[1].items[0].modifiers=[{id:'chicken'}];
 const r=schedule(x.orders,x.rows);
 assert.equal(r.productionBatches,2);
 assert.equal(r.status,'FEASIBLE_PROTOTYPE');
 assert.ok(r.jobs.every(j=>j.portions===1));
 assert.ok(r.jobs[0].finish+1<=r.jobs[1].start);
});

test('two identical Pad Thai portions use a ten-minute noodle batch',()=>{
 const x=sample(2);for(const row of x.rows)row.items[0].item_id='pad-thai';
 const r=schedule(x.orders,x.rows);
 assert.equal(r.status,'FEASIBLE_PROTOTYPE');
 assert.equal(r.productionBatches,1);
 assert.equal(r.jobs[0].group,'noodle');
 assert.equal(r.jobs[0].finish-r.jobs[0].start,10);
});
test('different dishes never share a batch even within fast group',()=>{
 const x=sample(2);x.rows[1].items[0].item_id='green-curry';
 const r=schedule(x.orders,x.rows);
 assert.equal(r.productionBatches,2);
 assert.equal(r.status,'FEASIBLE_PROTOTYPE');
 assert.deepEqual(new Set(r.jobs.map(j=>j.itemId)),new Set(['panang-curry','green-curry']));
 assert.ok(r.jobs.every(j=>j.portions===1));
 assert.ok(r.jobs[0].finish+1<=r.jobs[1].start);
});
test('salad batch respects four portion maximum',()=>{
 const x=sample(4);for(const row of x.rows)row.items[0].item_id='papaya-salad';
 const r=schedule(x.orders,x.rows);
 assert.equal(r.status,'FEASIBLE_PROTOTYPE');
 assert.equal(r.productionBatches,1);
 assert.equal(r.jobs[0].finish-r.jobs[0].start,15);
});

test('shared wok resolves overlapping independent backplans by moving a batch',()=>{
 const x=sample(2);
 x.rows[1].items[0].item_id='pad-thai';
 const r=schedule(x.orders,x.rows);
 assert.equal(r.status,'FEASIBLE_PROTOTYPE');
 assert.equal(r.jobs.length,2);
 assert.ok(r.jobs[0].finish+1<=r.jobs[1].start);
});
test('same deadline and insufficient holding fails closed',()=>{
 const x=sample(4);
 for(const row of x.rows)row.items[0].item_id='pad-thai';
 const r=schedule(x.orders,x.rows);
 assert.equal(r.status,'UNVERIFIED');
 assert.equal(r.bookingApprovalAllowed,false);
});

function mixedFixture(){
 const orders=[
  {orderId:'a',readyMinute:1110,placedAt:new Date(2026,9,17,17,0)},
  {orderId:'b',readyMinute:1140,placedAt:new Date(2026,9,17,17,10)},
  {orderId:'c',readyMinute:1170,placedAt:new Date(2026,9,17,17,20)}
 ];
 const line=(item_id,qty=1,modifiers=[])=>({item_id,qty,modifiers});
 const rows=[
  {id:'a',items:[line('panang-curry',2),line('jasmine-rice')]},
  {id:'b',items:[line('green-curry'),line('pad-thai')]},
  {id:'c',items:[line('stir-basil'),line('papaya-salad')]}
 ];
 return {orders,rows};
}
test('mixed multi-line service across three ready times fits shared wok',()=>{
 const x=mixedFixture(),r=schedule(x.orders,x.rows);
 assert.equal(r.status,'FEASIBLE_PROTOTYPE');
 assert.equal(r.productionBatches,5);
 assert.deepEqual(new Set(r.jobs.map(j=>j.itemId)),
   new Set(['panang-curry','green-curry','pad-thai','stir-basil','papaya-salad']));
 for(let i=0;i<r.jobs.length;i++){
  const j=r.jobs[i];
  assert.ok(j.start>=990&&j.finish<=1320);
  assert.ok(j.finish<=j.readyMinute);
  assert.ok(j.holdingMinutes<=j.holdingLimitMinutes);
  if(i)assert.ok(r.jobs[i-1].finish+1<=j.start);
 }
 assert.equal(r.bookingApprovalAllowed,false);
});
test('mixed service with fryer-dependent dish fails closed',()=>{
 const x=mixedFixture();
 x.rows[2].items.push({item_id:'stir-crispy',qty:1,modifiers:[]});
 const r=schedule(x.orders,x.rows);
 assert.equal(r.status,'UNVERIFIED');
 assert.equal(r.reason,'UNSUPPORTED_MIXED_PRODUCTION');
 assert.equal(r.bookingApprovalAllowed,false);
});
test('mixed service with impossible late placement fails closed',()=>{
 const x=mixedFixture();
 x.orders[1].placedAt=new Date(2026,9,17,18,59);
 const r=schedule(x.orders,x.rows);
 assert.equal(r.status,'UNVERIFIED');
 assert.equal(r.bookingApprovalAllowed,false);
});
