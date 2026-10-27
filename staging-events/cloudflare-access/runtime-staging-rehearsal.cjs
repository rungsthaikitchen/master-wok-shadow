// Synthetic-only Cloudflare runtime rehearsal. Every outbound request is intercepted.
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {Miniflare,convertV4MiniflareOptions,Response}=require(process.env.MINIFLARE_MODULE||'miniflare');
const {build}=require('esbuild');
(async()=>{
 const {generateKeyPair,exportJWK,SignJWT}=await import(pathToFileURL(__dirname+'/node_modules/jose/dist/webapi/index.js').href);
 const issuer='https://synthetic-team.cloudflareaccess.com',origin='https://synthetic-admin.invalid',destination='https://synthetic-railway.invalid/admin-order-action',aud='a'.repeat(64),secret='synthetic-runtime-secret-12345';
 const {publicKey,privateKey}=await generateKeyPair('RS256');
 const key={...await exportJWK(publicKey),kid:'synthetic',alg:'RS256',use:'sig'};
 const token=await new SignJWT({iss:issuer,aud:[aud],sub:'synthetic-staff',type:'app',iat:900,nbf:900,exp:2000}).setProtectedHeader({alg:'RS256',kid:'synthetic'}).sign(privateKey);
 const bundle=await build({stdin:{contents:`import {createStagingPagesAction} from './staging-pages-action.mjs';let handler;export default {fetch(request){handler??=createStagingPagesAction({enabled:true,audience:${JSON.stringify(aud)},serviceSecret:${JSON.stringify(secret)},nowSeconds:()=>1000});return handler(request);}};`,resolveDir:__dirname},bundle:true,platform:'browser',format:'esm',target:'es2022',write:false});
 const calls=[];let keyRequests=0,mode='success';
 const opts=await convertV4MiniflareOptions({modules:true,compatibilityDate:'2026-10-27',script:bundle.outputFiles[0].text,outboundService:async request=>{
  assert.equal(request.headers.get('Cookie'),null);assert.equal(request.headers.get('Authorization'),null);assert.equal(request.headers.get('Cf-Access-Jwt-Assertion'),null);
  if(request.url===issuer+'/cdn-cgi/access/certs'){keyRequests++;assert.equal(request.headers.get('x-rtk-proxy-secret'),null);return new Response(JSON.stringify({keys:[key]}));}
  assert.equal(request.url,destination);assert.equal(request.method,'POST');assert.equal(request.headers.get('x-rtk-proxy-secret'),secret);calls.push(await request.json());
  if(mode==='redirect')return new Response(null,{status:307,headers:{Location:'https://production.invalid/'}});
  if(mode==='conflict')return new Response('{"error":"REVISION_CONFLICT"}',{status:409});
  if(mode==='timeout')await new Promise(resolve=>setTimeout(resolve,6000));
  if(mode==='server-error')return new Response('{"error":"SYNTHETIC_SERVER_ERROR"}',{status:500});
  return new Response('{"success":true}',{headers:{'Set-Cookie':'PRIVATE=never-forward'}});
 }});
 const mf=new Miniflare(opts);let assertions=0;
 const orderId='12345678-1234-1234-1234-123456789abc';
 async function send(payload,headers={}){return mf.dispatchFetch(origin+'/admin-api/order-action',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','Cf-Access-Jwt-Assertion':token,Cookie:'PRIVATE=cookie',Authorization:'Bearer PRIVATE',...headers},body:JSON.stringify(payload)});}
 try{
  const payloads=[{action:'accept',orderId},{action:'decline',orderId,reason:'Synthetic refusal'},{action:'suggest_time',orderId,proposedTime:'2026-10-28T19:00:00Z'},{action:'complete',orderId},{action:'mark_paid',orderId}];
  for(const p of payloads){const r=await send(p);assert.equal(r.status,200,JSON.stringify({body:await r.clone().text(),keyRequests,calls:calls.length}));assert.equal(r.headers.get('Set-Cookie'),null);assert.equal(r.headers.get('Cache-Control'),'no-store');assert.deepEqual(await r.json(),{success:true});assertions++;}
  assert.deepEqual(calls,payloads);
  for(const headers of [{'Cf-Access-Jwt-Assertion':'forged'},{Origin:'https://other.invalid'}]){assert.equal((await send(payloads[0],headers)).status,403);assertions++;}
  assert.equal((await send({...payloads[0],actor:'injected'})).status,400);assert.equal(calls.length,5);assertions++;
  await send(payloads[0]);await send(payloads[0]);assert.equal(calls.length,7);assert.deepEqual(calls.slice(-2),[payloads[0],payloads[0]]);assertions++;
  for(const [next,status]of [['redirect',502],['conflict',409],['server-error',500],['timeout',502]]){mode=next;const before=calls.length;const r=await send(payloads[0]);assert.equal(r.status,status);assert.equal(calls.length,before+1);assert.equal((await r.text()).includes(secret),false);assertions++;}
  console.log(JSON.stringify({status:'PASSED',scope:'SYNTHETIC_LOCAL_WORKERD_SERVICE_HOP',cases:assertions,keyRequests,syntheticActionRequests:calls.length,productionRequests:0,databaseRequests:0,notifications:0,idempotency:'FORWARDING_ONLY_NOT_TRANSACTION_VERIFICATION',hostedStagingVerified:false}));
 }finally{await mf.dispose();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
