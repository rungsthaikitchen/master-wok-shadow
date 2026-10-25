const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {PGlite}=require('@electric-sql/pglite');
const {validateEventBatch,replay}=require('../master-wok-chronological-replay');

test('single-hop cutover response candidate executes real PostgreSQL',async t=>{
 const db=new PGlite();
 const q=async(sql,args=[]) => (await db.query(sql,args)).rows;
 const scalar=async(sql,args=[])=>Object.values((await q(sql,args))[0])[0];
 const call=(name,args)=>scalar(`SELECT master_wok_event_test.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')})`,args);
 const later=()=>new Promise(resolve=>setTimeout(resolve,5));
 async function setup(accepted=false){
  const day=await scalar("SELECT ((clock_timestamp() AT TIME ZONE 'Europe/London')::date+1)::text");
  const ids=await q('SELECT gen_random_uuid()::text AS src,gen_random_uuid()::text AS dst,gen_random_uuid()::text AS booking');
  const f={...ids[0],day};
  await q('INSERT INTO master_wok_event_test.streams(id,service_date,enabled) VALUES($1,$3,true),($2,$3,true)',[f.src,f.dst,day]);
  await call('create_booking',[f.src,'create',f.booking,'synthetic-order',day+'T18:00:00Z',[{item_id:'green-curry',qty:1,modifiers:[{id:'chicken'}]}]]);
  await call('apply_booking',[f.src,'offer-a',f.booking,'offer',day+'T19:00:00Z',null]);
  if(accepted)await call('apply_booking',[f.src,'prior-reply',f.booking,'accept',null,'offer-a']);
  await call('seed_cutover_baseline',[f.src,f.dst,'baseline']);await later();return f;
 }
 async function rolled(name,fn){await t.test(name,async()=>{await db.exec('BEGIN');try{await fn(await setup());}finally{await db.exec('ROLLBACK');}});}
 const answer=(f,request='reply',action='accept',proposal='offer-a',cutover='baseline')=>call('apply_cutover_response',[f.src,f.dst,cutover,request,'synthetic-order',action,proposal]);
 async function refuses(fn,error){await db.exec('SAVEPOINT refusal');try{await assert.rejects(fn,error);}finally{await db.exec('ROLLBACK TO refusal');}}
 try{
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  for(const file of ['schema.sql','booking-store.sql','delivery-booking-store.sql','cutover-record-export.sql','cutover-baseline-snapshot.sql','cutover-baseline-store.sql','cutover-response-candidate.sql']) await db.exec(fs.readFileSync(path.join(__dirname,file),'utf8'));
  await rolled('pre-cutover proposal accepted once without adding capacity',async f=>{
   assert.equal(await answer(f),'RECORDED');assert.equal(await answer(f),'ALREADY_RECORDED');
   assert.equal(await scalar('SELECT count(*)::int FROM master_wok_event_test.reservations WHERE stream_id=$1',[f.dst]),1);
   assert.equal(await scalar('SELECT commitment FROM master_wok_event_test.reservations WHERE stream_id=$1',[f.dst]),'CONFIRMED');
   const batch=await call('export',[f.dst]);validateEventBatch(batch);const r=replay(batch,{enabled:true});
   assert.equal(r.remainingCommitments,1);assert.equal(r.decisionCount,0);assert.equal(r.historicalDecisionCoverage,false);
   await refuses(()=>answer(f,'opposite','reject'),/STALE_PROPOSAL_RESPONSE/);
  });
  await rolled('actual Python signed-response adapter binds the real SQL command',async f=>{
   const code=`import json,sys
sys.path.insert(0,'railway-shadow')
from event_customer_response_staging import issue_token
from event_cutover_response_staging import respond_after_cutover
f=json.load(sys.stdin);secret=b'local-synthetic-integration-key-32'
token=issue_token(f['src'],'synthetic-order','offer-a',enabled=True,secret=secret)
calls=[]
def transport(payload):
 calls.append(payload);return [dict(result='RECORDED')]
respond_after_cutover('POST',dict(token=token,decision='accept'),f['src'],f['dst'],'baseline',enabled=True,secret=secret,transport=transport)
print(json.dumps(calls))`;
   const child=spawnSync('python',['-c',code],{cwd:path.join(__dirname,'..'),input:JSON.stringify(f),encoding:'utf8',timeout:10000});
   assert.equal(child.status,0,child.stderr);const calls=JSON.parse(child.stdout);assert.equal(calls.length,1);
   assert.equal((await q(calls[0].query,calls[0].parameters))[0].result,'RECORDED');
   assert.equal((await q(calls[0].query,calls[0].parameters))[0].result,'ALREADY_RECORDED');
   assert.equal(await scalar('SELECT count(*)::int FROM master_wok_event_test.reservations WHERE stream_id=$1',[f.dst]),1);
  });
  await rolled('pre-cutover rejection releases the copied reservation',async f=>{
   assert.equal(await answer(f,'reject-old','reject'),'RECORDED');assert.equal(await answer(f,'reject-old','reject'),'ALREADY_RECORDED');
   assert.equal(await scalar('SELECT count(*)::int FROM master_wok_event_test.reservations WHERE stream_id=$1',[f.dst]),0);
  });
  await t.test('copied pre-cutover acceptance receipt keeps its original result',async()=>{
   await db.exec('BEGIN');
   try{
    const f=await setup(true);
    assert.equal(await answer(f,'prior-reply'),'ALREADY_RECORDED');
    assert.equal(await scalar('SELECT event_count FROM master_wok_event_test.streams WHERE id=$1',[f.dst]),1);
    assert.equal(await scalar('SELECT count(*)::int FROM master_wok_event_test.reservations WHERE stream_id=$1',[f.dst]),1);
   }finally{await db.exec('ROLLBACK');}
  });
  await rolled('new proposal invalidates response to old proposal',async f=>{
   await call('apply_booking',[f.dst,'offer-b',f.booking,'offer',f.day+'T19:30:00Z',null]);
   await refuses(()=>answer(f),/STALE_PROPOSAL_RESPONSE/);
   assert.equal(await scalar('SELECT current_proposal_event_id FROM master_wok_event_test.booking_rows WHERE stream_id=$1',[f.dst]),'offer-b');
   assert.equal(await scalar('SELECT event_count FROM master_wok_event_test.streams WHERE id=$1',[f.dst]),2);
  });
  await rolled('unproven receipt never changes destination',async f=>{
   await refuses(()=>answer(f,'reply','accept','offer-a','missing'),/CUTOVER_ROUTE_UNPROVEN/);
   await q("UPDATE master_wok_event_test.booking_commands SET command=command||'{\"extra\":true}' WHERE stream_id=$1 AND request_id='baseline'",[f.dst]);
   await refuses(()=>answer(f),/CUTOVER_ROUTE_UNPROVEN/);
   assert.equal(await scalar('SELECT event_count FROM master_wok_event_test.streams WHERE id=$1',[f.dst]),1);
  });
  await rolled('reactivated source refuses compatibility routing',async f=>{
   await q('UPDATE master_wok_event_test.streams SET enabled=true WHERE id=$1',[f.src]);
   await refuses(()=>answer(f),/CUTOVER_ROUTE_UNPROVEN/);
  });
  await rolled('retired destination and non-response actions refused',async f=>{
   await refuses(()=>answer(f,'bad-action','complete'),/CUTOVER_RESPONSE_REQUIRED/);
   await q('UPDATE master_wok_event_test.streams SET enabled=false WHERE id=$1',[f.dst]);
   await refuses(()=>answer(f),/CUTOVER_ROUTE_UNPROVEN/);
  });
  await t.test('candidate remains invoker-only and has no public execution grant',async()=>{
   const r=await q("SELECT prosecdef FROM pg_proc WHERE oid='master_wok_event_test.apply_cutover_response(uuid,uuid,text,text,text,text,text)'::regprocedure");assert.equal(r[0].prosecdef,false);
   for(const role of ['anon','authenticated','service_role']) assert.equal(await scalar("SELECT has_function_privilege($1,'master_wok_event_test.apply_cutover_response(uuid,uuid,text,text,text,text,text)','EXECUTE')",[role]),false);
  });
 }finally{await db.close();}
});
