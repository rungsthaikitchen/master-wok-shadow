import {test} from 'node:test';
import assert from 'node:assert/strict';
import {exportJWK,generateKeyPair,SignJWT} from 'jose';
import {createReadProbe} from './read-probe.mjs';
const issuer='https://synthetic-team.cloudflareaccess.com',aud='a'.repeat(64),origin='https://synthetic-admin.invalid';
const {publicKey,privateKey}=await generateKeyPair('RS256'),key={...await exportJWK(publicKey),kid:'one',alg:'RS256',use:'sig'};
const base=()=>({iss:issuer,aud:[aud],type:'app',sub:'synthetic-private-user',iat:900,nbf:900,exp:1800,email:'PRIVATE@example.invalid'});
async function result(change,options={}){
 const p=base();change(p);const token=await new SignJWT(p).setProtectedHeader({alg:'RS256',kid:'one'}).sign(privateKey);
 const h=createReadProbe({enabled:true,teamDomain:issuer,audience:aud,requestOrigin:origin,endEpoch:2000,nowSeconds:()=>1000,fetcher:async()=>new Response(JSON.stringify({keys:[key]}),{status:200}),...options});
 const r=await h(new Request(origin+'/admin-api/access-check',{headers:{'Cf-Access-Jwt-Assertion':token}}));const body=await r.text();
 assert.equal(body.includes(token),false);assert.equal(body.includes('PRIVATE'),false);assert.equal(body.includes(p.sub),false);return {status:r.status,...JSON.parse(body)};
}
test('safe diagnostic codes distinguish absent registered claims without exposing claims',async()=>{for(const claim of ['nbf','iat','type']){const r=await result(p=>delete p[claim]);assert.equal(r.status,'REFUSED');assert.equal(r.reasonCode,'MISSING_'+claim.toUpperCase()+'_CLAIM');}});
test('signed wrong issuer/application, expiry and human token failures stay refused',async()=>{
 for(const [change,code]of [[p=>p.iss='https://other.cloudflareaccess.com','ISSUER_MISMATCH'],[p=>p.aud=['b'.repeat(64)],'APPLICATION_AUD_MISMATCH'],[p=>p.exp=999,'TOKEN_EXPIRED'],[p=>p.type='org','APPLICATION_TOKEN_REQUIRED'],[p=>p.common_name='service.access','HUMAN_IDENTITY_REQUIRED']])assert.equal((await result(change)).reasonCode,code);
});
test('key retrieval errors return only a static diagnostic, never error text',async()=>{const r=await result(()=>{},{fetcher:async()=>{throw Error('PRIVATE API KEY');}});assert.equal(r.reasonCode,'KEY_FETCH_FAILED');});
