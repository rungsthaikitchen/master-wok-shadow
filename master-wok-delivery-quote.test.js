'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createDeliveryQuoter,RESTAURANT}=require('./master-wok-delivery-quote');
const {calculateCommercialOrder}=require('./master-wok-commercial');
const url='https://hvrqgufqjslvgiohgkvu.supabase.co',key='sb_publishable_fixture';
function fixture(geo={ok:true,customer_lat:53.75,customer_lng:-1.58},route={ok:true,routeMiles:1.4}){
 const calls=[];return {calls,quote:createDeliveryQuoter({supabaseUrl:url,publicKey:key,fetch:async(u,options)=>{
  calls.push({path:new URL(u).pathname,body:JSON.parse(options.body),options});
  if(calls.length===1)return {ok:true,json:async()=>geo};
  if(route instanceof Error)throw route;return {ok:true,json:async()=>route};
 }})};
}
test('delivery derives coordinates from the address and uses the fixed restaurant origin',async()=>{
 const {quote,calls}=fixture();const result=await quote({address:' Fixture address ',subtotalCents:900,customerLatitude:0,routeMiles:0});
 assert.deepEqual(calls[0].body,{customer_address:'Fixture address'});
 assert.deepEqual(calls[1].body,{origin:RESTAURANT,destination:{lat:53.75,lng:-1.58}});
 assert.equal(result.routeMiles,1.4);assert.equal(result.customerLatitude,53.75);assert.ok(result.straightLineMiles<3);
});
test('free delivery still proves radius and avoids the unnecessary route call',async()=>{
 const {quote,calls}=fixture();assert.equal((await quote({address:'Fixture',subtotalCents:3000})).routeMiles,null);assert.equal(calls.length,1);
 const outside=fixture({ok:true,customer_lat:54,customer_lng:-1.58});
 await assert.rejects(()=>outside.quote({address:'Outside',subtotalCents:9000}),/NOT_ELIGIBLE/);assert.equal(outside.calls.length,1);
});
test('unavailable route keeps the existing fee fallback while missing geocoding never bypasses radius',async()=>{
 const {quote}=fixture(undefined,new Error('timeout'));const deliveryQuote=await quote({address:'Fixture',subtotalCents:900});
 const priced=calculateCommercialOrder({orderType:'delivery',preferredTime:'2026-11-04T18:00:00Z',items:[{item_id:'green-curry',qty:1,modifiers:[{id:'chicken'}],spice:1}]},
  {now:'2026-11-01T12:00:00Z',deliveryQuote});assert.equal(priced.header.delivery_fee,3);
 for(const value of [null,'53.75',NaN])await assert.rejects(()=>fixture({ok:true,customer_lat:value,customer_lng:-1.58}).quote({address:'Fixture',subtotalCents:900}),/GEOCODING/);
});
test('quote bootstrap rejects credentials and destinations outside the existing public service contract',()=>{
 for(const config of [{supabaseUrl:'http://staging.invalid',publicKey:key},{supabaseUrl:url,publicKey:'sb_secret_do_not_use'}])assert.throws(()=>createDeliveryQuoter(config));
});

test('only an explicit server-selected override relaxes radius; geocoding remains mandatory',async()=>{
 const geo={ok:true,customer_lat:53.80,customer_lng:-1.58};
 const result=await fixture(geo).quote({address:'Synthetic exception',subtotalCents:900,allowOutsideArea:true});assert.ok(result.straightLineMiles>3);
 await assert.rejects(()=>fixture(geo).quote({address:'Synthetic exception',subtotalCents:900}),/NOT_ELIGIBLE/);
 await assert.rejects(()=>fixture({ok:false}).quote({address:'Synthetic exception',subtotalCents:900,allowOutsideArea:true}),/NOT_ELIGIBLE/);
});
test('public checkout ignores a browser-supplied delivery-area override',async()=>{
 const {createCommercialValidator}=require('./master-wok-commercial-validator');let request;
 const validate=createCommercialValidator({customerResolver:async()=>({id:'fixture',phone:'07800000000'}),quoteDelivery:async input=>{request=input;throw Error('DELIVERY_ADDRESS_NOT_ELIGIBLE');}});
 await assert.rejects(()=>validate({query:async()=>({rows:[]})},{orderType:'delivery',customer:{address:'Synthetic'},items:[{item_id:'green-curry',qty:1,modifiers:[{id:'chicken'}],spice:2}],deliveryAreaOverride:true,allowOutsideArea:true},{now:'2026-11-14T15:00:00Z'}),/NOT_ELIGIBLE/);
 assert.equal(request.allowOutsideArea,undefined);assert.equal(request.deliveryAreaOverride,undefined);
});
