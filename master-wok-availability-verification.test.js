'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
require('./master-wok-model-bundle');const {createBasketAvailability}=require('./master-wok-availability');
test('unverified capacity hints are distinguished from verified availability without reserving anything',async()=>{
 const queries=[];let n=0;const c={query:async sql=>{queries.push(sql);return {rows:sql.startsWith('SELECT clock_timestamp')?[{now:new Date('2026-11-13T09:00:00Z')}]:[]};},release(){}};
 const fn=createBasketAvailability({pool:{connect:async()=>c},model:globalThis.MasterWokModelV1,readAvailability:async()=>({}),readOrders:async()=>[],planStore:{read:async()=>null},assertWriteAllowed:async()=>{},assessBooking:async()=>++n===1?{status:'UNVERIFIED',reason:'SEARCH_LIMIT',bookingApprovalAllowed:false}:{status:'GREEN',bookingApprovalAllowed:true}});
 const r=await fn({times:['2026-11-13T18:00:00Z','2026-11-13T19:00:00Z'],items:[{item_id:'stir-pepper',qty:1,modifiers:[{id:'chicken'}],spice:1}],orderType:'collection'});
 assert.equal(r.success,true);assert.equal(r.hints[0].unverified,true);assert.equal(r.hints[0].available,false);assert.equal(r.hints[1].unverified,false);assert.equal(r.hints[1].available,true);assert.equal(r.bookingApprovalAllowed,false);assert.equal(queries.at(-1),'ROLLBACK');assert.ok(!queries.includes('COMMIT'));
});

test('hint search releases its locked snapshot before assessing and never reserves capacity',async()=>{
 const events=[];let released=0;
 const c={query:async sql=>{events.push(sql);return {rows:sql.startsWith('SELECT clock_timestamp')?[{now:new Date('2026-11-13T09:00:00Z')}]:[]};},release(){released++;events.push('release');}};
 const fn=createBasketAvailability({pool:{connect:async()=>c},model:globalThis.MasterWokModelV1,
  readOrders:async()=>{events.push('orders');return [];},readAvailability:async()=>{events.push('availability');return {};},
  planStore:{read:async()=>{events.push('plan');return null;}},assertWriteAllowed:async()=>{events.push('guard');},
  assessBooking:async()=>{
   assert.equal(released,1);assert.equal(events.at(-1),'release');
   assert.ok(events.indexOf('plan')<events.indexOf('ROLLBACK'));
   return {status:'UNVERIFIED',reason:'DRIVER_UNAVAILABLE',bookingApprovalAllowed:false};
  }});
 const r=await fn({times:['2026-11-13T18:00:00Z'],items:[{item_id:'stir-pepper',qty:1,modifiers:[{id:'chicken'}],spice:1}],orderType:'collection'});
 assert.equal(r.success,true);assert.equal(r.bookingApprovalAllowed,false);
 assert.deepEqual(r.hints,[{time:'2026-11-13T18:00:00Z',available:false,unverified:false,availabilityReason:'DRIVER_BUSY'}]);
 assert.equal(released,1);assert.equal(events.filter(x=>x==='ROLLBACK').length,1);assert.ok(!events.includes('COMMIT'));
});

test('assessment exceptions fail closed after the database connection is released',async()=>{
 let released=0;const c={query:async sql=>({rows:sql.startsWith('SELECT clock_timestamp')?[{now:new Date('2026-11-13T09:00:00Z')}]:[]}),release(){released++;}};
 const fn=createBasketAvailability({pool:{connect:async()=>c},model:globalThis.MasterWokModelV1,
  readAvailability:async()=>({}),readOrders:async()=>[],planStore:{read:async()=>null},assertWriteAllowed:async()=>{},
  assessBooking:async()=>{throw Error('private failure');}});
 const r=await fn({times:['2026-11-13T18:00:00Z'],items:[{item_id:'stir-pepper',qty:1,modifiers:[{id:'chicken'}],spice:1}],orderType:'collection'});
 assert.equal(r.reason,'AVAILABILITY_UNAVAILABLE');assert.equal(released,1);
});
