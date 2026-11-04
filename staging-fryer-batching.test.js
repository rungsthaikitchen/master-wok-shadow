'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {batchFryer}=require('./staging-fryer-batching');
const orders=[{orderId:'A',readyMinute:1140}];
const rows=(qty,item_id='stir-crispy')=>[{id:'A',items:[{item_id,qty,modifiers:[]}]}];
test('three crispy chicken portions fit one large basket batch',()=>{
 const r=batchFryer(orders,rows(3));
 assert.equal(r.status,'FRY_BATCH_PROTOTYPE');
 assert.equal(r.jobs.length,1);
 assert.equal(r.jobs[0].basket,'large');
 assert.equal(r.jobs[0].portions,3);
 assert.equal(r.bookingApprovalAllowed,false);
});
test('five portions require at least two baskets',()=>{
 const r=batchFryer(orders,rows(5));
 assert.equal(r.status,'FRY_BATCH_PROTOTYPE');
 assert.equal(r.jobs.reduce((n,j)=>n+j.portions,0),5);
 assert.ok(r.jobs.length>=2);
 assert.ok(r.jobs.every(j=>j.portions<=(j.basket==='large'?3:2)));
});
test('different fry types never share a batch',()=>{
 const r=batchFryer(orders,[{id:'A',items:[{item_id:'salt-chickenchips',qty:2,modifiers:[]}]}]);
 assert.equal(r.status,'FRY_BATCH_PROTOTYPE');
 assert.deepEqual([...new Set(r.jobs.map(j=>j.type))].sort(),['chips','crispyChicken']);
});
test('unknown fried starter recipe remains unverified',()=>{
 const r=batchFryer(orders,rows(1,'veg-spring-rolls'));
 assert.equal(r.status,'UNVERIFIED');
 assert.equal(r.bookingApprovalAllowed,false);
});
