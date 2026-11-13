'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
require('./master-wok-model-bundle');const {createBasketAvailability}=require('./master-wok-availability');
test('unverified capacity hints are distinguished from verified availability without reserving anything',async()=>{
 const queries=[];let n=0;const c={query:async sql=>{queries.push(sql);return {rows:sql.startsWith('SELECT clock_timestamp')?[{now:new Date('2026-11-13T09:00:00Z')}]:[]};},release(){}};
 const fn=createBasketAvailability({pool:{connect:async()=>c},model:globalThis.MasterWokModelV1,readAvailability:async()=>({}),readOrders:async()=>[],planStore:{read:async()=>null},assertWriteAllowed:async()=>{},assessBooking:async()=>++n===1?{status:'UNVERIFIED',reason:'SEARCH_LIMIT',bookingApprovalAllowed:false}:{status:'GREEN',bookingApprovalAllowed:true}});
 const r=await fn({times:['2026-11-13T18:00:00Z','2026-11-13T19:00:00Z'],items:[{item_id:'stir-pepper',qty:1,modifiers:[{id:'chicken'}],spice:1}],orderType:'collection'});
 assert.equal(r.success,true);assert.equal(r.hints[0].unverified,true);assert.equal(r.hints[0].available,false);assert.equal(r.hints[1].unverified,false);assert.equal(r.hints[1].available,true);assert.equal(r.bookingApprovalAllowed,false);assert.equal(queries.at(-1),'ROLLBACK');assert.ok(!queries.includes('COMMIT'));
});
