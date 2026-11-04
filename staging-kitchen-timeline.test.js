'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {assessKitchen}=require('./staging-kitchen-timeline');
const {orders,rows}=require('./staging-tests/mixed-kitchen-fixture');
test('mixed kitchen has one combined report with explicit blockers',()=>{
 const r=assessKitchen(orders,rows);
 assert.equal(r.status,'UNVERIFIED');
 assert.equal(r.bookingApprovalAllowed,false);
 assert.ok(r.blockers.includes('WOK_PLAN_UNVERIFIED'));
 assert.ok(r.blockers.includes('FRY_RECIPES_UNMODELLED'));
 assert.ok(r.blockers.includes('WOK_FRYER_DEPENDENCIES_NOT_INTEGRATED'));
});
test('plain curry provides wok events without booking approval',()=>{
 const o=[{orderId:'A',readyMinute:1140,placedAt:new Date(2026,9,17,17,30)}];
 const r=assessKitchen(o,[{id:'A',items:[{item_id:'panang-curry',qty:2,modifiers:[]}]}]);
 assert.equal(r.wok.status,'FEASIBLE_PROTOTYPE');
 assert.ok(r.events.some(e=>e.resource==='wok'));
 assert.equal(r.bookingApprovalAllowed,false);
});
test('all combined events have a valid resource and chronological start order',()=>{
 const r=assessKitchen(orders,rows);
 assert.ok(r.events.every(e=>e.resource&&Number.isFinite(e.start)&&Number.isFinite(e.finish)&&e.finish>=e.start));
 assert.deepEqual(r.events.map(e=>e.start),[...r.events.map(e=>e.start)].sort((a,b)=>a-b));
});
