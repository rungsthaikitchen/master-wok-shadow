'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createBookingHttpHandler}=require('./master-wok-http');
const {createHistoricalReconciliationWriter}=require('./historical_order_reconciliation_writer.cjs');
test('authenticated historical correction records payment and completion once',async()=>{
 const id='b25d0025-1658-4123-8123-000000000001',key='b25d0025-1658-4123-8123-000000000003';
 let order={id,status:'customer_declined_time',total:32.5,proposed_time:'2026-11-20T19:10:00Z',paid:false,payment_status:'unpaid'},payment,amendment,events=0,loyalty=0,connections=0;
 const connection={release(){},async query(sql,args=[]){
 if(/SELECT \* FROM .*orders.*FOR UPDATE/.test(sql))return {rows:[order]};
 if(/SELECT \* FROM .*order_payments/.test(sql))return {rows:payment?[payment]:[]};
 if(/SELECT response,request_fingerprint/.test(sql))return {rows:amendment?[amendment]:[]};
 if(/clock_timestamp\(\) AS now/.test(sql))return {rows:[{now:'2026-11-21T12:00:00Z'}]};
 if(/INSERT INTO .*order_payments/.test(sql)){payment={id:'payment',amount:args[2]};return {rows:[payment]};}
 if(/UPDATE .*orders SET status/.test(sql)){order={...order,status:'completed',paid:true,payment_status:'paid',confirmed_time:order.proposed_time};return {rows:[]};}
 if(/INSERT INTO .*order_amendments/.test(sql)){amendment={response:JSON.parse(args[7]),request_fingerprint:args[2]};return {rows:[]};}
 if(/INSERT INTO .*order_payment_events/.test(sql)){events++;return {rows:[]};}
 if(['COMMIT','ROLLBACK'].includes(sql))return {rows:[]};
 throw Error('Unexpected query: '+sql);
 }};
 const writer=createHistoricalReconciliationWriter({pool:{async connect(){connections++;return connection;}},beginBookingTransaction:async()=>{},assertWriteAllowed:async()=>{},settleLoyalty:async()=>{loyalty++;return {handled:true,settled:true};}});
 const stub=async()=>({success:true});
 const handler=createBookingHttpHandler({secret:'a'.repeat(64),checkout:stub,lifecycle:{adminAction:stub,customerResponse:stub},serviceControl:stub,readMode:async()=>'MASTER_WOK',payments:writer});
 const payload={action:'historical_reconcile',orderId:id,idempotencyKey:key,agreedTime:order.proposed_time,amountPence:3250,method:'card',fulfilled:true,staffActor:'staff@example.invalid',reason:'Synthetic historical correction'};
 const send=secret=>handler(new Request('https://test.invalid',{method:'POST',headers:{'content-type':'application/json','x-master-wok-secret':secret},body:JSON.stringify({operation:'payments',payload})}));
 assert.equal((await send('incorrect')).status,401);assert.equal(connections,0);
 const first=await send('a'.repeat(64));assert.equal(first.status,200);assert.equal((await first.json()).committed,true);
 const replay=await (await send('a'.repeat(64))).json();assert.equal(replay.replayed,true);assert.equal(replay.committed,false);
 assert.equal(payment.amount,32.5);assert.equal(order.status,'completed');assert.equal(events,1);assert.equal(loyalty,1);
});
