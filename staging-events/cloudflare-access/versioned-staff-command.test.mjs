import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {createVersionedStaffHandler,createSyntheticStaffReceiver} from './versioned-staff-command.mjs';
import {createStaffIntentStore} from './staff-command-outbox.mjs';
import {STAGING_ORIGIN,STAGING_ISSUER} from './staging-pages-action.mjs';
const require=createRequire(import.meta.url),{database}=require('../command-route-test-helper.cjs');
const hopKey='synthetic-hop-authentication-12345',actorKey='synthetic-staff-pseudonym-key-12345',aud='a'.repeat(64);
const {publicKey,privateKey}=await generateKeyPair('RS256'),key={...await exportJWK(publicKey),kid:'synthetic',alg:'RS256',use:'sig'};
const token=subject=>new SignJWT({iss:STAGING_ISSUER,aud:[aud],sub:subject,type:'app',iat:900,nbf:900,exp:2000,email:'PRIVATE@example.invalid'}).setProtectedHeader({alg:'RS256',kid:'synthetic'}).sign(privateKey);
const staff=await token('synthetic-staff'),other=await token('synthetic-other');
async function setup(){
 const d=await database();await d.db.exec(fs.readFileSync(new URL('../staff-command-candidate.sql',import.meta.url),'utf8'));const f=await d.fixture();
 const state={now:1000,sends:0,applies:0,lost:false,last:null};
 const receiver=createSyntheticStaffReceiver({enabled:true,hopKey,nowSeconds:()=>state.now,applyCommand:async({actorId,command:c})=>{
  state.applies++;return d.call('apply_staff_command',[f.route,c.commandId,actorId,c.orderId,c.expectedRevision,c.action,c.target??null]);
 }});
 const handler=createVersionedStaffHandler({enabled:true,hopKey,actorKey,audience:aud,nowSeconds:()=>state.now,fetcher:async()=>new Response(JSON.stringify({keys:[key]})),sendEnvelope:async e=>{
  state.sends++;state.last=e;const r=await receiver(e);if(state.lost){state.lost=false;throw Error('synthetic lost application response');}return r;
 }});
 const send=(c,t=staff)=>handler(new Request(STAGING_ORIGIN+'/admin-api/order-action',{method:'POST',headers:{Origin:STAGING_ORIGIN,'Content-Type':'application/json','Cf-Access-Jwt-Assertion':t},body:JSON.stringify(c)}));
 const offer=(revision=2,target=f.day+'T19:30:00Z')=>({version:1,commandId:randomUUID(),orderId:f.booking,expectedRevision:revision,action:'offer',target});
 const count=()=>d.scalar('SELECT event_count FROM master_wok_event_test.streams WHERE id=$1',[f.src]);
 const holds=()=>d.q('SELECT commitment,proposal_event_id,order_payload FROM master_wok_event_test.reservations WHERE stream_id=$1',[f.src]);
 return {d,f,state,receiver,send,offer,count,holds};
}
test('versioned sender and receiver default off before reading keys or transaction callback',async()=>{
 assert.equal((await createVersionedStaffHandler({get hopKey(){throw Error('read');}})({})).status,503);
 await assert.rejects(createSyntheticStaffReceiver({get hopKey(){throw Error('read');}})({}),/STAFF_RECEIVER_DISABLED/);
});
test('signed staff offer changes capacity now; acceptance confirms the same single hold and audit joins its event',async()=>{
 const s=await setup();try{
  const c=s.offer();assert.deepEqual(await(await s.send(c)).json(),{status:'RECORDED',revision:3});
  const h=await s.holds();assert.equal(h.length,1);assert.equal(h[0].commitment,'PROPOSED');assert.equal(h[0].proposal_event_id,c.commandId);assert.equal(Date.parse(h[0].order_payload.targetAt),Date.parse(c.target));
  assert.equal(await s.d.call('routed_apply_booking',[s.f.route,'customer-accept','synthetic-route','accept',null,c.commandId,s.f.src]),'RECORDED');
  assert.equal((await s.holds()).length,1);assert.equal((await s.holds())[0].commitment,'CONFIRMED');
  const a=await s.d.q('SELECT a.actor_id,e.event_id FROM master_wok_event_test.staff_commands a JOIN master_wok_event_test.events e ON e.stream_id=a.stream_id AND e.sequence=a.event_sequence');
  assert.equal(a.length,1);assert.match(a[0].actor_id,/^[a-f0-9]{64}$/);assert.equal(a[0].event_id,c.commandId);
  for(const privateValue of [staff,'synthetic-staff','PRIVATE@example.invalid'])assert.equal(JSON.stringify(s.state.last).includes(privateValue),false);
 }finally{await s.d.db.close();}
});
test('lost success can retry after a fresh envelope; changed command or staff cannot reuse ID',async()=>{
 const s=await setup();try{
  const m=new Map(),storage={getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};
  const outbox=createStaffIntentStore(storage),c=outbox.begin({orderId:s.f.booking,expectedRevision:2,action:'offer',target:s.f.day+'T19:30:00Z'});
  s.state.lost=true;assert.equal((await s.send(c)).status,502);assert.equal(await s.count(),3);
  s.state.now+=31;const reloaded=createStaffIntentStore(storage),retry=await(await s.send(reloaded.resume())).json();assert.deepEqual(retry,{status:'ALREADY_RECORDED',revision:3});reloaded.acknowledge(c.commandId,retry);assert.equal(reloaded.resume(),null);assert.equal(await s.count(),3);
  assert.equal((await s.send({...c,target:s.f.day+'T20:00:00Z'})).status,409);assert.equal((await s.send(c,other)).status,409);
  assert.equal(await s.d.scalar('SELECT count(*)::int FROM master_wok_event_test.staff_commands'),1);
 }finally{await s.d.db.close();}
});
test('private audit table and command function grant no access to public/application roles',async()=>{
 const s=await setup();try{
  for(const role of ['anon','authenticated','service_role','master_wok_event_writer_login']){
   assert.equal(await s.d.scalar("SELECT has_table_privilege($1,'master_wok_event_test.staff_commands','SELECT,INSERT,UPDATE,DELETE')",[role]),false);
   assert.equal(await s.d.scalar("SELECT has_function_privilege($1,'master_wok_event_test.apply_staff_command(uuid,uuid,text,uuid,integer,text,timestamptz)','EXECUTE')",[role]),false);
  }
 }finally{await s.d.db.close();}
});
test('competing offers use optimistic revision; repeat proposal needs a new command ID and latest revision',async()=>{
 const s=await setup();try{
  const a=s.offer(),b=s.offer();const rs=await Promise.all([s.send(a),s.send(b)]);assert.deepEqual(rs.map(r=>r.status).sort(),[200,409]);assert.equal(await s.count(),3);
  const next=s.offer(3,s.f.day+'T20:00:00Z');assert.equal((await s.send(next)).status,200);assert.equal(await s.count(),4);assert.equal((await s.holds()).length,1);
  const first=(await rs[0].clone().json()).status==='RECORDED'?a:b;
  await assert.rejects(s.d.call('routed_apply_booking',[s.f.route,'stale-customer','synthetic-route','accept',null,first.commandId,s.f.src]),/STALE_PROPOSAL_RESPONSE/);assert.equal(await s.count(),4);
  assert.deepEqual(await(await s.send(first)).json(),{status:'ALREADY_RECORDED',revision:3});assert.equal(await s.count(),4);
 }finally{await s.d.db.close();}
});
test('customer rejection advances revision; stale staff action refuses, new proposal and cancellation release correctly',async()=>{
 const s=await setup();try{
  const a=s.offer();await s.send(a);await s.d.call('routed_apply_booking',[s.f.route,'reject-offer','synthetic-route','reject',null,a.commandId,s.f.src]);assert.equal((await s.holds()).length,0);
  assert.equal((await s.send(s.offer(3))).status,409);const b=s.offer(4);await s.send(b);assert.equal((await s.holds()).length,1);
  const cancel={version:1,commandId:randomUUID(),orderId:s.f.booking,expectedRevision:5,action:'cancel'};assert.equal((await s.send(cancel)).status,200);assert.equal((await s.holds()).length,0);assert.equal(await s.count(),6);
  assert.equal((await s.send(s.offer(6))).status,409);
 }finally{await s.d.db.close();}
});
test('browser identity injection and forged/expired service envelopes cannot reach transaction',async()=>{
 const s=await setup();try{
  const c=s.offer();assert.equal((await s.send(c,'forged')).status,403);for(const extra of [{actorId:'a'.repeat(64)},{routeId:s.f.route},{version:2},{commandId:[randomUUID()]},{action:'accept'}])assert.equal((await s.send({...c,...extra})).status,400);assert.equal(s.state.applies,0);
  await s.send(c);const envelope=structuredClone(s.state.last),before=s.state.applies;
  await assert.rejects(s.receiver({...envelope,body:envelope.body+' '}),/STAFF_ENVELOPE_REFUSED/);
  s.state.now+=30;await assert.rejects(s.receiver(envelope),/STAFF_ENVELOPE_REFUSED/);assert.equal(s.state.applies,before);
 }finally{await s.d.db.close();}
});
test('failure to persist staff audit rolls back booking, event, command and hold together',async()=>{
 const s=await setup();try{
  const before=await s.holds();await s.d.db.exec("CREATE FUNCTION master_wok_event_test.fail_staff_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SYNTHETIC_AUDIT_FAILURE'; END $$; CREATE TRIGGER fail_staff_audit BEFORE INSERT ON master_wok_event_test.staff_commands FOR EACH ROW EXECUTE FUNCTION master_wok_event_test.fail_staff_audit();");
  const c=s.offer();assert.equal((await s.send(c)).status,502);assert.equal(await s.count(),2);assert.deepEqual(await s.holds(),before);
  assert.equal(await s.d.scalar('SELECT count(*)::int FROM master_wok_event_test.booking_commands WHERE request_id=$1',[c.commandId]),0);assert.equal(await s.d.scalar('SELECT count(*)::int FROM master_wok_event_test.staff_commands'),0);
 }finally{await s.d.db.close();}
});
