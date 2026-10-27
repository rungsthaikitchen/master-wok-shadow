// Real synthetic signatures + local SQL. No Cloudflare, Supabase or provider calls.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {exportJWK,generateKeyPair,SignJWT} from 'jose';
import {createAccessAdminGate,PROJECT} from './access-gate.mjs';
const require=createRequire(import.meta.url),{database}=require('../command-route-test-helper.cjs');
test('Cloudflare-verified admin reaches the SQL offer boundary; denied JWT/response commands make no change',async()=>{
 const {publicKey,privateKey}=await generateKeyPair('RS256'),key={...await exportJWK(publicKey),kid:'synthetic',alg:'RS256',use:'sig'};
 const issuer='https://synthetic-team.cloudflareaccess.com',aud='a'.repeat(64),origin='https://synthetic-admin.invalid';
 const token=await new SignJWT({iss:issuer,aud:[aud],sub:'synthetic-staff',type:'app',iat:900,nbf:900,exp:2000}).setProtectedHeader({alg:'RS256',kid:'synthetic'}).sign(privateKey);
 const d=await database();try{
  const f=await d.fixture();let callbacks=0;
  const gate=createAccessAdminGate({enabled:true,project:PROJECT,teamDomain:issuer,audience:aud,requestOrigin:origin,nowSeconds:()=>1000,fetcher:async()=>new Response(JSON.stringify({keys:[key]}),{status:200}),onAuthorized:async(req,actor)=>{
   callbacks++;assert.equal(actor.source,'VERIFIED_CLOUDFLARE_ACCESS');const b=await req.json();
   if(Object.keys(b).some(k=>!['requestId','action','target'].includes(k))||!['offer','confirm','cancel','complete'].includes(b.action))throw Error('ADMIN_COMMAND_FIELDS_REFUSED');
   return d.call('routed_apply_booking',[f.route,b.requestId,'synthetic-route',b.action,b.target??null,null,null]);
  }});
  const req=(body,t=token)=>new Request(origin+'/admin-api/order-action',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','Cf-Access-Jwt-Assertion':t},body:JSON.stringify(body)});
  const count=()=>d.scalar('SELECT event_count FROM master_wok_event_test.streams WHERE id=$1',[f.src]);
  const offer={requestId:'cf-offer',action:'offer',target:f.day+'T19:30:00Z'};
  await assert.rejects(gate(req(offer,'forged')));assert.equal(callbacks,0);assert.equal(await count(),2);
  assert.equal(await gate(req(offer)),'RECORDED');assert.equal(await gate(req(offer)),'ALREADY_RECORDED');assert.equal(await count(),3);
  assert.equal(await d.scalar('SELECT count(*)::int FROM master_wok_event_test.reservations WHERE stream_id=$1',[f.src]),1);
  await assert.rejects(gate(req({requestId:'cf-customer-accept',action:'accept',proposal:'cf-offer'})),/ADMIN_COMMAND_FIELDS_REFUSED/);assert.equal(await count(),3);
 }finally{await d.db.close();}
});
