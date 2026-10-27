import {test} from 'node:test';
import assert from 'node:assert/strict';
import {exportJWK,generateKeyPair,SignJWT} from 'jose';
import {createAccessAdminGate,PROJECT} from './access-gate.mjs';
const TEAM='https://synthetic-team.cloudflareaccess.com',AUD='a'.repeat(64),ORIGIN='https://synthetic-admin.invalid',SUB='synthetic-user-123';
const one=await generateKeyPair('RS256'),two=await generateKeyPair('RS256');
const jwk={...await exportJWK(one.publicKey),kid:'one',alg:'RS256',use:'sig'};
const jwk2={...await exportJWK(two.publicKey),kid:'two',alg:'RS256',use:'sig'};
const payload=()=>({iss:TEAM,aud:[AUD],sub:SUB,type:'app',iat:900,nbf:900,exp:2000,email:'SYNTHETIC_PRIVATE@example.invalid',country:'PRIVATE',identity_nonce:'PRIVATE'});
const sign=(p=payload(),key=one.privateKey,header={alg:'RS256',kid:'one'})=>new SignJWT(p).setProtectedHeader(header).sign(key);
const req=(token,extra={})=>new Request(extra.url||ORIGIN+'/admin-api/order-action',{method:extra.method||'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json',...(token?{'Cf-Access-Jwt-Assertion':token}:{}),...extra.headers}});
function setup(extra={}){
 const seen=[],fetches=[];
 const config={enabled:true,project:PROJECT,teamDomain:TEAM,audience:AUD,requestOrigin:ORIGIN,nowSeconds:()=>1000,
  fetcher:async(url,init)=>{fetches.push({url:String(url),init});assert.equal(String(url),TEAM+'/cdn-cgi/access/certs');return new Response(JSON.stringify({keys:[jwk]}),{status:200,headers:{'Content-Type':'application/json'}});},
  onAuthorized:async(r,actor)=>{seen.push(actor);return {status:'CALLBACK_REACHED'};},...extra};
 return {gate:createAccessAdminGate(config),seen,fetches};
}
test('default off does not read configuration, request, keys or handler',async()=>{
 const gate=createAccessAdminGate({get teamDomain(){throw Error('read');}});assert.equal((await gate({get url(){throw Error('read');}})).sourceRequests,0);
});
test('configuration pins staging, a team host, application AUD and browser origin',()=>{
 for(const bad of [{project:'ubyjrrsvbbqomitpaidb'},{teamDomain:'https://evil.invalid'},{teamDomain:TEAM+'.evil.invalid'},{teamDomain:TEAM+'/path'},{teamDomain:'https://user:pass@synthetic-team.cloudflareaccess.com'},{teamDomain:TEAM+':8443'},{audience:'unknown'},{requestOrigin:'http://synthetic-admin.invalid'},{onAuthorized:null}])assert.throws(()=>setup(bad),/^Error: CLOUDFLARE_ACCESS_CONFIGURATION_REQUIRED$/);
});
test('real RS256 signature and team JWKS authorize only a minimal private actor context',async()=>{
 const s=setup(),token=await sign();assert.equal((await s.gate(req(token))).status,'CALLBACK_REACHED');
 assert.deepEqual(s.seen,[{subject:SUB,source:'VERIFIED_CLOUDFLARE_ACCESS',authorizedAt:1000}]);assert.ok(Object.isFrozen(s.seen[0]));assert.equal(JSON.stringify(s.seen).includes('PRIVATE'),false);
 assert.equal(s.fetches.length,1);assert.equal(s.fetches[0].init.redirect,'manual');assert.equal(s.fetches[0].init.credentials,'omit');assert.ok(!JSON.stringify(s.fetches).includes(token));
});
test('unsigned identity headers, cookies, shared secrets and plain bearer do not reach JWKS or handler',async()=>{
 const s=setup();for(const headers of [{},{'Cf-Access-Authenticated-User-Email':'owner@example.invalid'},{Cookie:'CF_Authorization=fake'},{Authorization:'Bearer fake'},{'x-admin-secret':'fake'},{'Cf-Access-Jwt-Assertion':'fake'},{'Cf-Access-Jwt-Assertion':'x'.repeat(8200)}])await assert.rejects(s.gate(req(null,{headers})),/^Error: CLOUDFLARE_ACCESS_REFUSED$/);
 assert.equal(s.fetches.length,0);assert.equal(s.seen.length,0);
});
test('validly signed but wrong issuer/audience/type/time/machine identities are refused',async()=>{
 const changes=[p=>p.iss='https://other.cloudflareaccess.com',p=>p.aud=['b'.repeat(64)],p=>p.aud=[AUD,'b'.repeat(64)],p=>p.type='org',p=>p.exp=1000,p=>p.iat=1001,p=>p.nbf=1001,p=>p.sub='',p=>p.common_name='service.access',p=>p.service_token_id='service',p=>p.service_token_status=true,p=>delete p.exp,p=>delete p.nbf];
 for(const change of changes){const p=payload();change(p);const s=setup();await assert.rejects(s.gate(req(await sign(p))),/^Error: CLOUDFLARE_ACCESS_REFUSED$/);assert.equal(s.seen.length,0);}
});
test('forged signature, untrusted key, HS256 and alg none cannot grant authority',async()=>{
 const good=await sign();const parts=good.split('.');parts[1]=Buffer.from(JSON.stringify({...payload(),sub:'forged'})).toString('base64url');
 const tokens=[parts.join('.'),await sign(payload(),two.privateKey),await new SignJWT(payload()).setProtectedHeader({alg:'HS256',kid:'one'}).sign(new Uint8Array(32)),Buffer.from('{"alg":"none"}').toString('base64url')+'.'+parts[1]+'.'];
 for(const token of tokens){const s=setup();await assert.rejects(s.gate(req(token)),/^Error: CLOUDFLARE_ACCESS_REFUSED$/);assert.equal(s.seen.length,0);}
});
test('JWT jku/x5u cannot redirect key lookup; wrong key still fails',async()=>{
 const s=setup();await assert.rejects(s.gate(req(await sign(payload(),two.privateKey,{alg:'RS256',kid:'one',jku:'https://evil.invalid/keys',x5u:'https://evil.invalid/cert'}))));
 assert.deepEqual(s.fetches.map(x=>x.url),[TEAM+'/cdn-cgi/access/certs']);assert.equal(s.seen.length,0);
});
test('only exact JSON POST route and same-origin browser request can authorize',async()=>{
 const token=await sign(),s=setup();const bad=[{method:'GET'},{method:'OPTIONS'},{url:ORIGIN+'/admin.html'},{url:ORIGIN+'/admin-api/order-action?actor=owner'},{url:'https://other.invalid/admin-api/order-action'},{headers:{Origin:'https://evil.invalid'}},{headers:{Origin:''}},{headers:{'Content-Type':'text/plain'}},{headers:{'Content-Type':'application/x-www-form-urlencoded'}}];
 for(const x of bad)await assert.rejects(s.gate(req(token,x)),/^Error: CLOUDFLARE_ACCESS_REFUSED$/);assert.equal(s.fetches.length,0);assert.equal(s.seen.length,0);
});
test('JWKS failure and malformed key response fail closed with no credential diagnostics',async()=>{
 const token=await sign();for(const fetcher of [async()=>{throw Error('PRIVATE network failure');},async()=>new Response('bad',{status:200}),async()=>new Response('{}',{status:302}),async()=>new Response(JSON.stringify({keys:[]}),{status:200})]){
  const s=setup({fetcher});await assert.rejects(s.gate(req(token)),/^Error: CLOUDFLARE_ACCESS_REFUSED$/);assert.equal(s.seen.length,0);
 }
});
test('valid cached JWKS is reused; unknown key denied during refresh cooldown',async()=>{
 const s=setup(),token=await sign();await s.gate(req(token));await s.gate(req(token));assert.equal(s.fetches.length,1);
 await assert.rejects(s.gate(req(await sign(payload(),two.privateKey,{alg:'RS256',kid:'two'}))));assert.equal(s.fetches.length,1);
 const changed=setup({fetcher:async()=>new Response(JSON.stringify({keys:[jwk2]}),{status:200})});assert.equal((await changed.gate(req(await sign(payload(),two.privateKey,{alg:'RS256',kid:'two'})))).status,'CALLBACK_REACHED');
});
test('expiry is rechecked after a delayed key lookup; no mutation callback on expiry',async()=>{
 let now=1000;const s=setup({nowSeconds:()=>now,fetcher:async()=>{now=2000;return new Response(JSON.stringify({keys:[jwk]}),{status:200});}});await assert.rejects(s.gate(req(await sign())));assert.equal(s.seen.length,0);
});
test('authorization does not report success when the protected command refuses',async()=>{
 const s=setup({onAuthorized:async()=>{throw Error('COMMAND_REVISION_REFUSED');}});await assert.rejects(s.gate(req(await sign())),/COMMAND_REVISION_REFUSED/);
});
