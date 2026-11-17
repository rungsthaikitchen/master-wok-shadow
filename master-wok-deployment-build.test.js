'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {execFileSync}=require('node:child_process');
test('actual release bundle serves no booking endpoint with an explicit draft and never connects to PostgreSQL',async()=>{
 const built=execFileSync(process.execPath,['staging-tests/build-atomic-checkout-edge.cjs','--release'],{cwd:__dirname,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:1024*1024});
 const published=require('./master-wok-release-candidate.json');
 const marker='module.exports='+JSON.stringify(published)+';';
 assert.ok(built.includes(marker));
 const source=built.replace(marker,'module.exports='+JSON.stringify({...published,status:'DRAFT'})+';');
 let handler,connections=0;
 const env={SUPABASE_URL:'https://ubyjrrsvbbqomitpaidb.supabase.co',SUPABASE_DB_URL:'postgres://unused.invalid/db',
  MASTER_WOK_RELEASE_ID:'master-wok-launch-2026-11-03',MASTER_WOK_BOOKING_SECRET:'a'.repeat(64),
  MASTER_WOK_NOTIFICATION_SECRET:'b'.repeat(64),MASTER_WOK_DELIVERY_PUBLIC_KEY:'sb_publishable_fixture'};
 const context={Response,Request,URL,TextEncoder,TextDecoder,Date,Intl,Map,Set,crypto:globalThis.crypto,
  structuredClone,atob,AbortSignal,fetch:()=>{throw Error('no provider traffic');},
  Deno:{env:{get:key=>env[key]},serve:run=>{handler=run;}},
  pgFixture:{Pool:class{connect(){connections++;throw Error('no DB connection');}}}};
 vm.runInNewContext(source.replace("import pg from 'npm:pg@8.23.1';",'const pg=pgFixture;'),context,{timeout:1000});
 const response=await handler(new Request('https://release.invalid/',{method:'POST',body:'{}'}));
 assert.equal(response.status,503);assert.equal((await response.json()).error,'RELEASE_NOT_CERTIFIED_OR_CONFIGURED');
 assert.equal(connections,0);assert.equal(response.headers.get('cache-control'),'no-store');
 assert.ok(!source.includes('__RUNTIME_SOURCE_SHA256__'));
});

test('the current availability production draft binds the tested source but cannot serve bookings or connect to the database',async()=>{
 const certificate=require('./master-wok-release-candidate.availability.production.json');
 const result=execFileSync(process.execPath,['staging-tests/build-atomic-checkout-edge.cjs','--release-availability'],{cwd:__dirname,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:1024*1024});
 assert.equal(certificate.status,'DRAFT');assert.ok(Object.values(certificate.checks).every(x=>x==='PENDING'));
 assert.equal(certificate.sourceSha256,require('./master-wok-release-candidate.staging.json').sourceSha256);
 let handler,connections=0;
 const env={SUPABASE_URL:'https://ubyjrrsvbbqomitpaidb.supabase.co',SUPABASE_DB_URL:'postgres://unused.invalid/db',MASTER_WOK_RELEASE_ID:certificate.releaseId,
  MASTER_WOK_BOOKING_SECRET:'a'.repeat(64),MASTER_WOK_NOTIFICATION_SECRET:'b'.repeat(64),MASTER_WOK_DELIVERY_PUBLIC_KEY:'sb_publishable_fixture',MASTER_WOK_PAYMENTS:'enabled',MASTER_WOK_REVIEW_APPROVALS:'enabled'};
 vm.runInNewContext(result.replace("import pg from 'npm:pg@8.23.1';",'const pg=pgFixture;'),{
  Response,Request,URL,TextEncoder,TextDecoder,Date,Intl,Map,Set,crypto:globalThis.crypto,structuredClone,atob,AbortSignal,
  fetch:()=>assert.fail('no provider request from a draft'),Deno:{env:{get:key=>env[key]},serve:fn=>{handler=fn;}},
  pgFixture:{Pool:class{connect(){connections++;throw Error('draft must not connect');}}}},{timeout:1000});
 const response=await handler(new Request('https://draft.invalid/',{method:'POST',body:'{}'}));
 assert.equal(response.status,503);assert.equal(connections,0);assert.equal((await response.json()).error,'RELEASE_NOT_CERTIFIED_OR_CONFIGURED');
});
