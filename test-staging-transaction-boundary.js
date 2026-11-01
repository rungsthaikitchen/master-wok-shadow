'use strict';
const assert=require('node:assert/strict');
const {reserveWithMasterWok}=require('./master-wok-transaction-writer');
async function test(){
 const calls=[];
 const connection={query:async sql=>{calls.push(sql.trim().split(' ')[0]);return {rows:[]};}};
 const input={connection,serviceDate:'2026-10-30',key:'test-key',candidate:{id:'test'}};
 const ok=await reserveWithMasterWok({...input,readCommitted:async()=>({acceptedOrders:[]}),
  assess:async()=>({status:'GREEN'}),persist:async()=>{}});
 assert.equal(ok.committed,true);
 assert.deepEqual(calls,['BEGIN','SET','SET','SET','SELECT','SELECT','SELECT','COMMIT']);
 calls.length=0;
 const no=await reserveWithMasterWok({...input,readCommitted:async()=>({acceptedOrders:[]}),
  assess:async()=>({status:'UNVERIFIED'}),persist:async()=>{throw Error('unexpected');}});
 assert.equal(no.committed,false);
 assert.deepEqual(calls,['BEGIN','SET','SET','SET','SELECT','SELECT','SELECT','ROLLBACK']);
 calls.length=0;
 const failed=await reserveWithMasterWok({...input,readCommitted:async()=>({acceptedOrders:[]}),
  assess:async()=>({status:'GREEN'}),persist:async()=>{throw Error('failure');}});
 assert.equal(failed.committed,false);
 assert.deepEqual(calls,['BEGIN','SET','SET','SET','SELECT','SELECT','SELECT','ROLLBACK']);
 console.log('PASS: staging transaction commit and rollback boundaries');
}
test().catch(e=>{console.error(e);process.exitCode=1;});

