'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {bookStagingCandidate}=require('./staging-booking-integration');
function conn(log){
 return {query:async(sql)=>{
  log.push(sql.split(' ')[0]);
  if(sql.includes('from public.orders')||sql.includes('from public.orders o'))
   return {rows:[]};
 }};
}
const base=({log,bookingMode,masterWokAssess,engine})=>({
 connection:conn(log),serviceDate:'2026-11-01',key:'test-key',
 candidate:{orderId:'new',placedAt:'2026-11-01T17:30:00Z',readyMinute:1140},
 model:{classifyBasket:()=>({})},engine:engine||{assessCapacityV1:()=>({status:'GREEN'})},
 lookupKey:async()=>null,persist:async()=>{log.push('PERSIST');},
 bookingMode,masterWokAssess
});
test('legacy remains default in full staging transaction',async()=>{
 const log=[];
 const result=await bookStagingCandidate(base({log}));
 assert.equal(result.committed,true);
 assert.ok(log.includes('PERSIST'));
 assert.equal(log.at(-1),'COMMIT');
});
test('master wok shadow-only result cannot commit in staging transaction',async()=>{
 const log=[];
 const result=await bookStagingCandidate(base({log,bookingMode:'MASTER_WOK',
  masterWokAssess:async()=>({status:'VALIDATED_SHADOW_PROTOTYPE',bookingApprovalAllowed:false})}));
 assert.equal(result.committed,false);
 assert.equal(log.includes('PERSIST'),false);
 assert.equal(log.at(-1),'ROLLBACK');
});
test('master wok failure does not invoke legacy assessor',async()=>{
 const log=[];let legacyCalls=0;
 const result=await bookStagingCandidate(base({log,bookingMode:'MASTER_WOK',
  engine:{assessCapacityV1:()=>{legacyCalls++;return {status:'GREEN'};}},
  masterWokAssess:async()=>{throw Error('offline');}}));
 assert.equal(result.committed,false);
 assert.equal(legacyCalls,0);
 assert.equal(log.at(-1),'ROLLBACK');
});
test('unknown mode rejects before transaction begins',async()=>{
 const log=[];
 const result=await bookStagingCandidate(base({log,bookingMode:'SURPRISE'}));
 assert.equal(result.committed,false);
 assert.equal(result.reason,'INVALID_BOOKING_MODE');
 assert.equal(log.length,0);
});
