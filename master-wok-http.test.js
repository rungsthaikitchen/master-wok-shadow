'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createBookingHttpHandler}=require('./master-wok-http');
const secret='test-only-http-secret-12345678901234567890';
function setup(overrides={}){
 const calls=[];const record=name=>async payload=>{calls.push({name,payload});return {success:true};};
 const handler=createBookingHttpHandler({secret,checkout:record('checkout'),lifecycle:{adminAction:record('admin'),customerResponse:record('customer')},serviceControl:record('controls'),readMode:async()=>'LEGACY',...overrides});
 const send=(body,headers={})=>handler(new Request('https://staging.invalid/functions/v1/master-wok-booking',{method:'POST',headers:{'content-type':'application/json','x-master-wok-secret':secret,...headers},body:typeof body==='string'?body:JSON.stringify(body)}));
 return {calls,handler,send};
}
test('HTTP boundary rejects unauthorized, malformed and oversized requests before any writer',async()=>{
 const {send,calls}=setup();
 assert.equal((await send({operation:'checkout',payload:{}},{'x-master-wok-secret':'bad'})).status,401);
 assert.equal((await send('{')).status,400);
 assert.equal((await send('x'.repeat(65537))).status,413);
 assert.equal((await send({operation:'constructor',payload:{}})).status,400);
 assert.equal((await send({operation:'checkout',payload:[]})).status,400);
 assert.equal(calls.length,0);
});
test('checkout replay retains the committed receipt and uncertain errors never claim rollback',async()=>{
 const {send}=setup({checkout:async()=>({status:'GREEN',committed:false,reason:'REPLAY',response:{orderId:'saved-order',total:9}})});
 const r=await send({operation:'checkout',payload:{key:'same-key'}});assert.equal(r.status,200);
 assert.deepEqual(await r.json(),{orderId:'saved-order',total:9,success:true,committed:false,replayed:true});
 const failing=setup({checkout:async()=>{throw Error('private SQL credential');}});
 const f=await failing.send({operation:'checkout',payload:{}});const body=await f.json();
 assert.equal(f.status,503);assert.equal(body.committed,undefined);assert.ok(!JSON.stringify(body).includes('credential'));
});
test('mode and lifecycle/service operations use server dependencies without client authority',async()=>{
 const {send,calls}=setup({readMode:async()=>'DRAINING'});
 const mode=await send({operation:'mode',payload:{mode:'MASTER_WOK'}});
 assert.equal(mode.headers.get('cache-control'),'no-store');assert.deepEqual(await mode.json(),{mode:'DRAINING'});
 for(const operation of ['admin_action','customer_response','service_control'])assert.equal((await send({operation,payload:{action:'example'}})).status,200);
 assert.deepEqual(calls.map(x=>x.name),['admin','customer','controls']);
});
