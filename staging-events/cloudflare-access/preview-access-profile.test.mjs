import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {PREVIEW_ACCESS,createPreviewAccessGate} from './preview-access-profile.mjs';
const pair=await generateKeyPair('RS256');
const jwk={...await exportJWK(pair.publicKey),kid:'fixture',alg:'RS256',use:'sig'};
const oldAudience='d29d9159669da2346f9a5aacb672bd24cb83ea4b2b8a6959e5f841a0488d501c';
const sign=(extra={})=>new SignJWT({iss:PREVIEW_ACCESS.teamDomain,aud:[PREVIEW_ACCESS.audience],sub:'synthetic-human',type:'app',iat:900,nbf:900,exp:1800,...extra}).setProtectedHeader({alg:'RS256',kid:'fixture'}).sign(pair.privateKey);
const request=(token,origin=PREVIEW_ACCESS.requestOrigin)=>new Request(origin+'/admin-api/staff-state-v1',{method:'POST',headers:{origin,'content-type':'application/json','cf-access-jwt-assertion':token},body:'{}'});
function setup(extra={}){
 const calls={keys:0,authorized:0};
 const gate=createPreviewAccessGate({enabled:true,requestPath:'/admin-api/staff-state-v1',nowSeconds:()=>1000,fetcher:async(url,init)=>{
  calls.keys++;assert.equal(String(url),PREVIEW_ACCESS.teamDomain+'/cdn-cgi/access/certs');assert.equal(init.redirect,'manual');assert.equal(init.credentials,'omit');
  return new Response(JSON.stringify({keys:[jwk]}));
 },onAuthorized:async()=>{calls.authorized++;return new Response('VERIFIED_SYNTHETIC_TOKEN');},...extra});
 return {calls,gate};
}
test('preview profile stays disabled by default',async()=>{
 const gate=createPreviewAccessGate({onAuthorized:()=>{throw Error('called');}});
 assert.deepEqual(await gate(null),{status:'DISABLED',sourceRequests:0,verified:false});
});
test('preview audience accepts a locally signed fixture, without real network or data access',async()=>{
 const s=setup();assert.equal((await s.gate(request(await sign()))).status,200);assert.deepEqual(s.calls,{keys:1,authorized:1});
});
test('production audience and another issuer cannot authorize preview',async()=>{
 for(const claims of [{aud:[oldAudience]},{iss:'https://other.cloudflareaccess.com'}]){
  const s=setup(),token=await sign(claims);await assert.rejects(()=>s.gate(request(token)),/CLOUDFLARE_ACCESS_REFUSED/);assert.equal(s.calls.authorized,0);
 }
});
test('another preview hostname is refused before fetching keys',async()=>{
 const s=setup(),token=await sign();await assert.rejects(()=>s.gate(request(token,'https://other.rungsthaikitchen.pages.dev')),/CLOUDFLARE_ACCESS_REFUSED/);assert.deepEqual(s.calls,{keys:0,authorized:0});
});
test('caller cannot replace pinned audience, issuer or origin',async()=>{
 const s=setup({audience:oldAudience,teamDomain:'https://other.cloudflareaccess.com',requestOrigin:'https://other.invalid'});
 assert.equal((await s.gate(request(await sign()))).status,200);
});
