import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {createPreviewFixtureApi} from './preview-fixture-api.mjs';
import {createPreviewFixtureReceiver,signPreview,previewHmac} from './preview-fixture-protocol.mjs';
import {PREVIEW_ACCESS as P} from './preview-access-profile.mjs';
const {database}=createRequire(import.meta.url)('../command-route-test-helper.cjs');
const hopKey=randomBytes(32).toString('hex'),actorKey=randomBytes(32).toString('hex');
const pair=await generateKeyPair('RS256'),jwk={...await exportJWK(pair.publicKey),kid:'fixture',alg:'RS256',use:'sig'};
const token=extra=>new SignJWT({iss:P.teamDomain,aud:[P.audience],sub:'synthetic-staff',type:'app',iat:900,nbf:900,exp:2000,email:'PRIVATE@example.invalid',...extra}).setProtectedHeader({alg:'RS256',kid:'fixture'}).sign(pair.privateKey);
const identity=await token(),otherIdentity=await token({sub:'another-staff'});
const fixture={orderId:'12345678-1234-1234-1234-123456789abc',targets:['2026-10-28T19:00:00Z','2026-10-28T19:30:00Z']};
function setup(extra={}){
 const s={now:1000,reads:0,writes:0,budgets:0,sends:0,keys:0,last:null};
 const base={enabled:true,fixture:structuredClone(fixture),endEpoch:1600,nowSeconds:()=>s.now,hopKey,actorKey};
 const receiver=createPreviewFixtureReceiver({...base,takeBudget:async()=>{s.budgets++;},readState:async orderId=>{s.reads++;return {orderId,revision:2,status:'proposed',target:fixture.targets[0],proposalTargets:fixture.targets};},applyCommand:async()=>{s.writes++;return {status:'RECORDED',revision:3};},...extra.receiver});
 const api=createPreviewFixtureApi({...base,fetcher:async url=>{s.keys++;assert.equal(String(url),P.teamDomain+'/cdn-cgi/access/certs');return new Response(JSON.stringify({keys:[jwk]}));},sendEnvelope:async e=>{s.sends++;s.last=e;return receiver(e);},...extra.api});
 const send=(operation,input,auth=identity,origin=P.requestOrigin)=>api(new Request(origin+'/admin-api/staff-'+(operation==='state'?'state':'command')+'-v1',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','Cf-Access-Jwt-Assertion':auth},body:JSON.stringify(input)}));
 const command=()=>({version:1,commandId:randomUUID(),orderId:fixture.orderId,expectedRevision:2,action:'offer',target:fixture.targets[1]});
 return {s,api,receiver,send,command,base};
}
test('real-preview API and receiver default off before reading configuration',async()=>{
 const opts={get hopKey(){throw Error('read');},get fixture(){throw Error('read');}};
 assert.equal((await createPreviewFixtureApi(opts)(null)).status,503);
 await assert.rejects(createPreviewFixtureReceiver(opts)(null),/PREVIEW_RECEIVER_DISABLED/);
});
test('enabled preview requires fresh ten-minute scope, distinct private keys and persistent receiver adapter',()=>{
 const {base}=setup();
 for(const bad of [{endEpoch:1601},{endEpoch:1000},{hopKey:'weak'},{actorKey:hopKey},{fixture:{orderId:fixture.orderId,targets:['2026-02-30T19:00:00Z']}}])assert.throws(()=>setup({api:bad}));
 assert.throws(()=>createPreviewFixtureReceiver(base),/PREVIEW_PERSISTENT_ADAPTER_REQUIRED/);
});
test('preview authorizes and signs both state reads and commands without forwarding identity',async()=>{
 const a=setup();assert.equal((await a.send('state',{orderId:fixture.orderId})).status,200);assert.equal(a.s.reads,1);assert.equal(a.s.writes,0);
 assert.equal((await a.send('command',a.command())).status,200);assert.equal(a.s.writes,1);assert.equal(a.s.budgets,2);
 for(const text of [identity,'synthetic-staff','PRIVATE@example.invalid',hopKey,actorKey])assert.equal(JSON.stringify(a.s.last).includes(text),false);
 assert.match(JSON.parse(a.s.last.body).actorId,/^[a-f0-9]{64}$/);
});
test('wrong application, identity, origin, fixture, target and caller actor cannot reach receiver',async()=>{
 const a=setup();
 for(const auth of ['forged',await token({aud:['a'.repeat(64)]}),await token({type:'org'})])assert.equal((await a.send('state',{orderId:fixture.orderId},auth)).status,403);
 assert.equal((await a.send('state',{orderId:fixture.orderId},identity,'https://other.rungsthaikitchen.pages.dev')).status,403);
 for(const c of [{...a.command(),orderId:randomUUID()},{...a.command(),target:'2026-10-28T21:00:00Z'},{...a.command(),actorId:'a'.repeat(64)}])assert.equal((await a.send('command',c)).status,400);
 assert.equal((await a.send('state',{orderId:randomUUID()})).status,400);assert.equal(a.s.sends,0);assert.equal(a.s.budgets,0);
});
test('receiver independently rejects forged, future, expired and other fixture envelopes before budget',async()=>{
 const a=setup();await a.send('command',a.command());const first=a.s.last,before=a.s.budgets;
 await assert.rejects(a.receiver({...first,body:first.body+' '}),/PREVIEW_FIXTURE_REFUSED/);
 for(const patch of [{issuedAt:1001},{issuedAt:970},{input:{...a.command(),orderId:randomUUID()}},{input:{...a.command(),target:'2026-10-28T21:00:00Z'}}]){
  const e={...JSON.parse(first.body),...patch},signed=await signPreview(previewHmac(hopKey),JSON.stringify(e));await assert.rejects(a.receiver(signed),/PREVIEW_FIXTURE_REFUSED/);
 }assert.equal(a.s.budgets,before);
});
test('expiry and exhausted durable budget stop data access',async()=>{
 const a=setup();a.s.now=1600;assert.equal((await a.send('state',{orderId:fixture.orderId})).status,503);assert.equal(a.s.sends,0);assert.equal(a.s.keys,0);
 const b=setup({receiver:{takeBudget:async()=>{throw Error('PERSISTENT_BUDGET_EXHAUSTED');}}});assert.equal((await b.send('command',b.command())).status,502);assert.equal(b.s.writes,0);
});
test('private state fields and transport errors cannot be returned to browser',async()=>{
 const a=setup({receiver:{readState:async()=>({orderId:fixture.orderId,revision:2,status:'proposed',target:fixture.targets[0],proposalTargets:[],email:'PRIVATE'})}});
 const r=await a.send('state',{orderId:fixture.orderId});assert.notEqual(r.status,200);assert.equal((await r.text()).includes('PRIVATE'),false);
 const b=setup({api:{sendEnvelope:async()=>{throw Error('PRIVATE credentials');}}});const e=await b.send('command',b.command());assert.equal(e.status,502);assert.equal((await e.text()).includes('PRIVATE'),false);
});
test('Python Railway receiver accepts exact JavaScript signed envelopes',async()=>{
 const f=JSON.parse(fs.readFileSync(new URL('../../fixtures/preview-browser-28-oct-v2.json',import.meta.url),'utf8'));
 const base={enabled:true,fixture:{orderId:f.orderId,targets:f.targets},endEpoch:1600,nowSeconds:()=>1000,hopKey,actorKey};
 const api=createPreviewFixtureApi({...base,fetcher:async()=>new Response(JSON.stringify({keys:[jwk]})),sendEnvelope:async signed=>{
  const script="import json,sys;from preview_browser_receiver import validate_envelope;x=json.load(sys.stdin);e=validate_envelope(x['signed'],bytes.fromhex(x['key']),1000);print(json.dumps({'status':'RECORDED','revision':3}))";
  return JSON.parse(execFileSync('python',['-c',script],{cwd:new URL('../../railway-shadow/',import.meta.url),env:{PATH:process.env.PATH},input:JSON.stringify({signed,key:hopKey}),encoding:'utf8'}));
 }});
 const c={version:1,commandId:randomUUID(),orderId:f.orderId,expectedRevision:2,action:'offer',target:f.targets[2]};
 const r=await api(new Request(P.requestOrigin+'/admin-api/staff-command-v1',{method:'POST',headers:{Origin:P.requestOrigin,'Content-Type':'application/json','Cf-Access-Jwt-Assertion':identity},body:JSON.stringify(c)}));
 assert.deepEqual(await r.json(),{status:'RECORDED',revision:3});
});
test('fresh SQL fixture stays disabled, temporary read ACL is fixture scoped, cleanup revokes it',async()=>{
 const d=await database();
 try{
  const root=new URL('../',import.meta.url),load=n=>fs.readFileSync(new URL(n,root),'utf8');
  await d.db.exec(load('staff-command-candidate.sql'));
  await d.db.exec(load('handlers.sql'));
  await d.db.exec(load('runtime-role-proposal.sql').split('\n').filter(line=>!line.startsWith('CREATE ROLE')).join('\n'));
  await d.db.exec(load('booking-store-role.sql'));
  await d.db.exec('REVOKE SELECT ON master_wok_event_test.command_routes FROM master_wok_event_reader_login');
  await d.db.exec(load('preview-browser-v2-fixture.sql'));
  assert.equal(await d.scalar('SELECT count(*)::int FROM master_wok_event_test.streams WHERE enabled'),0);
  await d.db.exec(load('preview-browser-v2-activate.sql'));
  await d.db.exec('SET ROLE master_wok_event_reader_login');
  assert.deepEqual(await d.q("SELECT s.event_count,(SELECT count(*)::int FROM master_wok_event_test.staff_commands a WHERE a.route_id=r.id) AS audit_count FROM master_wok_event_test.command_routes r JOIN master_wok_event_test.streams s ON s.id=r.current_stream WHERE r.id=$1::uuid AND r.generation=0 AND s.id=$2::uuid AND s.enabled AND s.scope='SYNTHETIC_STAGING_EVENTS' AND s.service_date=$3::date",['3d31312d-cb9b-53d0-b69b-801b5bbc5698','795f3b0b-08e0-5d22-8071-a97e9cd52912','2026-10-28']),[{event_count:2,audit_count:0}]);
  assert.equal(await d.scalar('SELECT count(*)::int FROM master_wok_event_test.booking_rows'),1);
  await assert.rejects(d.q('SELECT scope FROM master_wok_event_test.command_routes'),/permission denied/);
  await d.db.exec('RESET ROLE');
  await d.db.exec(load('preview-browser-v2-cleanup.sql'));
  assert.equal(await d.scalar('SELECT count(*)::int FROM master_wok_event_test.streams WHERE enabled'),0);
  assert.equal(await d.scalar("SELECT has_column_privilege('master_wok_event_reader_login','master_wok_event_test.booking_rows','status','SELECT')"),false);
  assert.equal(await d.scalar("SELECT has_column_privilege('master_wok_event_reader_login','master_wok_event_test.command_routes','generation','SELECT')"),false);
  assert.equal(await d.scalar("SELECT has_function_privilege('master_wok_event_writer_login','master_wok_event_test.apply_staff_command(uuid,uuid,text,uuid,integer,text,timestamptz)','EXECUTE')"),false);
 }finally{await d.db.close();}
});
test('preview identity and signed receiver preserve SQL lifecycle, audit and retry semantics',async()=>{
 const d=await database();
 try{
  await d.db.exec(fs.readFileSync(new URL('../staff-command-candidate.sql',import.meta.url),'utf8'));const f=await d.fixture();
  const testFixture={orderId:f.booking,targets:['19:00','19:30','20:00'].map(t=>f.day+'T'+t+':00Z')};
  let reads=0,writes=0,budget=0,lost=false;
  const readState=async orderId=>{
   reads++;const b=(await d.q('SELECT status,coalesce(confirmed_time,proposed_time,preferred_time) AS target FROM master_wok_event_test.booking_rows WHERE stream_id=$1 AND id=$2',[f.src,f.booking]))[0];
   const revision=await d.scalar("SELECT max(sequence) FROM master_wok_event_test.events WHERE stream_id=$1 AND (payload->>'orderId'='synthetic-route' OR payload->'order'->>'orderId'='synthetic-route')",[f.src]);
   return {orderId,revision,status:b.status,target:new Date(b.target).toISOString().replace('.000Z','Z'),proposalTargets:testFixture.targets};
  };
  const base={enabled:true,fixture:testFixture,endEpoch:1600,nowSeconds:()=>1000,hopKey,actorKey};
  const receiver=createPreviewFixtureReceiver({...base,takeBudget:async()=>{if(++budget>30)throw Error('LIMIT');},readState,applyCommand:async({actorId,command:c})=>{writes++;return d.call('apply_staff_command',[f.route,c.commandId,actorId,c.orderId,c.expectedRevision,c.action,c.target??null]);}});
  const api=createPreviewFixtureApi({...base,fetcher:async()=>new Response(JSON.stringify({keys:[jwk]})),sendEnvelope:async e=>{const r=await receiver(e);if(lost){lost=false;throw Error('AFTER_COMMIT');}return r;}});
  const send=(operation,input,auth=identity)=>api(new Request(P.requestOrigin+'/admin-api/staff-'+operation+'-v1',{method:'POST',headers:{Origin:P.requestOrigin,'Content-Type':'application/json','Cf-Access-Jwt-Assertion':auth},body:JSON.stringify(input)}));
  const cmd=(action,revision,target)=>({version:1,commandId:randomUUID(),orderId:f.booking,expectedRevision:revision,action,...(target?{target}:{} )});
  const holdCount=()=>d.scalar('SELECT count(*)::int FROM master_wok_event_test.reservations WHERE stream_id=$1',[f.src]);
  const first=cmd('offer',2,testFixture.targets[1]);lost=true;assert.equal((await send('command',first)).status,502);
  assert.deepEqual(await(await send('command',first)).json(),{status:'ALREADY_RECORDED',revision:3});assert.equal(await holdCount(),1);
  assert.equal((await send('command',first,otherIdentity)).status,409);
  assert.equal((await send('command',cmd('offer',2,testFixture.targets[2]))).status,409);
  const second=cmd('offer',3,testFixture.targets[2]);assert.equal((await send('command',second)).status,200);assert.equal(await holdCount(),1);
  assert.equal((await send('command',cmd('confirm',4))).status,200);assert.equal(await holdCount(),1);
  assert.equal((await send('command',cmd('cancel',5))).status,200);assert.equal(await holdCount(),0);
  const state=await(await send('state',{orderId:f.booking})).json();assert.equal(state.status,'cancelled');assert.equal(state.revision,6);assert.equal(reads,1);
  assert.equal(await d.scalar('SELECT count(*)::int FROM master_wok_event_test.staff_commands'),4);
  assert.equal(await d.scalar('SELECT event_count FROM master_wok_event_test.streams WHERE id=$1',[f.src]),6);
  assert.ok(writes>=6);
 }finally{await d.db.close();}
});
