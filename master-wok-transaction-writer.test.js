'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {reserveWithMasterWok}=require('./master-wok-transaction-writer');
function connection(log) {return {query:async(sql)=>{log.push(sql);}};}
test('lock precedes state read and commit follows persistence',async()=>{
 const log=[];const result=await reserveWithMasterWok({
  connection:connection(log),serviceDate:'2026-11-01',key:'a',candidate:{id:'a'},
  readCommitted:async()=>{log.push('READ');return {acceptedOrders:[]};},
  assess:async()=>{log.push('ASSESS');return {status:'GREEN'};},
  persist:async()=>{log.push('PERSIST');}
 });
 assert.equal(result.committed,true);
 assert.deepEqual(log.map(s=>s.startsWith('SELECT pg_advisory')?'LOCK':s),
 ['BEGIN','LOCK','READ','ASSESS','PERSIST','COMMIT']);
});
test('AMBER cannot write',async()=>{
 const log=[];const result=await reserveWithMasterWok({
  connection:connection(log),serviceDate:'2026-11-01',key:'b',candidate:{id:'b'},
  readCommitted:async()=>({acceptedOrders:[]}),
  assess:async()=>({status:'AMBER'}),
  persist:async()=>{throw Error('must not persist');}
 });
 assert.equal(result.committed,false);assert.equal(log.at(-1),'ROLLBACK');
});
test('incomplete snapshot rolls back without assessment',async()=>{
 const log=[];const result=await reserveWithMasterWok({
  connection:connection(log),serviceDate:'2026-11-01',key:'c',candidate:{id:'c'},
  readCommitted:async()=>null,
  assess:async()=>{throw Error('should not assess');},
  persist:async()=>{throw Error('should not persist');}
 });
 assert.equal(result.reason,'TRANSACTION_FAILED');assert.equal(log.at(-1),'ROLLBACK');
});
test('failed persistence rolls back',async()=>{
 const log=[];const result=await reserveWithMasterWok({
  connection:connection(log),serviceDate:'2026-11-01',key:'d',candidate:{id:'d'},
  readCommitted:async()=>({acceptedOrders:[]}),
  assess:async()=>({status:'GREEN'}),
  persist:async()=>{throw Error('insert failed');}
 });
 assert.equal(result.committed,false);assert.equal(log.at(-1),'ROLLBACK');
});
