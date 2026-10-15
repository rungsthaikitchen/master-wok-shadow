'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createShadowWorker}=require('./master-wok-worker');
test('worker disabled by default makes no queue calls',async()=>{
 let calls=0;const count=()=>{calls++;};
 const worker=createShadowWorker({queue:{claim:count,ack:count,retry:count},observer:{observe:count}});
 assert.equal((await worker.runOnce()).state,'DISABLED');assert.equal(calls,0);
});
test('worker acknowledges only after durable observer success',async()=>{
 const steps=[];
 const worker=createShadowWorker({enabled:true,queue:{claim:()=>({event:{}}),ack:()=>steps.push('ack'),retry:()=>steps.push('retry')},
 observer:{observe:async()=>{steps.push('persist');return {observed:true};}}});
 assert.equal((await worker.runOnce()).state,'RECORDED');assert.deepEqual(steps,['persist','ack']);
});
test('persistence failure retries; ack failure stays unacknowledged for lease expiry',async()=>{
 let acks=0,retries=0;
 const queue={claim:()=>({event:{}}),ack:()=>{acks++;throw Error();},retry:()=>{retries++;}};
 const failed=createShadowWorker({enabled:true,queue,observer:{observe:()=>({observed:false,reason:'PERSIST_FAILED'})}});
 assert.equal((await failed.runOnce()).state,'RETRY');assert.equal(acks,0);assert.equal(retries,1);
 const success=createShadowWorker({enabled:true,queue,observer:{observe:()=>({observed:true})}});
 assert.equal((await success.runOnce()).state,'QUEUE_OR_WORKER_ERROR');assert.equal(acks,1);
});
