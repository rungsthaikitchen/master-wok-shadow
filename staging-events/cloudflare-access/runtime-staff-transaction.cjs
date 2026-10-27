// Local synthetic Workers -> authenticated receiver -> real embedded Postgres SQL.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {randomUUID}=require('node:crypto');
const {pathToFileURL}=require('node:url');
const {Miniflare,convertV4MiniflareOptions,Response}=require(process.env.MINIFLARE_MODULE||'miniflare');
const {build}=require('esbuild'),{database}=require('../command-route-test-helper.cjs');
(async()=>{
 const {generateKeyPair,exportJWK,SignJWT}=await import(pathToFileURL(__dirname+'/node_modules/jose/dist/webapi/index.js').href);
 const {createSyntheticStaffReceiver}=await import(pathToFileURL(__dirname+'/versioned-staff-command.mjs').href);
 const d=await database();let mf;
 try{
  await d.db.exec(fs.readFileSync(__dirname+'/../staff-command-candidate.sql','utf8'));const f=await d.fixture();
  const issuer='https://synthetic-team.cloudflareaccess.com',origin='https://synthetic-admin.invalid',destination='https://synthetic-command.invalid/v1/staff-command',aud='a'.repeat(64),hopKey='synthetic-runtime-hop-key-12345',actorKey='synthetic-runtime-actor-key-12345';
  const {publicKey,privateKey}=await generateKeyPair('RS256'),key={...await exportJWK(publicKey),kid:'synthetic',alg:'RS256',use:'sig'};
  const token=await new SignJWT({iss:issuer,aud:[aud],sub:'synthetic-staff',type:'app',iat:900,nbf:900,exp:2000}).setProtectedHeader({alg:'RS256',kid:'synthetic'}).sign(privateKey);
  let keyRequests=0,hops=0,applies=0,lost=false;const seen=[];
  const receiver=createSyntheticStaffReceiver({enabled:true,hopKey,nowSeconds:()=>1000,applyCommand:async({actorId,command:c})=>{applies++;return d.call('apply_staff_command',[f.route,c.commandId,actorId,c.orderId,c.expectedRevision,c.action,c.target??null]);}});
  const bundle=await build({stdin:{resolveDir:__dirname,contents:`import {createVersionedStaffHandler} from './versioned-staff-command.mjs';let handler;export default {fetch(request){handler??=createVersionedStaffHandler({enabled:true,audience:${JSON.stringify(aud)},hopKey:${JSON.stringify(hopKey)},actorKey:${JSON.stringify(actorKey)},nowSeconds:()=>1000,sendEnvelope:async envelope=>{const r=await fetch(${JSON.stringify(destination)},{method:'POST',redirect:'manual',credentials:'omit',signal:AbortSignal.timeout(5000),headers:{'Content-Type':'application/json'},body:JSON.stringify(envelope)});const b=await r.json();if(!r.ok)throw Error(b.error);return b;}});return handler(request);}};`},bundle:true,platform:'browser',format:'esm',target:'es2022',write:false});
  const opts=await convertV4MiniflareOptions({modules:true,compatibilityDate:'2026-10-27',script:bundle.outputFiles[0].text,outboundService:async request=>{
   for(const h of ['Cookie','Authorization','Cf-Access-Jwt-Assertion','x-rtk-proxy-secret'])assert.equal(request.headers.get(h),null);
   if(request.url===issuer+'/cdn-cgi/access/certs'){keyRequests++;return new Response(JSON.stringify({keys:[key]}));}
   assert.equal(request.url,destination);assert.equal(request.method,'POST');hops++;const signed=await request.json();seen.push(signed);
   try{const result=await receiver(signed);if(lost){lost=false;return new Response('{"error":"STAFF_TRANSACTION_FAILED"}',{status:503});}return new Response(JSON.stringify(result));}
   catch(e){const code=['STAFF_REVISION_CONFLICT','STAFF_COMMAND_ID_REUSED'].includes(e.message)?e.message:'STAFF_TRANSACTION_FAILED';return new Response(JSON.stringify({error:code}),{status:409});}
  }});
  mf=new Miniflare(opts);const offer=(revision,target=f.day+'T19:30:00Z')=>({version:1,commandId:randomUUID(),orderId:f.booking,expectedRevision:revision,action:'offer',target});
  const send=(body,t=token)=>mf.dispatchFetch(origin+'/admin-api/order-action',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','Cf-Access-Jwt-Assertion':t,Cookie:'PRIVATE=cookie'},body:JSON.stringify(body)});
  const a=offer(2);assert.equal((await send(a,'forged')).status,403);assert.equal(hops,0);
  assert.deepEqual(await(await send(a)).json(),{status:'RECORDED',revision:3});
  const b=offer(3,f.day+'T20:00:00Z');lost=true;assert.equal((await send(b)).status,502);
  assert.deepEqual(await(await send(b)).json(),{status:'ALREADY_RECORDED',revision:4});
  assert.equal((await send({...b,target:f.day+'T20:30:00Z'})).status,409);
  assert.equal((await send(offer(3))).status,409);
  assert.equal((await send({...offer(4),actorId:'a'.repeat(64)})).status,400);
  const cancel={version:1,commandId:randomUUID(),orderId:f.booking,expectedRevision:4,action:'cancel'};assert.equal((await send(cancel)).status,200);
  const before=applies;await assert.rejects(receiver({...seen[0],body:seen[0].body+' '}),/STAFF_ENVELOPE_REFUSED/);assert.equal(applies,before);
  assert.equal(await d.scalar('SELECT event_count FROM master_wok_event_test.streams WHERE id=$1',[f.src]),5);
  assert.equal(await d.scalar('SELECT count(*)::int FROM master_wok_event_test.staff_commands'),3);
  assert.equal(await d.scalar('SELECT count(*)::int FROM master_wok_event_test.reservations WHERE stream_id=$1',[f.src]),0);
  for(const v of [token,'PRIVATE=cookie','synthetic-staff'])assert.equal(JSON.stringify(seen).includes(v),false);
  console.log(JSON.stringify({status:'PASSED',scope:'LOCAL_WORKERD_SIGNED_STAFF_TRANSACTION',cases:9,keyRequests,syntheticServiceRequests:hops,transactionAttempts:applies,staffAuditRows:3,finalEventCount:5,finalReservations:0,productionRequests:0,notifications:0,hostedStagingVerified:false,multiConnectionConcurrencyVerified:false}));
 }finally{if(mf)await mf.dispose();await d.db.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
