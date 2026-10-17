'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {collectGoogleStagingRoutes:collect,createGoogleTransport}=require('./master-wok-google-routes');
const input=()=>({orders:[{orderId:'a',orderType:'delivery',deliveryFee:0}],
 points:{KITCHEN:{lat:53.7,lng:-1.6},a:{lat:53.8,lng:-1.7}}});
const opts=()=>({enabled:true,allowLiveRequests:true,stage:'staging',apiKey:'test-private-key',
 clock:()=> '2026-10-17T17:00:00Z',transport:async()=>({status:200,data:{routes:[{duration:'300s'}]}})});
test('Google capture requires separate enable, live-request and staging gates',async()=>{
 let count=0;for(const change of [o=>delete o.enabled,o=>o.enabled='true',o=>o.allowLiveRequests=false,o=>o.stage='production']) {
  const o=opts();o.transport=async()=>{count++;};change(o);
  const r=await collect(null,o);assert.ok(['DISABLED','UNVERIFIED'].includes(r.status));
 }
 assert.equal(count,0);
});
test('Google request body uses directed coordinates and duration-only response, no fee gate',async()=>{
 const calls=[],o=opts();o.transport=async r=>{calls.push(r);return {status:200,data:{routes:[{duration:calls.length===1?'300s':'420s'}]}};};
 const s=input(),before=structuredClone(s),r=await collect(s,o);
 assert.equal(r.status,'ROUTE_ESTIMATES_CAPTURED');assert.equal(r.networkRequests,2);
 assert.deepEqual(r.legs.map(l=>l.durationSeconds),[300,420]);assert.deepEqual(s,before);
 assert.deepEqual(calls[0].body.origin,calls[1].body.destination);assert.equal(calls[0].body.routingPreference,'TRAFFIC_UNAWARE');
 assert.ok(!JSON.stringify(r).includes('test-private-key'));assert.ok(!JSON.stringify(r).includes('53.7'));
});
test('two deliveries reserve all six calls before making a request',async()=>{
 const s=input();s.orders.push({orderId:'b',orderType:'delivery'});s.points.b={lat:53.9,lng:-1.8};
 let count=0;const o=opts();o.transport=async()=>{count++;return {status:200,data:{routes:[{duration:'1s'}]}};};
 o.maxRequests=5;assert.equal((await collect(s,o)).reasonCode,'STAGING_REQUEST_BUDGET_EXCEEDED');assert.equal(count,0);
 o.maxRequests=6;const r=await collect(s,o);assert.equal(r.legs.length,6);assert.equal(count,6);
});
test('all locations must validate before any billable request',async()=>{
 for(const change of [s=>s.points.a.lat=null,s=>s.points.a.lng=181,s=>s.points.extra={lat:0,lng:0},
 s=>s.points.a={address:'secret\naddress'},s=>s.points.a={address:'x',lat:1,lng:2}]) {
  const s=input();change(s);let count=0;const o=opts();o.transport=async()=>{count++;};
  assert.equal((await collect(s,o)).status,'UNVERIFIED');assert.equal(count,0);
 }
});
test('public-landmark addresses use provider waypoints without customer records',async()=>{
 const s=require('./staging-delivery/route-test-input.json'),o=opts(),bodies=[];
 o.transport=async r=>{bodies.push(r.body);return {status:200,data:{routes:[{duration:'120s'}]}};};
 const r=await collect(s,o);assert.equal(r.networkRequests,6);
 assert.ok(bodies.every(b=>typeof b.origin.address==='string'&&typeof b.destination.address==='string'));
 assert.ok(!JSON.stringify(r).includes('Morley'));
});
test('HTTP errors, malformed duration and provider errors stop without retries or partial evidence',async()=>{
 for(const response of [{status:429,data:{error:'private'}},{status:200,data:{routes:[]}},
 {status:200,data:{routes:[{duration:null}]}},{status:200,data:{routes:[{duration:'14401s'}]}}]) {
  let calls=0;const o=opts();o.transport=async()=>{calls++;return response;};
  const r=await collect(input(),o);assert.equal(r.status,'UNVERIFIED');assert.equal(calls,1);assert.equal(r.legs,undefined);
  assert.ok(!JSON.stringify(r).includes('private'));
 }
 const o=opts();o.transport=async()=>{throw Error('key and private address');};
 const r=await collect(input(),o);assert.equal(r.networkRequests,1);assert.ok(!JSON.stringify(r).includes('private'));
});
test('capture timestamps are generated after response and assessment follows the whole batch',async()=>{
 const o=opts();let seconds=0;o.transport=async()=>{seconds++;return {status:200,data:{routes:[{duration:'300s'}]}};};
 o.clock=()=>`2026-10-17T17:00:0${seconds}Z`;
 const r=await collect(input(),o);assert.deepEqual(r.legs.map(l=>l.estimatedAt),['2026-10-17T17:00:01Z','2026-10-17T17:00:02Z']);
 assert.equal(r.assessedAt,'2026-10-17T17:00:02Z');
});
test('provider evidence feeds the dated RTK assessment entirely in memory',async()=>{
 const s=structuredClone(require('./fixtures/delivery/integrated-two-stops-input.json'));
 const points={KITCHEN:{lat:53.7,lng:-1.6},A:{lat:53.8,lng:-1.7},B:{lat:53.9,lng:-1.8}};
 const o=opts();o.clock=()=>s.assessedAt;
 o.transport=async r=>{
  const find=w=>Object.keys(points).find(k=>points[k].lat===w.location.latLng.latitude);
  const from=find(r.body.origin),to=find(r.body.destination);
  return {status:200,data:{routes:[{duration:s.legs.find(l=>l.from===from&&l.to===to).durationSeconds+'s'}]}};
 };
 const evidence=await collect({orders:s.orders,points},o);
 assert.equal(evidence.status,'ROUTE_ESTIMATES_CAPTURED');s.legs=evidence.legs;
 const r=require('./master-wok-rtk-delivery-assessment').assessRtkDeliverySnapshot(s,{enabled:true});
 assert.equal(r.status,'SHADOW_RECOMMENDATION');assert.equal(r.recommendation.kind,'COMBINED');
 assert.equal(r.policyId,'rtk-delivery-shadow-2026-10-17-v1');
});
function requestFake({status=200,text='{"routes":[{"duration":"300s"}]}',stalled=false,onRequest=()=>{}}={}) {
 return (url,options,callback)=>{
  onRequest(url,options);
  const req=new EventEmitter();req.destroy=()=>{};
  req.end=()=>{if(stalled)return;queueMicrotask(()=>{
   const res=new EventEmitter();res.statusCode=status;res.resume=()=>{};res.destroy=()=>{};
   callback(res);if(status===200){res.emit('data',Buffer.from(text));res.emit('end');}
  });};return req;
 };
}
test('HTTPS transport fixes destination and field mask and does not follow redirects',async()=>{
 let called=0;const t=createGoogleTransport({request:requestFake({onRequest:(url,o)=>{
  called++;assert.equal(url,'https://routes.googleapis.com/directions/v2:computeRoutes');
  assert.equal(o.headers['X-Goog-FieldMask'],'routes.duration');assert.equal(o.method,'POST');
 }})});assert.equal((await t({body:{},apiKey:'key'})).status,200);assert.equal(called,1);
 await assert.rejects(createGoogleTransport({request:requestFake({status:302})})({body:{},apiKey:'key'}),/ROUTE_TRANSPORT_FAILED/);
});
test('HTTPS transport bounds response size and rejects malformed JSON',async()=>{
 for(const text of ['not json','x'.repeat(65537)])
  await assert.rejects(createGoogleTransport({request:requestFake({text})})({body:{},apiKey:'key'}),/ROUTE_TRANSPORT_FAILED/);
});
test('HTTPS transport has a wall-clock timeout and honours cancellation',async()=>{
 const t=createGoogleTransport({request:requestFake({stalled:true})});
 await assert.rejects(t({body:{},apiKey:'key',timeoutMs:5}),/ROUTE_TRANSPORT_FAILED/);
 const controller=new AbortController(),p=t({body:{},apiKey:'key',signal:controller.signal});controller.abort();
 await assert.rejects(p,/ROUTE_TRANSPORT_FAILED/);
});
