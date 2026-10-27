// Exact temporary bundle in workerd; all key traffic intercepted locally.
const fs=require('node:fs'),assert=require('node:assert/strict');
const {Miniflare,convertV4MiniflareOptions,Response}=require(process.env.MINIFLARE_MODULE||'miniflare');
(async()=>{
 const {build}=await import('esbuild');
 const {generateKeyPair,exportJWK,SignJWT}=await import('jose');
 const config=JSON.parse(fs.readFileSync(__dirname+'/deployment/preview-access-check.json','utf8'));
 const built=await build({stdin:{contents:"import {onRequest} from './deployment/preview-access-check.js';export default {fetch(request){return onRequest({request});}}",resolveDir:__dirname},bundle:true,write:false,platform:'browser',format:'esm',target:'es2022'});
 const {publicKey,privateKey}=await generateKeyPair('RS256'),key={...await exportJWK(publicKey),kid:'synthetic',alg:'RS256',use:'sig'};
 const now=Math.floor(Date.now()/1000);assert.ok(now<config.endEpoch,'Temporary artifact expired: do not silently extend it');
 const token=await new SignJWT({iss:config.teamDomain,aud:[config.audience],sub:'synthetic-human',type:'app',iat:now-1,nbf:now-1,exp:now+600}).setProtectedHeader({alg:'RS256',kid:'synthetic'}).sign(privateKey);
 let calls=0;
 const opts=await convertV4MiniflareOptions({modules:true,compatibilityDate:'2026-10-27',script:built.outputFiles[0].text,outboundService:async request=>{
  calls++;assert.equal(request.url,config.teamDomain+'/cdn-cgi/access/certs');assert.equal(request.method,'GET');assert.equal(request.headers.get('Cookie'),null);assert.equal(request.headers.get('Authorization'),null);
  return new Response(JSON.stringify({keys:[key]}));
 }});
 const mf=new Miniflare(opts);
 try{
  const url=config.requestOrigin+'/admin-api/access-check';
  assert.equal((await mf.dispatchFetch(url)).status,403);assert.equal(calls,0);
  assert.equal((await mf.dispatchFetch(url,{method:'POST'})).status,405);assert.equal(calls,0);
  const r=await mf.dispatchFetch(url,{headers:{'Cf-Access-Jwt-Assertion':token}});
  assert.equal(r.status,200);assert.deepEqual(await r.json(),{status:'VERIFIED',scope:'ACCESS_READ_ONLY_PROBE',bookingRequests:0,databaseRequests:0,notifications:0});assert.equal(calls,1);
  console.log(JSON.stringify({runtime:'workerd',status:'PASSED',keyRequests:calls,bookingRequests:0,databaseRequests:0,notifications:0,realAccessVerified:false}));
 }finally{await mf.dispose();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
