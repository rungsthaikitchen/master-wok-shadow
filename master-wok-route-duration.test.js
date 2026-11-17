'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createRouteDurationQuoter}=require('./master-wok-route-duration');
const points={origin:{lat:53.744437,lng:-1.57657},destination:{lat:53.75,lng:-1.58}};
function fixture(body){let calls=0;return {count:()=>calls,quote:createRouteDurationQuoter({supabaseUrl:'https://hvrqgufqjslvgiohgkvu.supabase.co',publicKey:'sb_publishable_fixture',fetch:async()=>{calls++;return {ok:true,json:async()=>body};}})};}
test('existing Google duration contract is parsed and cached by direction',async()=>{
 const f=fixture({ok:true,duration:'374.5s'});assert.deepEqual(await f.quote(points),{durationSeconds:374.5});await f.quote(points);assert.equal(f.count(),1);
 await f.quote({origin:points.destination,destination:points.origin});assert.equal(f.count(),2);
});
test('missing duration cannot be replaced by pricing distance or cached as success',async()=>{
 for(const body of [{ok:true,routeMiles:1},{ok:true,duration:'0s'},{ok:true,duration:'-2s'},{ok:false,duration:'300s'},{ok:true,duration:300}]){
  const f=fixture(body);await assert.rejects(()=>f.quote(points),/TRAVEL_TIME_UNAVAILABLE/);await assert.rejects(()=>f.quote(points));assert.equal(f.count(),2);
 }
});

test('the kitchen address zero-route response retains a conservative positive driver leg',async()=>{
 const nearby={origin:points.origin,destination:{lat:53.7444789,lng:-1.576501}};
 for(const body of [{ok:true,duration:'0s',distanceMeters:0},{ok:false,error:'No route distance returned',details:{routes:[{duration:'0s'}]}}]){
  let calls=0;const quote=createRouteDurationQuoter({supabaseUrl:'https://hvrqgufqjslvgiohgkvu.supabase.co',publicKey:'sb_publishable_fixture',
   fetch:async()=>{calls++;return {ok:body.ok,status:body.ok?200:502,json:async()=>body};}});
  assert.deepEqual(await quote(nearby),{durationSeconds:60});await quote(nearby);assert.equal(calls,1);
  await assert.rejects(quote(points),/TRAVEL_TIME_UNAVAILABLE/);
 }
});
test('a nearby destination does not excuse provider errors or missing duration',async()=>{
 for(const body of [{ok:false,error:'Google route lookup failed'},
  {ok:false,error:'No route distance returned',details:{routes:[{duration:'1s'}]}},
  {ok:false,error:'No route distance returned',details:{routes:[{duration:'0s',distanceMeters:500}]}}]){
  const quote=createRouteDurationQuoter({supabaseUrl:'https://hvrqgufqjslvgiohgkvu.supabase.co',publicKey:'sb_publishable_fixture',
   fetch:async()=>({ok:false,status:502,json:async()=>body})});
  await assert.rejects(quote({origin:points.origin,destination:points.origin}),/TRAVEL_TIME_UNAVAILABLE/);
 }
});
