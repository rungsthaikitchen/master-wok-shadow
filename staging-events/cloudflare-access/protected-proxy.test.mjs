import {test} from 'node:test';
import assert from 'node:assert/strict';
import {exportJWK,generateKeyPair,SignJWT} from 'jose';
import {PROJECT} from './access-gate.mjs';
import {createProtectedActionProxy} from './protected-proxy.mjs';
const issuer='https://synthetic-team.cloudflareaccess.com',origin='https://synthetic-admin.invalid',aud='a'.repeat(64),orderId='12345678-1234-1234-1234-123456789abc';
const {publicKey,privateKey}=await generateKeyPair('RS256');
const key={...await exportJWK(publicKey),kid:'test',alg:'RS256',use:'sig'};
const token=await new SignJWT({iss:issuer,aud:[aud],sub:'synthetic-staff',type:'app',iat:900,nbf:900,exp:2000,email:'PRIVATE@example.invalid'}).setProtectedHeader({alg:'RS256',kid:'test'}).sign(privateKey);
const request=(body,extra={})=>new Request(origin+'/admin-api/order-action',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','Cf-Access-Jwt-Assertion':token,...extra.headers},body:typeof body==='string'?body:JSON.stringify(body)});
function setup(extra={}){const calls=[];return {calls,handler:createProtectedActionProxy({enabled:true,project:PROJECT,teamDomain:issuer,audience:aud,requestOrigin:origin,nowSeconds:()=>1000,fetcher:async()=>new Response(JSON.stringify({keys:[key]}),{status:200}),forwardAction:async payload=>{calls.push(payload);return new Response('{"success":true}',{status:200,headers:{'Content-Type':'application/json','Set-Cookie':'PRIVATE=token'}});},...extra})};}
test('disabled proxy never reads request or forwarding configuration',async()=>{
 const handler=createProtectedActionProxy({get forwardAction(){throw Error('read');}});const r=await handler({get url(){throw Error('read');}});assert.equal(r.status,503);assert.equal((await r.json()).error,'ADMIN_PROXY_DISABLED');
});
test('enabled proxy requires an explicit trusted forwarder',()=>{assert.throws(()=>createProtectedActionProxy({enabled:true}),/ADMIN_PROXY_FORWARDER_REQUIRED/);});
test('invalid Access JWT stops before request body or service forwarding',async()=>{
 const s=setup();const req={url:origin+'/admin-api/order-action',method:'POST',headers:new Headers({Origin:origin,'Content-Type':'application/json','Cf-Access-Jwt-Assertion':'forged'}),get body(){throw Error('read private body');}};
 const r=await s.handler(req);assert.equal(r.status,403);assert.equal(s.calls.length,0);assert.equal((await r.json()).error,'ADMIN_PROXY_ACCESS_REFUSED');
});
test('all five existing action shapes preserve exact payload; JWT and cookies are not forwarded',async()=>{
 const s=setup();const payloads=[{action:'accept',orderId},{action:'decline',orderId,reason:' Synthetic reason '},{action:'suggest_time',orderId,proposedTime:'2026-10-28T19:15:00+00:00'},{action:'mark_paid',orderId},{action:'complete',orderId}];
 for(const p of payloads){const r=await s.handler(request(p));assert.equal(r.status,200);assert.equal(await r.text(),'{"success":true}');assert.equal(r.headers.get('Set-Cookie'),null);assert.equal(r.headers.get('Cache-Control'),'no-store');}
 assert.deepEqual(s.calls,payloads);assert.equal(JSON.stringify(s.calls).includes(token),false);assert.equal(JSON.stringify(s.calls).includes('PRIVATE'),false);
});
test('caller identity, routes, tokens, customer responses, malformed UUIDs and dates cannot smuggle into action',async()=>{
 const s=setup();const bad=[{action:'accept',orderId,actor:{admin:true}},{action:'accept',orderId,routeId:'other'},{action:'accept',orderId,token:'PRIVATE'},{action:'accept',orderId,proposal:'old'},{action:'reject',orderId},{action:'toString',orderId},{action:'__proto__',orderId},{action:'accept',orderId:'human-ref'},{action:'suggest_time',orderId,proposedTime:'2026-02-30T19:00:00Z'},{action:'suggest_time',orderId,proposedTime:'2026-10-28T24:00:00Z'},{action:'decline',orderId,reason:null},[],null];
 for(const p of bad)assert.equal((await s.handler(request(p))).status,400);assert.equal(s.calls.length,0);
});
test('malformed and oversized JSON never reaches service forwarding',async()=>{
 const s=setup();assert.equal((await s.handler(request('{bad'))).status,400);assert.equal((await s.handler(request(' '.repeat(65537)))).status,413);assert.equal(s.calls.length,0);
});
test('non-success backend status/body is preserved without inventing committed success',async()=>{
 const s=setup({forwardAction:async()=>new Response('{"error":"CONFLICT"}',{status:409,headers:{'Content-Type':'application/json'}})});const r=await s.handler(request({action:'accept',orderId}));assert.equal(r.status,409);assert.equal(await r.text(),'{"error":"CONFLICT"}');
});
test('forwarder errors and redirects are sanitized and never followed/retried by this adapter',async()=>{
 for(const forwardAction of [async()=>{throw Error('PRIVATE server secret');},async()=>new Response('',{status:302,headers:{Location:'https://evil.invalid'}}),async()=>null]){
  const s=setup({forwardAction});const r=await s.handler(request({action:'accept',orderId}));assert.equal(r.status,502);assert.equal((await r.json()).error,'ADMIN_PROXY_UPSTREAM_FAILED');
 }
});
test('backend no-content responses remain no-content and oversized replies are refused',async()=>{
 const a=setup({forwardAction:async()=>new Response(null,{status:204})});const r=await a.handler(request({action:'complete',orderId}));assert.equal(r.status,204);assert.equal(await r.text(),'');
 const b=setup({forwardAction:async()=>new Response('x'.repeat(131073),{status:200})});assert.equal((await b.handler(request({action:'complete',orderId}))).status,502);
});
