import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {exportJWK,generateKeyPair,SignJWT} from 'jose';
const bundleFile=new URL('./deployment/access-check.js',import.meta.url);
test('exact deployed bundle verifies identity, contains no booking transport, and expires without requests',async()=>{
 const source=fs.readFileSync(bundleFile,'utf8');
 const raw=source.match(/var probeConfig = \(?((?:\{)[^\n]+(?:\}))\)?;/);assert.ok(raw,'generated deployment configuration');
 const config=JSON.parse(raw[1]);assert.equal(config.enabled,true);assert.ok(Number.isSafeInteger(config.endEpoch));
 for(const text of ['order-backend-production','supabase.co','x-admin-secret','x-rtk-proxy-secret','console.log','onRequestPost'])assert.equal(source.includes(text),false,text);
 const {publicKey,privateKey}=await generateKeyPair('RS256');const key={...await exportJWK(publicKey),kid:'synthetic',alg:'RS256',use:'sig'};
 // Freeze the diagnostic build's clock so this regression remains runnable after expiry.
 const now=config.endEpoch-1000;const token=await new SignJWT({iss:config.teamDomain,aud:[config.audience],sub:'synthetic-private-human',email:'PRIVATE@example.invalid',type:'app',iat:now-10,nbf:now-10,exp:now+300}).setProtectedHeader({alg:'RS256',kid:'synthetic'}).sign(privateKey);
 let fetches=0;const originalFetch=globalThis.fetch,originalNow=Date.now;
 try{
  Date.now=()=>0;
  globalThis.fetch=async(url,init)=>{fetches++;assert.equal(String(url),config.teamDomain+'/cdn-cgi/access/certs');assert.equal(init.method,'GET');assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');return new Response(JSON.stringify({keys:[key]}),{status:200});};
  const {onRequest}=await import(bundleFile);
  // Worker module validation may occur before a request clock exists.
  assert.equal(fetches,0);Date.now=()=>now*1000;
  const request=()=>new Request(config.requestOrigin+'/admin-api/access-check',{headers:{'Cf-Access-Jwt-Assertion':token}});
  const r=await onRequest({request:request()});assert.equal(r.status,200);const body=await r.text();assert.equal(JSON.parse(body).status,'VERIFIED');assert.equal(body.includes('PRIVATE'),false);assert.equal(body.includes('synthetic-private-human'),false);assert.equal(fetches,1);
  assert.equal((await onRequest({request:new Request(config.requestOrigin+'/admin-api/access-check',{method:'POST'})})).status,405);assert.equal(fetches,1);
  Date.now=()=>config.endEpoch*1000;
  assert.equal((await onRequest({request:request()})).status,410);assert.equal(fetches,1);
 }finally{globalThis.fetch=originalFetch;Date.now=originalNow;}
});
