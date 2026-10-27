import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {PREVIEW_ACCESS} from './preview-access-profile.mjs';
// Exercise the exact standalone deployment bundle with synthetic signatures.
test('temporary preview bundle verifies only pinned identity and expires without transport',async()=>{
 const root=new URL('deployment/',import.meta.url);
 const source=fs.readFileSync(new URL('preview-access-check.js',root),'utf8');
 const m=JSON.parse(fs.readFileSync(new URL('preview-access-check.json',root),'utf8'));
 assert.equal(createHash('sha256').update(source).digest('hex'),m.sha256);
 assert.equal(m.audience,PREVIEW_ACCESS.audience);assert.equal(m.requestOrigin,PREVIEW_ACCESS.requestOrigin);
 for(const s of ['supabase.co','railway.app','context.env','process.env','readState','sendEnvelope'])assert.equal(source.includes(s),false,s);
 const pair=await generateKeyPair('RS256'),key={...await exportJWK(pair.publicKey),kid:'fixture',alg:'RS256',use:'sig'};
 const originalNow=Date.now,originalFetch=globalThis.fetch;
 let now=m.endEpoch-100,fetches=0;
 try{
  Date.now=()=>now*1000;
  globalThis.fetch=async(url,init)=>{fetches++;assert.equal(String(url),PREVIEW_ACCESS.teamDomain+'/cdn-cgi/access/certs');assert.equal(init.redirect,'manual');assert.equal(init.credentials,'omit');return new Response(JSON.stringify({keys:[key]}));};
  const {onRequest}=await import(new URL('preview-access-check.js',root));
  const token=await new SignJWT({iss:PREVIEW_ACCESS.teamDomain,aud:[m.audience],sub:'synthetic-human',type:'app',iat:now-10,nbf:now-10,exp:now+200}).setProtectedHeader({alg:'RS256',kid:'fixture'}).sign(pair.privateKey);
  const call=(method='GET',origin=m.requestOrigin,assertion=token)=>onRequest({request:new Request(origin+'/admin-api/access-check',{method,headers:assertion?{'cf-access-jwt-assertion':assertion}:{}}),get env(){throw Error('ENV_ACCESS_REFUSED');}});
  assert.equal((await call('POST')).status,405);assert.equal((await call('GET','https://other.rungsthaikitchen.pages.dev')).status,403);assert.equal((await call('GET',m.requestOrigin,null)).status,403);assert.equal(fetches,0);
  assert.deepEqual(await (await call()).json(),{status:'VERIFIED',scope:'ACCESS_READ_ONLY_PROBE',bookingRequests:0,databaseRequests:0,notifications:0});
  now=m.endEpoch;const before=fetches;assert.equal((await call()).status,410);assert.equal(fetches,before);
 }finally{Date.now=originalNow;globalThis.fetch=originalFetch;}
});
