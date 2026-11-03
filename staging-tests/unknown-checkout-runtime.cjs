'use strict';
// Existing browser client against the deployed private runtime. A transport
// adapter mirrors Pages/gateway contracts; this is not a hosted Cloudflare UI test.
const fs=require('node:fs'),assert=require('node:assert/strict');
const siteRoot=process.env.MASTER_WOK_WEBSITE_SOURCE;
if(!siteRoot)throw Error('COMPANION_WEBSITE_SOURCE_REQUIRED');
const {createClient}=require(require('node:path').join(siteRoot,'master-wok-checkout-client.js'));
const {calculateCommercialOrder}=require('../master-wok-commercial');
const config=JSON.parse(fs.readFileSync(process.env.MASTER_WOK_PRIVATE_CONFIG_FILE,'utf8'));
const path='/tmp/mw-unknown-runtime-proof.json',restore=process.argv[2]==='--restored',draining=process.argv[2]==='--draining',continuing=restore||draining;
const proof=continuing?JSON.parse(fs.readFileSync(path)):{legacyRoutes:0};
const values=new Map(continuing?Object.entries(proof.storage):[]);
const storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
const input=continuing?proof.input:{orderType:'collection',preferredTime:'2026-11-07T18:00:00Z',
 customer:{name:'Unknown outcome fixture',phone:'07700900123',email:'release-nov3-candidate@example.invalid'},
 communicationPreference:'email',items:[{item_id:'green-curry',qty:1,modifiers:[{id:'chicken'}],spice:1}]};
if(!continuing)input.expectedTotals=calculateCommercialOrder(input,{now:new Date()}).header;
const transport=async(url,options={})=>{
 if(url==='/api/booking-mode')return fetch('https://master-wok-booking-gateway-staging-master-wok-staging.up.railway.app/booking-mode');
 const operation='checkout';
 const payload=operation==='checkout'?JSON.parse(options.body):undefined;
 const r=await fetch('https://hvrqgufqjslvgiohgkvu.supabase.co/functions/v1/master-wok-booking',{
  method:'POST',headers:{'content-type':'application/json','x-master-wok-secret':config.MASTER_WOK_BOOKING_SECRET},body:JSON.stringify({operation,payload})});
 const b=await r.json();
 if(operation==='checkout'&&!continuing){assert.equal(b.success,true);proof.committedOrderId=b.orderId;throw Error('Fixture: response lost after server commit');}
 return new Response(JSON.stringify(b),{status:r.status,headers:{'content-type':'application/json'}});
};
const client=createClient({fetch:transport,storage,crypto:{subtle:globalThis.crypto.subtle,randomUUID:()=> 'release-nov3-candidate-unknown'},hostname:'rungsthaikitchen.co.uk'});
(async()=>{
 let message='';try{const r=await client.submit(input);if(r.route==='LEGACY')proof.legacyRoutes++;}catch(e){message=e.message;}
 assert.equal(proof.legacyRoutes,0);assert.ok(values.size>0);
 assert.ok(message.includes(draining?'earlier checkout':restore?'previous order':'confirm the result'),message);
 proof.input=input;proof.storage=Object.fromEntries(values);proof[draining?'drainRetainsUnknownKey':restore?'legacyRestoreBlocksDuplicate':'unknownResponseKeepsOriginalKey']=true;
 fs.writeFileSync(path,JSON.stringify(proof,null,2));console.log(draining?'PASS: deployed gateway drain preserves browser uncertainty':restore?'PASS: restored legacy mode refuses duplicate checkout with pending key':'PASS: real committed order remains unknown to browser; original key retained');
})().catch(e=>{console.error(e.message);process.exitCode=1});
