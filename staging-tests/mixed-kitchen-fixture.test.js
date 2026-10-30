'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {orders,rows}=require('./mixed-kitchen-fixture');
const {diagnoseFryer}=require('../staging-fryer-diagnostic');
const {scheduleCrossOrderPanang}=require('../staging-cross-order-scheduler');
test('mixed fixture includes all four committed orders',()=>{
 assert.equal(orders.length,4);
 assert.equal(rows.length,4);
 assert.equal(rows.reduce((n,r)=>n+r.items.length,0),8);
});
test('mixed fixture identifies crispy chicken and battered chicken fryer dependencies',()=>{
 const r=diagnoseFryer(orders,rows);
 assert.equal(r.status,'UNVERIFIED');
 assert.equal(r.bookingApprovalAllowed,false);
 assert.deepEqual(r.dependencies.map(x=>x.counts),[
  {crispyChicken:1},{batteredChicken:1}
 ]);
});
test('fried-only sides are explicitly unmodelled',()=>{
 const r=diagnoseFryer(orders,rows);
 assert.deepEqual(r.unmodelled.map(x=>x.itemId),['chips','veg-spring-rolls']);
});
test('wok prototype fails closed on fryer-dependent mixed workload',()=>{
 const r=scheduleCrossOrderPanang(orders,rows);
 assert.equal(r.status,'UNVERIFIED');
 assert.equal(r.reason,'UNSUPPORTED_MIXED_PRODUCTION');
 assert.equal(r.bookingApprovalAllowed,false);
});
