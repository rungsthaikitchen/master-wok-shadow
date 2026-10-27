import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {createStagingBrowserApi} from './staff-browser-api.mjs';
import {createStaffIntentStore} from './staff-command-outbox.mjs';
const issuer='https://synthetic-team.cloudflareaccess.com',origin='https://synthetic-admin.invalid',aud='a'.repeat(64),orderId='12345678-1234-1234-1234-123456789abc';
const {publicKey,privateKey}=await generateKeyPair('RS256'),key={...await exportJWK(publicKey),kid:'synthetic',alg:'RS256',use:'sig'};
const token=await new SignJWT({iss:issuer,aud:[aud],sub:'synthetic-staff',type:'app',iat:900,nbf:900,exp:2000}).setProtectedHeader({alg:'RS256',kid:'synthetic'}).sign(privateKey);
const req=(path,body,t=token)=>new Request(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','Cf-Access-Jwt-Assertion':t},body:JSON.stringify(body)});
const state=()=>({orderId,revision:2,status:'proposed',target:'2026-10-28T19:00:00Z',proposalTargets:['2026-10-28T19:30:00Z']});
function setup(extra={}){let reads=0,sends=0;const handler=createStagingBrowserApi({enabled:true,audience:aud,hopKey:'synthetic-browser-hop-key-12345',actorKey:'synthetic-browser-actor-key-12345',nowSeconds:()=>1000,fetcher:async()=>new Response(JSON.stringify({keys:[key]})),readState:async()=>{reads++;return state();},sendEnvelope:async()=>{sends++;return {status:'RECORDED',revision:3};},...extra});return {handler,counts:()=>({reads,sends})};}
test('browser API defaults disabled before configuration or request reads',async()=>{const h=createStagingBrowserApi({get readState(){throw Error('read');}});assert.equal((await h({get url(){throw Error('read');}})).status,503);});
test('state route verifies identity, binds requested order and returns only the state contract',async()=>{
 const s=setup();assert.equal((await s.handler(req('/admin-api/staff-state-v1',{orderId},'forged'))).status,403);assert.deepEqual(s.counts(),{reads:0,sends:0});
 assert.deepEqual(await(await s.handler(req('/admin-api/staff-state-v1',{orderId}))).json(),state());assert.deepEqual(s.counts(),{reads:1,sends:0});
 assert.equal((await s.handler(req('/admin-api/staff-state-v1',{orderId,actor:'forged'}))).status,400);
});
test('invalid, extra private fields and mismatched state cannot escape to browser',async()=>{
 for(const change of [{orderId:'other'},{email:'PRIVATE@example.invalid'},{target:'2026-02-30T19:00:00Z'},{revision:0}]){
  const s=setup({readState:async()=>({...state(),...change})}),r=await s.handler(req('/admin-api/staff-state-v1',{orderId}));assert.equal(r.status,502);assert.equal((await r.text()).includes('PRIVATE'),false);
 }
});
test('versioned action path has no legacy route fallback and does not accept caller identity',async()=>{
 const s=setup(),c={version:1,commandId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',orderId,expectedRevision:2,action:'confirm'};
 assert.equal((await s.handler(req('/admin-api/order-action',c))).status,404);
 assert.equal((await s.handler(req('/admin-api/staff-command-v1',{...c,actor:'forged'}))).status,400);assert.equal(s.counts().sends,0);
 assert.equal((await s.handler(req('/admin-api/staff-command-v1',c))).status,200);assert.equal(s.counts().sends,1);
});
test('only explicit revision-conflict review may discard the matching pending action',()=>{
 const m=new Map(),store=createStaffIntentStore({getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)}),c=store.begin({orderId,expectedRevision:2,action:'confirm'});
 assert.throws(()=>store.discardRefused(c.commandId,'STAFF_TRANSACTION_FAILED'),/STAFF_INTENT_DISCARD_REFUSED/);
 assert.throws(()=>store.discardRefused('other','STAFF_REVISION_CONFLICT'),/STAFF_INTENT_DISCARD_REFUSED/);assert.deepEqual(store.resume(),c);
 store.discardRefused(c.commandId,'STAFF_REVISION_CONFLICT');assert.equal(store.resume(),null);
});
