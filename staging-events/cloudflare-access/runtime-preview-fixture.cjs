// workerd -> fixed HTTP adapter -> signed receiver -> local SQL. No hosted calls.
const fs=require('node:fs'),assert=require('node:assert/strict'),{randomBytes,randomUUID}=require('node:crypto');
const {database}=require('../command-route-test-helper.cjs');
const {Miniflare,convertV4MiniflareOptions,Response}=require(process.env.MINIFLARE_MODULE||'miniflare');
(async()=>{
 const {build}=await import('esbuild'),{generateKeyPair,exportJWK,SignJWT}=await import('jose');
 const {PREVIEW_ACCESS:P}=await import('./preview-access-profile.mjs');
 const {createPreviewFixtureReceiver}=await import('./preview-fixture-protocol.mjs');
 const d=await database();let mf;
 try{
  await d.db.exec(fs.readFileSync(__dirname+'/../staff-command-candidate.sql','utf8'));const f=await d.fixture();
  const hopKey=randomBytes(32).toString('hex'),actorKey=randomBytes(32).toString('hex'),fixture={orderId:f.booking,targets:['19:00','19:30','20:00'].map(t=>f.day+'T'+t+':00Z')};
  const endpoint='https://synthetic-fixture.up.railway.app/staging/preview-fixture-v1';
  let budgets=0,serviceCalls=0,keyCalls=0;
  const receiver=createPreviewFixtureReceiver({enabled:true,fixture,endEpoch:1600,nowSeconds:()=>1000,hopKey,takeBudget:async()=>{if(++budgets>10)throw Error('LIMIT');},readState:async orderId=>({orderId,revision:2,status:'proposed',target:fixture.targets[0],proposalTargets:fixture.targets}),applyCommand:async({actorId,command:c})=>d.call('apply_staff_command',[f.route,c.commandId,actorId,c.orderId,c.expectedRevision,c.action,c.target??null])});
  const source=`import {createPreviewFixtureApi} from './preview-fixture-api.mjs';import {createPreviewFixtureHttp} from './preview-fixture-http.mjs';let handler;export default {fetch(request){handler??=createPreviewFixtureApi({enabled:true,fixture:${JSON.stringify(fixture)},endEpoch:1600,nowSeconds:()=>1000,hopKey:${JSON.stringify(hopKey)},actorKey:${JSON.stringify(actorKey)},sendEnvelope:createPreviewFixtureHttp({enabled:true,endpoint:${JSON.stringify(endpoint)}})});return handler(request);}};`;
  const built=await build({stdin:{contents:source,resolveDir:__dirname},bundle:true,write:false,platform:'browser',format:'esm',target:'es2022'});
  const pair=await generateKeyPair('RS256'),jwk={...await exportJWK(pair.publicKey),kid:'synthetic',alg:'RS256',use:'sig'};
  const token=await new SignJWT({iss:P.teamDomain,aud:[P.audience],sub:'synthetic-staff',type:'app',iat:900,nbf:900,exp:2000}).setProtectedHeader({alg:'RS256',kid:'synthetic'}).sign(pair.privateKey);
  const opts=await convertV4MiniflareOptions({modules:true,compatibilityDate:'2026-10-27',script:built.outputFiles[0].text,outboundService:async request=>{
   assert.equal(request.headers.get('Cookie'),null);assert.equal(request.headers.get('Authorization'),null);
   if(request.url===P.teamDomain+'/cdn-cgi/access/certs'){keyCalls++;assert.equal(request.method,'GET');return new Response(JSON.stringify({keys:[jwk]}));}
   assert.equal(request.url,endpoint);assert.equal(request.method,'POST');serviceCalls++;const r=await receiver(await request.json());return new Response(JSON.stringify(r),{headers:{'Content-Type':'application/json'}});
  }});
  mf=new Miniflare(opts);
  const send=(path,input,auth=token)=>mf.dispatchFetch(P.requestOrigin+path,{method:'POST',headers:{Origin:P.requestOrigin,'Content-Type':'application/json','Cf-Access-Jwt-Assertion':auth},body:JSON.stringify(input)});
  assert.equal((await send('/admin-api/staff-state-v1',{orderId:f.booking},'forged')).status,403);assert.equal(keyCalls,0);assert.equal(serviceCalls,0);
  assert.equal((await send('/admin-api/staff-state-v1',{orderId:f.booking})).status,200);
  const c={version:1,commandId:randomUUID(),orderId:f.booking,expectedRevision:2,action:'offer',target:fixture.targets[1]};
  assert.deepEqual(await(await send('/admin-api/staff-command-v1',c)).json(),{status:'RECORDED',revision:3});
  assert.deepEqual(await(await send('/admin-api/staff-command-v1',c)).json(),{status:'ALREADY_RECORDED',revision:3});
  assert.equal(await d.scalar('SELECT count(*)::int FROM master_wok_event_test.staff_commands'),1);assert.equal(await d.scalar('SELECT count(*)::int FROM master_wok_event_test.reservations WHERE stream_id=$1',[f.src]),1);
  assert.equal(serviceCalls,3);assert.equal(budgets,3);
  console.log(JSON.stringify({runtime:'workerd',status:'PASSED',cases:4,keyRequests:keyCalls,signedServiceRequests:serviceCalls,auditRows:1,externalRequests:0,productionRequests:0,notifications:0,hostedConnectionVerified:false}));
 }finally{if(mf)await mf.dispose();await d.db.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
