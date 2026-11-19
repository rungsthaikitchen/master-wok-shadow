'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {execFileSync}=require('node:child_process'),{createHash}=require('node:crypto');
test('isolated hosted harness authenticates, bounds its fixed cases and never accesses providers or a database',async()=>{
 const token='a'.repeat(64),digest=createHash('sha256').update(token).digest('hex');
 const source=execFileSync(process.execPath,['staging-tests/build-atomic-checkout-edge.cjs','availability-performance-edge.js'],{
  cwd:__dirname,encoding:'utf8',maxBuffer:1024*1024,env:{...process.env,
   MASTER_WOK_CERTIFICATION_TOKEN:digest,MASTER_WOK_BROWSER_EXPIRES:'2099-01-01T00:00:00Z'}});
 let handler;const envReads=[];
 const context={Response,Request,URL,TextEncoder,TextDecoder,Date,Intl,crypto:globalThis.crypto,structuredClone,performance,
  fetch:()=>{throw Error('PROVIDER_TRAFFIC_FORBIDDEN');},Deno:{env:{get:key=>{envReads.push(key);
   assert.equal(key,'SUPABASE_URL');return 'https://hvrqgufqjslvgiohgkvu.supabase.co';}},serve:fn=>{handler=fn;}}};
 vm.runInNewContext(source,context,{timeout:1000});
 const call=(input,secret=token)=>handler(new Request('https://fixture.invalid/',{method:'POST',
  headers:{'x-rehearsal-token':secret,'Content-Type':'application/json'},body:JSON.stringify(input)}));
 assert.equal((await call({kind:'heavy',start:0,count:6},'b'.repeat(64))).status,401);
 assert.equal((await call({kind:'heavy',start:0,count:61})).status,400);
 const response=await call({kind:'heavy',start:0,count:6});assert.equal(response.status,200);
 const result=await response.json();assert.equal(result.hints.length,6);
 assert.ok(result.hints.every(h=>h.status==='UNVERIFIED'&&h.reason==='FIXED_VESSEL_CAPACITY_EXCEEDED'));
 // These opening slots depended on the former chips-in-small-woks model.
 assert.equal(result.databaseRequests+result.notifications+result.bookings,0);
 assert.ok(envReads.length>0);
 const fixture=JSON.stringify(require('./staging-tests/availability-service-fixture.json'));
 assert.doesNotMatch(fixture,/RTK-|[a-f0-9]{8}-[a-f0-9]{4}-/);
});
