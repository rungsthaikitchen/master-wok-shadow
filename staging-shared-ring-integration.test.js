'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {scheduleCrossOrderPanang}=require('./staging-cross-order-scheduler');
const order={orderId:'o1',readyMinute:1050,placedAt:new Date(2026,9,30,17,0)};
const line=item_id=>({item_id,qty:1,modifiers:[]});
test('shared-ring mode allows noodle, stir fry and two curries in parallel',()=>{
 const rows=[{id:'o1',items:[
  line('pad-thai'),line('stir-basil'),line('panang-curry'),line('green-curry')
 ]}];
 const result=scheduleCrossOrderPanang([order],rows,{sharedRings:true});
 assert.equal(result.status,'PHYSICAL_FIT_PROTOTYPE');
 assert.equal(result.jobs.length,4);
 assert.equal(new Set(result.jobs.map(j=>j.vessel)).size,4);
 assert.equal(result.bookingApprovalAllowed,false);
});
test('legacy mode is unchanged when sharedRings is absent',()=>{
 const rows=[{id:'o1',items:[line('pad-thai')]}];
 const result=scheduleCrossOrderPanang([order],rows);
 assert.equal(result.status,'FEASIBLE_PROTOTYPE');
 assert.equal(result.reason,'SHARED_WOK_TIMELINE');
});
test('shared-ring mode does not claim coordinated kitchen approval',()=>{
 const rows=[{id:'o1',items:[line('pad-thai')]}];
 const result=scheduleCrossOrderPanang([order],rows,{sharedRings:true});
 assert.equal(result.status,'PHYSICAL_FIT_PROTOTYPE');
 assert.equal(result.bookingApprovalAllowed,false);
 assert.equal(result.resourceAllocation.chefConcurrencyVerified,false);
});
