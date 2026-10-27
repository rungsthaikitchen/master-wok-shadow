// Bundled synthetic child process. No real JWT, key or public endpoint required.
import assert from 'node:assert/strict';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {createVersionedStaffHandler,createSyntheticStaffReceiver} from './versioned-staff-command.mjs';
import {createStaffIntentStore} from './staff-command-outbox.mjs';
import {STAGING_ORIGIN,STAGING_ISSUER} from './staging-pages-action.mjs';
export async function exercise(c){
 const u=new URL(c.url);assert.equal(u.hostname,'127.0.0.1');assert.equal(u.protocol,'http:');assert.ok(Date.now()/1000<c.deadline);
 const {publicKey,privateKey}=await generateKeyPair('RS256'),key={...await exportJWK(publicKey),kid:'synthetic',alg:'RS256',use:'sig'};
 const now=Math.floor(Date.now()/1000),aud='a'.repeat(64),hopKey='synthetic-'+crypto.randomUUID(),actorKey='synthetic-'+crypto.randomUUID();
 const token=await new SignJWT({iss:STAGING_ISSUER,aud:[aud],sub:'synthetic-staff',type:'app',iat:now,nbf:now,exp:now+120}).setProtectedHeader({alg:'RS256',kid:'synthetic'}).sign(privateKey);
 let httpRequests=0;
 const receiver=createSyntheticStaffReceiver({enabled:true,hopKey,applyCommand:async body=>{
  assert.ok(Date.now()/1000<c.deadline);httpRequests++;
  const r=await fetch(c.url+'/staging/submit-checkout',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(10000),headers:{Authorization:'Bearer '+c.operator,'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(r.status!==200)throw Error('STAFF_TRANSACTION_FAILED');return r.json();
 }});
 const handler=createVersionedStaffHandler({enabled:true,audience:aud,hopKey,actorKey,fetcher:async url=>{assert.equal(String(url),STAGING_ISSUER+'/cdn-cgi/access/certs');return new Response(JSON.stringify({keys:[key]}));},sendEnvelope:receiver});
 const send=(body,t=token)=>handler(new Request(STAGING_ORIGIN+'/admin-api/order-action',{method:'POST',headers:{Origin:STAGING_ORIGIN,'Content-Type':'application/json','Cf-Access-Jwt-Assertion':t},body:JSON.stringify(body)}));
 const map=new Map(),storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)},outbox=createStaffIntentStore(storage);
 const first=outbox.begin({orderId:c.fixture.order,expectedRevision:2,action:'offer',target:c.fixture.day+'T19:30:00Z'});
 assert.equal((await send(first,'forged')).status,403);assert.equal(httpRequests,0);
 assert.equal((await send(first)).status,502);
 const reloaded=createStaffIntentStore(storage);const retry=await(await send(reloaded.resume())).json();assert.deepEqual(retry,{status:'ALREADY_RECORDED',revision:3});reloaded.acknowledge(first.commandId,retry);
 const cancel=reloaded.begin({orderId:c.fixture.order,expectedRevision:3,action:'cancel'});const result=await(await send(cancel)).json();assert.deepEqual(result,{status:'RECORDED',revision:4});reloaded.acknowledge(cancel.commandId,result);
 assert.equal(httpRequests,3);return {status:'PASSED',httpRequests,lostSuccessRetried:true,invalidIdentityBlocked:true};
}
let data='';for await(const chunk of process.stdin){data+=chunk;if(data.length>8192)throw Error('SYNTHETIC_INPUT_TOO_LARGE');}
try{process.stdout.write(JSON.stringify(await exercise(JSON.parse(data))));}catch{process.stderr.write('STAFF_HTTP_EXERCISE_FAILED');process.exitCode=1;}
