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
