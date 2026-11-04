'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {planCoordinatedKitchen}=require('./staging-coordinated-kitchen');
function panangs(count){
 const orders=[],rows=[];
 for(let i=0;i<count;i++){
  const id='p'+i;
  orders.push({orderId:id,readyMinute:1140,placedAt:new Date(2026,9,17,17,0)});
  rows.push({id,items:[{item_id:'panang-curry',qty:1,modifiers:[]}]});
 }
 return {orders,rows};
}
test('prefers ten-minute curry hold for a light service',()=>{
 const x=panangs(2),r=planCoordinatedKitchen(x.orders,x.rows);
 assert.equal(r.status,'COORDINATED_PROTOTYPE');
 assert.equal(r.curryHoldPolicy,'PREFERRED_10_MINUTES');
 assert.ok(r.wok.jobs.every(j=>j.holdingMinutes<=10));
 assert.equal(r.bookingApprovalAllowed,false);
});
test('ten Panangs require explicit twenty-minute exception flag',()=>{
 const x=panangs(10),r=planCoordinatedKitchen(x.orders,x.rows);
 assert.equal(r.status,'COORDINATED_PROTOTYPE');
 assert.equal(r.curryHoldPolicy,'EXCEPTION_20_MINUTES');
 assert.ok(r.wok.jobs.some(j=>j.holdingMinutes>10));
 assert.ok(r.wok.jobs.every(j=>j.holdingMinutes<=20));
 assert.equal(r.bookingApprovalAllowed,false);
});
test('late placement cannot be rescued by twenty-minute holding',()=>{
 const x=panangs(10);
 for(const o of x.orders)o.placedAt=new Date(2026,9,17,18,50);
 const r=planCoordinatedKitchen(x.orders,x.rows);
 assert.equal(r.status,'UNVERIFIED');
 assert.equal(r.bookingApprovalAllowed,false);
});
