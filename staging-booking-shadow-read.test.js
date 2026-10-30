'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {compareStagingBookingReadOnly}=require('./staging-booking-shadow-read');
const at=new Date('2026-10-17T16:30:00Z');
const candidate={order:{orderId:'candidate',readyMinute:1140,placedAt:at},
 row:{id:'candidate',items:[{item_id:'panang-curry',qty:1,modifiers:[]}]}};
test('read-only bridge queries staging and includes candidate',async()=>{
 let calls=0;
 const connection={query:async(sql,args)=>{
  calls++;
  assert.match(sql,/select o.id/i);
  assert.deepEqual(args,['2026-10-17']);
  return {rows:[]};
 }};
 const model={classifyBasket:()=>({}),hasItem:()=>true};
 const r=await compareStagingBookingReadOnly({connection,serviceDate:'2026-10-17',model,candidate,legacyDecision:'AVAILABLE'});
 assert.equal(calls,1);
 assert.equal(r.checkedOrders,1);
 assert.equal(r.bookingApprovalAllowed,false);
 assert.equal(r.legacyDecision,'AVAILABLE');
});
test('read failure returns UNVERIFIED without booking approval',async()=>{
 const connection={query:async()=>{throw Error('offline')}};
 const r=await compareStagingBookingReadOnly({connection,serviceDate:'2026-10-17',model:{},candidate});
 assert.equal(r.reason,'STAGING_READ_FAILED');
 assert.equal(r.bookingApprovalAllowed,false);
});
test('invalid connection does not attempt any booking',async()=>{
 const r=await compareStagingBookingReadOnly({connection:null,serviceDate:'2026-10-17',candidate});
 assert.equal(r.reason,'INVALID_READ_CONNECTION');
 assert.equal(r.bookingApprovalAllowed,false);
});
