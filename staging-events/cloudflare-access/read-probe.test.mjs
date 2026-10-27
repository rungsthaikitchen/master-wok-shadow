import {test} from 'node:test';
import assert from 'node:assert/strict';
import {exportJWK,generateKeyPair,SignJWT} from 'jose';
import {createReadProbe} from './read-probe.mjs';
const issuer='https://synthetic-team.cloudflareaccess.com',aud='a'.repeat(64),origin='https://synthetic-admin.invalid';
const one=await generateKeyPair('RS256'),two=await generateKeyPair('RS256'),key={...await exportJWK(one.publicKey),kid:'one',alg:'RS256',use:'sig'};
const claims=()=>({iss:issuer,aud:[aud],sub:'synthetic-human',type:'app',iat:900,nbf:900,exp:1800,email:'PRIVATE@example.invalid',identity_nonce:'PRIVATE',country:'PRIVATE'});
const sign=(c=claims(),privateKey=one.privateKey)=>new SignJWT(c).setProtectedHeader({alg:'RS256',kid:'one'}).sign(privateKey);
function setup(extra={}){const seen=[];return {seen,handler:createReadProbe({enabled:true,teamDomain:issuer,audience:aud,requestOrigin:origin,endEpoch:2000,nowSeconds:()=>1000,fetcher:async(url,init)=>{seen.push({url:String(url),init});assert.equal(String(url),issuer+'/cdn-cgi/access/certs');assert.equal(init.method,'GET');return new Response(JSON.stringify({keys:[key]}),{status:200});},...extra})};}
const req=(token,options={})=>new Request(options.url||origin+'/admin-api/access-check',{method:options.method||'GET',headers:token?{'Cf-Access-Jwt-Assertion':token}:options.headers});
test('default disabled probe reads no configuration or request',async()=>{const h=createReadProbe({get teamDomain(){throw Error('read');}});assert.equal((await h({get url(){throw Error('read');}})).status,503);});
test('configuration requires pinned public team, AUD, HTTPS origin and deadline at most two hours',()=>{
 for(const bad of [{teamDomain:'https://evil.invalid'},{audience:''},{requestOrigin:'http://synthetic.invalid'},{endEpoch:9001},{endEpoch:Infinity}])assert.throws(()=>setup(bad));
});
test('valid signature returns status only: no JWT, identity, email, audience or cookie disclosure',async()=>{
 const s=setup(),token=await sign(),r=await s.handler(req(token));assert.equal(r.status,200);const body=await r.text();assert.deepEqual(JSON.parse(body),{status:'VERIFIED',scope:'ACCESS_READ_ONLY_PROBE',bookingRequests:0,databaseRequests:0,notifications:0});
 for(const x of [token,'PRIVATE',aud,'synthetic-human',issuer])assert.equal(body.includes(x),false);assert.equal(r.headers.get('Set-Cookie'),null);assert.equal(r.headers.get('Cache-Control'),'private, no-store');assert.equal(s.seen.length,1);assert.equal(s.seen[0].init.redirect,'error');assert.equal(s.seen[0].init.credentials,'omit');
});
test('GET has no action/body path and wrong method/origin/query/cookie-only never fetch keys',async()=>{
 const s=setup(),token=await sign();for(const input of [req(token,{method:'POST'}),req(token,{url:'https://other.invalid/admin-api/access-check'}),req(token,{url:origin+'/admin-api/access-check?token=fake'}),req(null,{headers:{Cookie:'CF_Authorization='+token}})])assert.notEqual((await s.handler(input)).status,200);
 assert.equal(s.seen.length,0);
});
test('forged signature, other app/team, service and global tokens are refused',async()=>{
 const cases=[await sign(claims(),two.privateKey),...await Promise.all([{iss:'https://other.cloudflareaccess.com'},{aud:['b'.repeat(64)]},{type:'org'},{sub:'',common_name:'service.access'},{exp:1000}].map(x=>sign({...claims(),...x})))];
 for(const token of cases){const s=setup();assert.equal((await s.handler(req(token))).status,403);}
});
test('deadline ends all key requests; expiry during key fetch also refuses',async()=>{
 let now=2000;const a=setup({nowSeconds:()=>now});assert.equal((await a.handler(req(await sign()))).status,410);assert.equal(a.seen.length,0);
 now=1000;const b=setup({nowSeconds:()=>now,fetcher:async()=>{now=2000;return new Response(JSON.stringify({keys:[key]}),{status:200});}});assert.equal((await b.handler(req(await sign()))).status,410);
});
test('key service error returns no internal diagnostics',async()=>{const s=setup({fetcher:async()=>{throw Error('PRIVATE diagnostics');}});const r=await s.handler(req(await sign()));assert.equal(r.status,403);assert.equal((await r.text()).includes('PRIVATE'),false);});
