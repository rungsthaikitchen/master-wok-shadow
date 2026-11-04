'use strict';
// Verify the assessor sees raw committed basket lines INSIDE the date lock.
// This is a mock database test; it does not certify booking authority.
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {bookStagingBasket}=require('./staging-basket-booking-bridge');
async function main(){
 const ctx=vm.createContext({window:{},Date});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'master-wok-model-bundle.js'),'utf8'),ctx);
 const model=ctx.window.MasterWokModelV1;
 const events=[];
 const existing={id:'already-booked',created_at:'2026-10-30T16:45:00Z',
  preferred_time:'2026-10-30T18:00:00Z',status:'accepted',
  local_service_date:'2026-10-30',local_ready_minute:1080,
  items:[{item_id:'green-curry',qty:1,modifiers:[]}]};
 const connection={query:async(sql)=>{
  events.push(sql==='BEGIN'?'BEGIN':sql==='ROLLBACK'?'ROLLBACK':
   sql==='COMMIT'?'COMMIT':sql.includes('pg_advisory_xact_lock')?'LOCK':'READ');
  if(sql.includes('from public.orders'))return {rows:[existing]};
  return {rows:[]};
 }};
 let assessed=false,persisted=false;
 const result=await bookStagingBasket({connection,serviceDate:'2026-10-30',key:'candidate-2',
  basket:{id:'candidate-2',createdAt:'2026-10-30T17:15:00Z',readyMinute:1090,
   items:[{item_id:'pad-thai',qty:2,modifiers:[]}]},
  model,engine:{assessCapacityV1:()=>({status:'GREEN'})},
  lookupKey:async()=>null,persist:async()=>{persisted=true;},
  bookingMode:'MASTER_WOK',
  masterWokAssess:async({acceptedOrders,proposedOrder,rawRows})=>{
   assessed=true;
   assert.ok(events.includes('LOCK'),'assessment must run after lock');
   assert.equal(acceptedOrders.length,1);
   assert.equal(rawRows.length,1);
   assert.equal(rawRows[0].items[0].item_id,'green-curry');
   assert.equal(proposedOrder.items[0].item_id,'pad-thai');
   return {status:'GREEN',bookingApprovalAllowed:false};
  }});
 assert.equal(assessed,true);
 assert.equal(result.status,'UNVERIFIED');
 assert.equal(result.committed,false);
 assert.equal(persisted,false);
 assert.ok(events.includes('ROLLBACK'));
 assert.ok(!events.includes('COMMIT'));
 console.log('PASS: locked staging assessment receives existing raw order lines and proposed basket; prototype cannot commit');
}
main().catch(e=>{console.error('FAIL: '+e.message);process.exitCode=1;});

