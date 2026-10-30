'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {planCoordinatedKitchen}=require('./staging-coordinated-kitchen');
const {validateKitchenTimeline}=require('./staging-kitchen-launch-validator');
const at=(h,m)=>new Date(2026,9,17,h,m);
const orders=[{orderId:'A',readyMinute:1140,placedAt:at(17,30)}];
const rows=[{id:'A',items:[{item_id:'stir-crispy',qty:1,modifiers:[]}]}];
test('real coordinated prototype is checked against order placement',()=>{
 const plan=planCoordinatedKitchen(orders,rows);
 const result=validateKitchenTimeline(orders,plan);
 assert.equal(result.status,'VALIDATED_STAGING_TIMELINE');
 assert.equal(result.bookingApprovalAllowed,false);
});
test('rejects fryer work scheduled before order placement',()=>{
 const plan=planCoordinatedKitchen(orders,rows);
 plan.fryer.jobs[0].start=1000;
 const result=validateKitchenTimeline(orders,plan);
 assert.ok(result.issues.some(x=>x.code==='BEFORE_ORDER_PLACED'));
});
test('rejects two jobs occupying the same basket simultaneously',()=>{
 const plan=planCoordinatedKitchen(orders,rows);
 plan.fryer.jobs.push({...plan.fryer.jobs[0]});
 const result=validateKitchenTimeline(orders,plan);
 assert.ok(result.issues.some(x=>x.code==='RESOURCE_OVERLAP'));
});
test('rejects fryer completion after wok begins',()=>{
 const plan=planCoordinatedKitchen(orders,rows);
 plan.fryer.jobs[0].finish=plan.wok.jobs[0].start+1;
 const result=validateKitchenTimeline(orders,plan);
 assert.ok(result.issues.some(x=>x.code==='FRY_WOK_DEPENDENCY_UNVERIFIED'));
});
