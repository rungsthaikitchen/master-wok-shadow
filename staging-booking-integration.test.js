'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {bookStagingCandidate,londonPlacement}=require('./staging-booking-integration');
test('London placement uses BST clock in summer and GMT in winter',()=>{
 assert.equal(londonPlacement('2026-07-01T15:30:00Z').getHours(),16);
 assert.equal(londonPlacement('2026-11-01T16:30:00Z').getHours(),16);
});
test('locked transaction reads staging rows before engine assessment and persistence',async()=>{
 const steps=[];
 const connection={query:async(sql)=>{if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK'){steps.push(sql);return {rows:[]};}
 if(sql.includes('pg_advisory_xact_lock')){steps.push('LOCK');return {rows:[]};}
 steps.push('READ');return {rows:[]};}};
 const model={classifyBasket:()=>({})};
 const engine={assessCapacityV1:({acceptedOrders})=>{steps.push('ASSESS');assert.equal(acceptedOrders.length,0);return {status:'GREEN'};}};
 const result=await bookStagingCandidate({
  connection,serviceDate:'2026-11-01',key:'one',
  candidate:{orderId:'one',placedAt:'2026-11-01T16:30:00Z',readyMinute:1140,classification:{}},
  model,engine,lookupKey:async()=>{steps.push('KEY');return null;},
  persist:async()=>{steps.push('PERSIST');}
 });
 assert.equal(result.committed,true);
 assert.deepEqual(steps,['BEGIN','LOCK','READ','KEY','ASSESS','PERSIST','COMMIT']);
});
test('missing order items fails closed before engine runs',async()=>{
 let assessed=false;
 const connection={query:async(sql)=>sql.includes('from public.orders')?{rows:[{id:'one',created_at:'2026-11-01T16:30:00Z',status:'confirmed',items:[]}]}:{rows:[]}};
 const result=await bookStagingCandidate({
  connection,serviceDate:'2026-11-01',key:'one',
  candidate:{placedAt:'2026-11-01T16:30:00Z'},model:{classifyBasket:()=>({})},
  engine:{assessCapacityV1:()=>{assessed=true;return {status:'GREEN'};}},
  lookupKey:async()=>null,persist:async()=>{throw Error('should not persist');}
 });
 assert.equal(result.committed,false);assert.equal(assessed,false);
});
