'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {validateKitchenTimeline}=require('./staging-kitchen-launch-validator');
const orders=[{orderId:'a',placedAt:new Date(2026,9,31,17,0)}];
const rows=[{id:'a',items:[{item_id:'panang-curry',qty:2,modifiers:[]}]}];
function plan(jobs){return {status:'COORDINATED_PROTOTYPE',wok:{jobs},fryer:{jobs:[]}};}
function job(portions,orderIds=['a']){return {itemId:'panang-curry',portions,orderIds,start:1030,finish:1036,readyMinute:1050};}
test('complete single-order portion coverage validates',()=>{
 const r=validateKitchenTimeline(orders,plan([job(2)]),rows);
 assert.equal(r.status,'VALIDATED_STAGING_TIMELINE');
 assert.equal(r.bookingApprovalAllowed,false);
});
test('missing portions fail closed',()=>{
 const r=validateKitchenTimeline(orders,plan([job(1)]),rows);
 assert.ok(r.issues.some(i=>i.code==='PORTION_COVERAGE_MISMATCH'));
});
test('duplicate portions fail closed',()=>{
 const r=validateKitchenTimeline(orders,plan([job(3)]),rows);
 assert.ok(r.issues.some(i=>i.code==='PORTION_COVERAGE_MISMATCH'));
});
test('cross-order allocation remains unverified',()=>{
 const r=validateKitchenTimeline([...orders,{orderId:'b',placedAt:new Date(2026,9,31,17,0)}],
 plan([job(2,['a','b'])]),[...rows,{id:'b',items:[{item_id:'panang-curry',qty:1,modifiers:[]}]}]);
 assert.ok(r.issues.some(i=>i.code==='CROSS_ORDER_PORTION_ALLOCATION_UNVERIFIED'));
});
test('missing order-line evidence fails closed',()=>{
 const r=validateKitchenTimeline(orders,plan([job(2)]));
 assert.ok(r.issues.some(i=>i.code==='ORDER_LINES_REQUIRED_FOR_COVERAGE'));
});
