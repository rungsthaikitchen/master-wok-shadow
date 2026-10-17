'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {collectDeliveryRoutes:collect}=require('./master-wok-delivery-routes');
const input=()=>({assessedAt:'2026-10-17T17:00:00Z',orders:[{orderId:'a',orderType:'delivery',deliveryFee:0}]});
const response=p=>({...p,ok:true,duration:'300s',estimatedAt:'2026-10-17T17:00:00Z',routingPreference:'TRAFFIC_UNAWARE'});
test('route capture is disabled by default without invoking callback',async()=>{
 let calls=0;assert.equal((await collect(null,{quoteLeg:()=>calls++})).status,'DISABLED');assert.equal(calls,0);
 assert.equal((await collect(input(),{enabled:'true',quoteLeg:()=>calls++})).status,'DISABLED');assert.equal(calls,0);
});
test('free and paid deliveries receive independent outbound and return estimates',async()=>{
 for(const fee of [0,2,3,4]) {
  const s=input();s.orders[0].deliveryFee=fee;const calls=[];
  const r=await collect(s,{enabled:true,quoteLeg:p=>{calls.push(p);return {...response(p),duration:p.from==='KITCHEN'?'300s':'420s'};}});
  assert.equal(r.status,'ROUTE_ESTIMATES_CAPTURED');assert.equal(calls.length,2);
  assert.deepEqual(r.legs.map(l=>l.durationSeconds),[300,420]);
 }
});
test('two deliveries require six directional legs including cross-customer journeys',async()=>{
 const s=input();s.orders.push({orderId:'b',orderType:'delivery'});
 const r=await collect(s,{enabled:true,quoteLeg:response});
 assert.equal(r.legs.length,6);assert.ok(r.legs.some(l=>l.from==='a'&&l.to==='b'));
 assert.ok(r.legs.some(l=>l.from==='b'&&l.to==='a'));
});
test('strict duration parsing preserves fractions and explicit zero',async()=>{
 for(const duration of ['0s','300.123456789s','14400s']) {
  const r=await collect(input(),{enabled:true,quoteLeg:p=>({...response(p),duration})});
  assert.equal(r.status,'ROUTE_ESTIMATES_CAPTURED');assert.equal(r.legs[0].durationSeconds,Number(duration.slice(0,-1)));
 }
 for(const duration of [null,undefined,300,'',' 300s','-1s','1e2s','14400.01s','Infinitys'])
  assert.equal((await collect(input(),{enabled:true,quoteLeg:p=>({...response(p),duration})})).status,'UNVERIFIED');
});
test('failed, wrongly directed, future and traffic-incompatible evidence returns no partial matrix',async()=>{
 for(const change of [r=>r.ok=false,r=>r.to='other',r=>r.estimatedAt='2026-10-17T17:00:01Z',
 r=>r.estimatedAt='2026-10-17T17:00:00',r=>r.routingPreference='TRAFFIC_AWARE']) {
  let calls=0;const r=await collect(input(),{enabled:true,quoteLeg:p=>{const r=response(p);if(++calls===2)change(r);return r;}});
  assert.equal(r.status,'UNVERIFIED');assert.equal(r.legs,undefined);
 }
});
test('throw, rejection and stalled evidence are contained',async()=>{
 for(const quoteLeg of [()=>{throw Error('secret');},()=>Promise.reject(Error('secret')),()=>new Promise(()=>{})]) {
  const r=await collect(input(),{enabled:true,quoteLeg,timeoutMs:10});assert.equal(r.status,'UNVERIFIED');
  assert.ok(!JSON.stringify(r).includes('secret'));
 }
});
test('timed-out route work receives cancellation and late rejection is handled',async()=>{
 let signal;
 const r=await collect(input(),{enabled:true,timeoutMs:5,quoteLeg:(_,{signal:s})=>{
  signal=s;return new Promise((_,reject)=>s.addEventListener('abort',()=>reject(Error('late private failure'))));
 }});
 assert.equal(r.status,'UNVERIFIED');assert.equal(signal.aborted,true);
});
test('callback and provider extras cannot leak PII into route evidence',async()=>{
 const s=input(),before=structuredClone(s);
 const r=await collect(s,{enabled:true,quoteLeg:p=>({...response(p),address:'private',apiKey:'private',coordinates:[1,2]})});
 assert.deepEqual(s,before);assert.ok(!JSON.stringify(r).includes('private'));assert.ok(!JSON.stringify(r).includes('coordinates'));
});
test('malformed aliases, duplicate orders and collections do not trigger route calls',async()=>{
 for(const orders of [[{orderId:'KITCHEN',orderType:'delivery'}],[{orderId:'a',orderType:'collection'}],
 [{orderId:'a',orderType:'delivery'},{orderId:'a',orderType:'delivery'}]]) {
  let calls=0;const s=input();s.orders=orders;
  assert.equal((await collect(s,{enabled:true,quoteLeg:()=>calls++})).status,'UNVERIFIED');assert.equal(calls,0);
 }
});
