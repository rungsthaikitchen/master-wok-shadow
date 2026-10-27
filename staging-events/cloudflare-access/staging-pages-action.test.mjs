import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {createStagingPagesAction,STAGING_ORIGIN,STAGING_ISSUER,STAGING_DESTINATION} from './staging-pages-action.mjs';
const {publicKey,privateKey}=await generateKeyPair('RS256');
const key={...await exportJWK(publicKey),kid:'synthetic',alg:'RS256',use:'sig'},aud='a'.repeat(64),secret='synthetic-service-secret-12345';
const token=await new SignJWT({iss:STAGING_ISSUER,aud:[aud],sub:'synthetic-staff',type:'app',iat:900,nbf:900,exp:2000}).setProtectedHeader({alg:'RS256',kid:'synthetic'}).sign(privateKey);
const orderId='12345678-1234-1234-1234-123456789abc';
const request=(payload,headers={})=>new Request(STAGING_ORIGIN+'/admin-api/order-action',{method:'POST',headers:{Origin:STAGING_ORIGIN,'Content-Type':'application/json','Cf-Access-Jwt-Assertion':token,Cookie:'PRIVATE=session',Authorization:'Bearer PRIVATE',...headers},body:JSON.stringify(payload)});
function setup(reply=()=>new Response('{"success":true}')){
 const calls=[];
 const handler=createStagingPagesAction({enabled:true,audience:aud,serviceSecret:secret,nowSeconds:()=>1000,fetcher:async(url,init)=>{
  const req=new Request(url,init); // Also exercise standard request construction.
  assert.equal(req.redirect,'manual');assert.equal(req.headers.has('Cookie'),false);assert.equal(req.headers.has('Authorization'),false);assert.equal(req.headers.has('Cf-Access-Jwt-Assertion'),false);
  if(String(url)===STAGING_ISSUER+'/cdn-cgi/access/certs'){assert.equal(req.headers.has('x-rtk-proxy-secret'),false);return new Response(JSON.stringify({keys:[key]}));}
  assert.equal(String(url),STAGING_DESTINATION);assert.equal(req.method,'POST');assert.equal(req.headers.get('x-rtk-proxy-secret'),secret);assert.equal(req.headers.get('Content-Type'),'application/json');assert.ok(init.signal instanceof AbortSignal);
  calls.push(await req.json());return reply();
 }});return {handler,calls};
}
test('staging adapter defaults off before reading secrets or request',async()=>{const h=createStagingPagesAction({get serviceSecret(){throw Error('read');}});assert.equal((await h({})).status,503);});
test('only synthetic service credentials accepted; destinations cannot be supplied by caller',()=>{assert.throws(()=>createStagingPagesAction({enabled:true,serviceSecret:'real-key'}),/SYNTHETIC_SERVICE_CONFIGURATION_REQUIRED/);});
test('all existing UI payloads reach the fixed service hop without browser credentials',async()=>{
 const s=setup();const payloads=[{action:'accept',orderId},{action:'decline',orderId,reason:'Synthetic refusal'},{action:'suggest_time',orderId,proposedTime:'2026-10-28T19:00:00Z'},{action:'complete',orderId},{action:'mark_paid',orderId}];
 for(const p of payloads)assert.equal((await s.handler(request(p))).status,200);assert.deepEqual(s.calls,payloads);
});
test('invalid identity, cross-origin and caller destination injection never reach service',async()=>{
 const s=setup();assert.equal((await s.handler(request({action:'accept',orderId},{'Cf-Access-Jwt-Assertion':'forged'}))).status,403);
 assert.equal((await s.handler(request({action:'accept',orderId},{Origin:'https://other.invalid'}))).status,403);
 assert.equal((await s.handler(request({action:'accept',orderId,destination:'https://production.invalid'}))).status,400);assert.equal(s.calls.length,0);
});
test('repeated UI requests remain repeated service requests; proxy does not invent idempotency',async()=>{const s=setup();const p={action:'accept',orderId};await s.handler(request(p));await s.handler(request(p));assert.deepEqual(s.calls,[p,p]);});
test('upstream redirect, timeout and conflict never trigger retry or false success',async()=>{
 for(const [reply,status] of [[()=>new Response(null,{status:307,headers:{Location:'https://production.invalid'}}),502],[()=>{throw new DOMException('PRIVATE secret','TimeoutError');},502],[()=>new Response('{"error":"REVISION_CONFLICT"}',{status:409}),409]]){
  const s=setup(reply);const r=await s.handler(request({action:'complete',orderId}));assert.equal(r.status,status);assert.equal(s.calls.length,1);assert.equal((await r.text()).includes('PRIVATE'),false);
 }
});
