'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {bookStagingBasket}=require('./staging-basket-booking-bridge');
async function main(){
 const context=vm.createContext({window:{},Date});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'master-wok-model-bundle.js'),'utf8'),context);
 const model=context.window.MasterWokModelV1;
 const basket={id:'probe-basket',createdAt:'2026-10-30T17:15:00Z',readyMinute:1055,
  items:[{item_id:'green-curry',qty:1,modifiers:[]}]};
 const sql=[];
 const connection={query:async(q)=>{sql.push(q);return {rows:[]};}};
 let persistCalls=0;
 const args={connection,serviceDate:'2026-10-30',key:'probe-key',basket,model,
  engine:{assessCapacityV1:()=>({status:'GREEN'})},
  lookupKey:async()=>null,persist:async()=>{persistCalls++;},
  bookingMode:'MASTER_WOK',masterWokAssess:async()=>({status:'GREEN',bookingApprovalAllowed:false})};
 const invalid=await bookStagingBasket({...args,basket:{...basket,items:[{item_id:'unknown',qty:1,modifiers:[]}]}});
 assert.equal(invalid.status,'UNVERIFIED');
 assert.equal(sql.length,0,'invalid basket must not open transaction');
 const result=await bookStagingBasket(args);
 assert.equal(result.status,'UNVERIFIED');
 assert.equal(result.committed,false);
 assert.equal(persistCalls,0);
 assert.ok(sql.some(q=>q==='BEGIN'));
 assert.ok(sql.some(q=>q==='ROLLBACK'));
 assert.ok(!sql.includes('COMMIT'));
 console.log('PASS: validated basket reaches locked staging transaction; unauthorised prototype rolls back without writes');
}
main().catch(e=>{console.error('FAIL: '+e.message);process.exitCode=1;});
