'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {firstOrderTwoWokExperiment}=require('./staging-two-wok-first-order-experiment');
function fixture(placedAt='2026-10-30T06:59:00Z'){
 const id='anonymous-order-01';
 return {
  orders:[{orderId:id,readyMinute:1050,placedAt:new Date(placedAt)}],
  rows:[{id,items:[
   {item_id:'fried-rice',qty:1,modifiers:[]},
   {item_id:'pad-see-ew',qty:1,modifiers:[]},
   {item_id:'pad-see-ew',qty:1,modifiers:[]},
   {item_id:'salt-chickenchips',qty:1,modifiers:[]}
  ]}]
 };
}
test('first-order two-wok experiment places fry before wok and never approves bookings',()=>{
 const x=fixture(),r=firstOrderTwoWokExperiment(x.orders,x.rows);
 assert.equal(r.status,'COORDINATED_EXPERIMENT');
 assert.equal(r.bookingApprovalAllowed,false);
 assert.equal(r.wok.jobs.length,3);
 assert.equal(r.wok.jobs[1].wokStation,1);
 assert.equal(r.wok.jobs[2].wokStation,2);
 assert.equal(r.wok.jobs[2].duration,2);
 assert.equal(r.fryer.jobs.length,2);
 assert.ok(r.fryer.jobs.every(j=>j.finish<=1047));
});
test('late placement fails closed',()=>{
 const x=fixture('2026-10-30T17:11:00Z');
 assert.equal(firstOrderTwoWokExperiment(x.orders,x.rows).status,'UNVERIFIED');
});
test('different dish mix fails closed',()=>{
 const x=fixture();
 x.rows[0].items[0].item_id='pad-thai';
 assert.equal(firstOrderTwoWokExperiment(x.orders,x.rows).status,'UNVERIFIED');
});
test('different Pad See Ew modifiers fail closed',()=>{
 const x=fixture();
 x.rows[0].items[2].modifiers=['no-chilli'];
 assert.equal(firstOrderTwoWokExperiment(x.orders,x.rows).status,'UNVERIFIED');
});
