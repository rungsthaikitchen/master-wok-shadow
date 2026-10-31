'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {reserveWithMasterWok}=require('./master-wok-transaction-writer');
function harness(){
 const log=[];let tail=Promise.resolve();let committed=0;
 function connection(name){
  let release;
  return {query:async(sql)=>{
   log.push(name+':'+sql.split(' ')[0]);
   if(sql==='BEGIN')return;
   if(sql.includes('pg_advisory_xact_lock')){
    const previous=tail;
    tail=new Promise(resolve=>{release=resolve;});
    await previous;
   }
   if(sql==='COMMIT'){committed++;release?.();}
   if(sql==='ROLLBACK')release?.();
  }};
 }
 return {connection,log,get committed(){return committed;}};
}
test('concurrent requests serialize assessment behind the same date lock',async()=>{
 const h=harness();let capacityUsed=0;let reads=0;
 const run=(name)=>reserveWithMasterWok({
  connection:h.connection(name),serviceDate:'2026-11-01',key:name,candidate:{id:name},
  readCommitted:async()=>{reads++;return {acceptedOrders:Array(capacityUsed).fill({})};},
  assess:async({acceptedOrders})=>({status:acceptedOrders.length===0?'GREEN':'AMBER'}),
  persist:async()=>{capacityUsed++;}
 });
 const [a,b]=await Promise.all([run('a'),run('b')]);
 assert.equal([a,b].filter(x=>x.committed).length,1);
 assert.equal(h.committed,1);
 assert.equal(reads,2);
 assert.equal(capacityUsed,1);
});
test('assessment exception fails closed and rolls back',async()=>{
 const log=[];
 const result=await reserveWithMasterWok({
  connection:{query:async sql=>{log.push(sql);}},
  serviceDate:'2026-11-01',key:'fail',candidate:{id:'fail'},
  readCommitted:async()=>({acceptedOrders:[]}),
  assess:async()=>{throw Error('scheduler unavailable');},
  persist:async()=>{throw Error('MUST_NOT_WRITE');}
 });
 assert.equal(result.committed,false);
 assert.equal(result.reason,'TRANSACTION_FAILED');
 assert.equal(log.at(-1),'ROLLBACK');
});
test('shadow-only assessment cannot authorize persistence',async()=>{
 let writes=0;
 const result=await reserveWithMasterWok({
  connection:{query:async()=>{}},serviceDate:'2026-11-01',key:'shadow',
  candidate:{id:'shadow'},readCommitted:async()=>({acceptedOrders:[]}),
  assess:async()=>({status:'VALIDATED_SHADOW_PROTOTYPE',bookingApprovalAllowed:false}),
  persist:async()=>{writes++;}
 });
 assert.equal(result.committed,false);
 assert.equal(writes,0);
});
