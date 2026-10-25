const {test}=require('node:test');
const assert=require('node:assert/strict');
const {database}=require('./command-route-test-helper.cjs');
const {validateEventBatch,replay}=require('../master-wok-chronological-replay');
test('authoritative route switches with baseline and attestation in one transaction',async t=>{
 const {db,q,scalar,call,fixture}=await database();
 const switchRoute=f=>call('switch_command_route',[f.route,0,f.dst,'route-switch']);
 async function rolled(name,fn){await t.test(name,async()=>{await db.exec('BEGIN');try{await fn(await fixture());}finally{await db.exec('ROLLBACK');}});}
 async function refuses(fn,error){await db.exec('SAVEPOINT refused');try{await assert.rejects(fn,error);}finally{await db.exec('ROLLBACK TO refused');}}
 try{
  await rolled('create, offer and old signed response follow the server-selected current stream',async f=>{
   const before=await call('export_command_route',[f.route]);assert.equal(before.streamId,f.src);assert.equal(before.generation,0);
   assert.equal(await switchRoute(f),'RECORDED');assert.equal(await switchRoute(f),'ALREADY_RECORDED');
   let p=await call('export_command_route',[f.route]);assert.equal(p.generation,1);assert.equal(p.streamId,f.dst);assert.equal(p.previousStreamId,f.src);assert.equal(p.attested,true);assert.equal(p.batch.events[0].eventId,'route-switch');
   await new Promise(r=>setTimeout(r,5));
   assert.equal(await call('routed_apply_booking',[f.route,'old-reply','synthetic-route','accept',null,'offer-a',f.src]),'RECORDED');
   assert.equal(await call('routed_apply_booking',[f.route,'old-reply','synthetic-route','accept',null,'offer-a',f.src]),'ALREADY_RECORDED');
   assert.equal(await call('routed_create_booking',[f.route,'create',f.booking,'synthetic-route',f.day+'T18:00:00Z',f.lines]),'ALREADY_RECORDED');
   await call('routed_apply_booking',[f.route,'offer-b','synthetic-route','offer',f.day+'T19:30:00Z',null,null]);
   await refuses(()=>call('routed_apply_booking',[f.route,'stale','synthetic-route','reject',null,'offer-a',f.src]),/STALE_PROPOSAL_RESPONSE/);
   await call('routed_apply_booking',[f.route,'new-reply','synthetic-route','reject',null,'offer-b',f.dst]);
   p=await call('export_command_route',[f.route]);validateEventBatch(p.batch);const result=replay(p.batch,{enabled:true});
   assert.equal(result.decisionCount,1);assert.equal(result.remainingCommitments,0);assert.equal(result.historicalDecisionCoverage,false);
   assert.equal(await scalar('SELECT event_count FROM master_wok_event_test.streams WHERE id=$1',[f.src]),2);
  });
  await rolled('rollback restores route, source and destination with no administrative receipt',async f=>{
   await db.exec('SAVEPOINT switch');await switchRoute(f);await db.exec('ROLLBACK TO switch');
   const p=await call('export_command_route',[f.route]);assert.equal(p.generation,0);assert.equal(p.streamId,f.src);assert.equal(p.enabled,true);
   assert.equal(await scalar('SELECT event_count FROM master_wok_event_test.streams WHERE id=$1',[f.dst]),0);
   assert.equal(await scalar('SELECT count(*)::int FROM master_wok_event_test.cutover_response_routes'),0);
   assert.equal(await switchRoute(f),'RECORDED');
  });
  await rolled('sealed export retains a decision committed between observer polls',async f=>{
   const old=await call('export_command_route',[f.route]);assert.equal(old.eventCount,2);
   await call('routed_apply_booking',[f.route,'between-polls','synthetic-route','offer',f.day+'T19:15:00Z',null,null]);
   await switchRoute(f);const p=await call('export_command_route',[f.route]);
   assert.equal(p.previousRetired,true);assert.equal(p.previousEventCount,3);
   assert.equal(p.previousBatch.events[2].eventId,'between-polls');
   assert.equal(replay(p.previousBatch,{enabled:true}).decisionCount,2);
   assert.equal(replay(p.batch,{enabled:true}).decisionCount,0);
  });
  await rolled('confirmation resolves its target on the server and keeps one reservation',async f=>{
   await switchRoute(f);await new Promise(r=>setTimeout(r,5));
   assert.equal(await call('routed_apply_booking',[f.route,'confirm-current','synthetic-route','confirm',null,null,null]),'RECORDED');
   assert.equal(await scalar('SELECT count(*)::int FROM master_wok_event_test.reservations WHERE stream_id=$1',[f.dst]),1);
   assert.equal(await scalar("SELECT order_payload->>'targetAt' FROM master_wok_event_test.reservations WHERE stream_id=$1",[f.dst]),f.day+'T19:00:00.000000Z');
  });
  await rolled('failed seed cannot advance the route',async f=>{
   await call('create_booking',[f.dst,'other',f.booking,'synthetic-other',f.day+'T18:00:00Z',f.lines]);
   await refuses(()=>switchRoute(f),/EMPTY_DESTINATION_REQUIRED/);
   const p=await call('export_command_route',[f.route]);assert.equal(p.generation,0);assert.equal(p.streamId,f.src);
  });
  await rolled('unsigned or unrelated response origins cannot modify the new stream',async f=>{
   await switchRoute(f);const other=await scalar('SELECT gen_random_uuid()::text');
   await refuses(()=>call('routed_apply_booking',[f.route,'unsigned','synthetic-route','accept',null,'offer-a',null]),/SIGNED_RESPONSE_ORIGIN_REQUIRED/);
   await refuses(()=>call('routed_apply_booking',[f.route,'foreign','synthetic-route','accept',null,'offer-a',other]),/RESPONSE_ORIGIN_ROUTE_REQUIRED/);
   assert.equal((await call('export_command_route',[f.route])).eventCount,1);
  });
  await rolled('different retry targets and another switch fail closed',async f=>{
   await switchRoute(f);
   await refuses(()=>call('switch_command_route',[f.route,0,f.src,'other-switch']),/ROUTE_REVISION_CONFLICT/);
   await refuses(()=>call('switch_command_route',[f.route,1,f.src,'other-switch']),/ROUTE_SWITCH_REQUIRED/);
  });
  await rolled('disabled current stream refuses routed commands',async f=>{
   await q('UPDATE master_wok_event_test.streams SET enabled=false WHERE id=$1',[f.src]);
   await refuses(()=>call('routed_apply_booking',[f.route,'blocked','synthetic-route','complete',null,null,null]),/CURRENT_ROUTE_DISABLED/);
  });
  await t.test('empty source can become an explicit empty baseline without invented bookings',async()=>{
   await db.exec('BEGIN');try{
    const f=await fixture(true);await switchRoute(f);const p=await call('export_command_route',[f.route]);
    assert.equal(p.batch.events.length,1);assert.deepEqual(p.batch.events[0].commitments,[]);assert.equal(replay(p.batch,{enabled:true}).decisionCount,0);
   }finally{await db.exec('ROLLBACK');}
  });
  await t.test('reader export is stable and runtime roles cannot retarget routes',async()=>{
   assert.equal(await scalar("SELECT provolatile FROM pg_proc WHERE oid='master_wok_event_test.export_command_route(uuid)'::regprocedure"),'s');
   for(const role of ['master_wok_event_reader_login','master_wok_event_writer_login']){
    assert.equal(await scalar("SELECT has_table_privilege($1,'master_wok_event_test.command_routes','INSERT,UPDATE,DELETE')",[role]),false);
    assert.equal(await scalar("SELECT has_function_privilege($1,'master_wok_event_test.switch_command_route(uuid,integer,uuid,text)','EXECUTE')",[role]),false);
   }
   assert.equal(await scalar("SELECT has_function_privilege('master_wok_event_reader_login','master_wok_event_test.routed_apply_booking(uuid,text,text,text,timestamptz,text,uuid)','EXECUTE')"),false);
  });
 }finally{await db.close();}
});
