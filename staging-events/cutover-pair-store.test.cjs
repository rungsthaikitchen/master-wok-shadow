const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const {compareTransferBundle}=require('../master-wok-transfer-bundle');
const {validateEventBatch}=require('../master-wok-chronological-replay');
const ids=['00000001-0000-4000-8000-000000000001','00000002-0000-4000-8000-000000000002','00000003-0000-4000-8000-000000000003','00000004-0000-4000-8000-000000000004'];

test('paired source cutover executes real PL/pgSQL under rollback',async t=>{
 const db=new PGlite();
 try{
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  for(const f of ['schema.sql','booking-store.sql','delivery-booking-store.sql','cutover-record-export.sql','cross-date-booking.sql','cross-date-export.sql','cutover-baseline-snapshot.sql','cutover-baseline-store.sql','cutover-pair-store.sql']) await db.exec(fs.readFileSync(path.join(__dirname,f),'utf8'));
  const q=async(sql,args=[]) => (await db.query(sql,args)).rows;
  const scalar=async(sql,args=[]) => Object.values((await q(sql,args))[0])[0];
  const call=async(name,args) => scalar(`SELECT master_wok_event_test.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')})`,args);
  const lines=[{item_id:'green-curry',qty:1,modifiers:[{id:'chicken'}]}];
  async function fixtures(){
   const days=(await q("SELECT ((clock_timestamp() AT TIME ZONE 'Europe/London')::date+1)::text AS a,((clock_timestamp() AT TIME ZONE 'Europe/London')::date+2)::text AS b"))[0];
   const [a,b,na,nb]=ids;const orders={};
   await q('INSERT INTO master_wok_event_test.streams(id,service_date,enabled) VALUES($1,$5,true),($2,$6,true),($3,$5,true),($4,$6,true)',[...ids,days.a,days.b]);
   for(const [alias,stream,day] of [['travelling',a,days.a],['staying',a,days.a],['confirmed',b,days.b],['declined',b,days.b]]){
    orders[alias]=await scalar('SELECT gen_random_uuid()::text');
    await call('create_booking',[stream,'create-'+alias,orders[alias],'synthetic-'+alias,day+'T18:00:00Z',lines]);
   }
   await call('apply_booking',[a,'offer-staying',orders.staying,'offer',days.a+'T19:00:00Z',null]);
   await call('apply_booking',[b,'confirm-staying',orders.confirmed,'confirm',null,null]);
   await call('apply_booking',[b,'offer-declined',orders.declined,'offer',days.b+'T19:00:00Z',null]);
   await call('apply_booking',[b,'reject-declined',orders.declined,'reject',null,'offer-declined']);
   // Three genuine pre-cutover transfers, ending on the second service date.
   await call('move_booking_offer',[a,b,'old-forward',orders.travelling,days.b+'T19:00:00Z']);
   await call('move_booking_offer',[b,a,'old-return',orders.travelling,days.a+'T19:15:00Z']);
   await call('move_booking_offer',[a,b,'old-forward-again',orders.travelling,days.b+'T19:30:00Z']);
   return {a,b,na,nb,days,orders};
  }
  async function rolled(name,fn){await t.test(name,async()=>{await db.exec('BEGIN');try{await fn(await fixtures());}finally{await db.exec('ROLLBACK');}});}
  const seed=f=>call('seed_cutover_pair',[f.a,f.na,f.b,f.nb,'pair-cutover']);
  async function refuses(fn,error){await db.exec('SAVEPOINT refused');try{await assert.rejects(fn,error);}finally{await db.exec('ROLLBACK TO refused');}}
  const later=()=>new Promise(resolve=>setTimeout(resolve,4));
  async function assertClean(f){
   assert.equal(await scalar('SELECT count(*)::int FROM master_wok_event_test.streams WHERE id=ANY($1::uuid[]) AND enabled',[[f.a,f.b]]),2);
   for(const table of ['events','booking_rows','booking_items','booking_commands','reservations']) assert.equal(await scalar(`SELECT count(*)::int FROM master_wok_event_test.${table} WHERE stream_id=ANY($1::uuid[])`,[[f.na,f.nb]]),0);
  }
  await rolled('connected days share one boundary, preserve current ownership and compare future moves only',async f=>{
   const old=await call('export_transfer_pair',[f.a,f.b]);
   assert.equal(old.transfers.length,3);assert.equal(await seed(f),'RECORDED');
   const initial=await call('export_transfer_pair',[f.na,f.nb]);
   assert.equal(initial.transfers.length,0);assert.equal(initial.streams[0].batch.events[0].at,initial.streams[1].batch.events[0].at);
   for(const s of initial.streams){assert.equal(validateEventBatch(s.batch).length,1);assert.equal(s.batch.coverage.basis,'CUTOVER_BASELINE_AND_EVENT_LOG');}
   const result=compareTransferBundle(initial,{enabled:true});assert.equal(result.status,'COMPARED');assert.equal(result.transferCount,0);
   assert.deepEqual(result.results.map(s=>s.result.baselineCommitments),[1,2]);assert.ok(result.results.every(s=>s.result.decisionCount===0&&s.result.historicalDecisionCoverage===false));
   const moved=initial.streams.find(s=>s.streamId===f.nb).batch.events[0].commitments.find(c=>c.order.orderId==='synthetic-travelling');
   assert.equal(moved.proposalEventId,'old-forward-again_in');assert.equal(moved.order.targetAt,f.days.b+'T19:30:00.000000Z');
   await later();await call('apply_booking',[f.nb,'accept-after-cutover',f.orders.travelling,'accept',null,'old-forward-again_in']);
   assert.equal(await scalar('SELECT count(*)::int FROM master_wok_event_test.reservations WHERE stream_id=ANY($1::uuid[])',[[f.na,f.nb]]),3);
   await refuses(()=>call('move_booking_offer',[f.na,f.nb,'old-forward-again',f.orders.travelling,f.days.b+'T19:30:00Z']),/REQUEST_ID_REUSED/);
   await call('move_booking_offer',[f.nb,f.na,'new-return-after-cutover',f.orders.travelling,f.days.a+'T20:00:00Z']);
   await call('apply_booking',[f.nb,'close-known-declined',f.orders.declined,'complete',null,null]);
   const final=await call('export_transfer_pair',[f.na,f.nb]);const compared=compareTransferBundle(final,{enabled:true});
   assert.equal(compared.status,'COMPARED');assert.equal(compared.transferCount,1);
   assert.deepEqual(compared.results.map(s=>s.result.remainingCommitments),[2,1]);assert.equal(compared.results.reduce((n,s)=>n+s.result.decisionCount,0),1);
   assert.equal(await call('seed_cutover_pair',[f.b,f.nb,f.a,f.na,'pair-cutover']),'ALREADY_RECORDED');
   assert.deepEqual(await call('export_transfer_pair',[f.na,f.nb]),final);
   await refuses(()=>call('apply_booking',[f.a,'stale-old-source',f.orders.staying,'cancel',null,null]),/SOURCE_DISABLED/);
   assert.equal(await scalar('SELECT count(*)::int FROM master_wok_event_test.booking_transfers'),4);
   if(process.env.MASTER_WOK_CAPTURE_LOCAL_CUTOVER_FIXTURE){fs.writeFileSync(process.env.MASTER_WOK_CAPTURE_LOCAL_CUTOVER_FIXTURE,JSON.stringify({initial,final},null,2)+'\n');}
  });
  await rolled('a failure writing the second baseline rolls both destinations and both retirements back',async f=>{
   await db.exec(`ALTER TABLE master_wok_event_test.events ADD CONSTRAINT fail_second_baseline CHECK(stream_id<>'${f.nb}' OR payload->>'kind'<>'CUTOVER_BASELINE')`);
   await refuses(()=>seed(f),/fail_second_baseline/);await assertClean(f);
   await db.exec('ALTER TABLE master_wok_event_test.events DROP CONSTRAINT fail_second_baseline');assert.equal(await seed(f),'RECORDED');
  });
  await rolled('the second source cannot supply a partial basket',async f=>{
   await q('DELETE FROM master_wok_event_test.booking_items WHERE stream_id=$1 AND order_id=$2',[f.b,f.orders.confirmed]);
   await refuses(()=>seed(f),/COMPLETE_BASKET_REQUIRED/);await assertClean(f);
  });
  await rolled('a third counterpart is refused even when disabled',async f=>{
   const third=await scalar('SELECT gen_random_uuid()::text');
   await q("INSERT INTO master_wok_event_test.streams(id,service_date,enabled) VALUES($1,$2::date+1,true)",[third,f.days.b]);
   await call('move_booking_offer',[f.b,third,'third-stream',f.orders.travelling,new Date(Date.parse(f.days.b+'T19:30:00Z')+86400000).toISOString()]);
   await q('UPDATE master_wok_event_test.streams SET enabled=false WHERE id=$1',[third]);
   await refuses(()=>seed(f),/TRANSFER_CLOSURE_REQUIRED/);await assertClean(f);
  });
  await rolled('missing transfer receipts cannot be relabelled complete',async f=>{
   await q("DELETE FROM master_wok_event_test.booking_transfers WHERE request_id='old-return'");
   await refuses(()=>seed(f),/CUTOVER_TRANSFER_HISTORY_REQUIRED/);await assertClean(f);
  });
  await rolled('missing historical counterpart event is refused',async f=>{
   await q("DELETE FROM master_wok_event_test.events WHERE event_id='old-return_in'");
   await refuses(()=>seed(f),/CUTOVER_TRANSFER_HISTORY_REQUIRED/);await assertClean(f);
  });
  await rolled('historical event dates must match the saved transfer receipt',async f=>{
   await q("UPDATE master_wok_event_test.events SET payload=jsonb_set(payload,'{toServiceDate}','\"2099-01-01\"') WHERE event_id='old-return_out'");
   await refuses(()=>seed(f),/CUTOVER_TRANSFER_BINDING_REQUIRED/);await assertClean(f);
  });
  await rolled('historical receipt targets must match their incoming event',async f=>{
   await q("UPDATE master_wok_event_test.booking_transfers SET command=jsonb_set(command,'{target}','\"2099-01-01T18:00:00Z\"') WHERE request_id='old-return'");
   await refuses(()=>seed(f),/CUTOVER_TRANSFER_BINDING_REQUIRED/);await assertClean(f);
  });
  await rolled('two held copies of an order cannot survive cutover',async f=>{
   await q("INSERT INTO master_wok_event_test.reservations SELECT $1,order_id,commitment,proposal_event_id,order_payload FROM master_wok_event_test.reservations WHERE stream_id=$2 AND order_id='synthetic-travelling'",[f.a,f.b]);
   await refuses(()=>seed(f),/CUTOVER_ORDER_OWNERSHIP_REQUIRED/);await assertClean(f);
  });
  await rolled('a moved order needs its matching current owner and basket',async f=>{
   await q("UPDATE master_wok_event_test.booking_items SET qty=2 WHERE stream_id=$1 AND order_id=$2",[f.a,f.orders.travelling]);
   await refuses(()=>seed(f),/CUTOVER_MOVED_STATE_UNVERIFIED/);await assertClean(f);
  });
  await rolled('disabled sources and mismatched destination dates are refused',async f=>{
   await q('UPDATE master_wok_event_test.streams SET enabled=false WHERE id=$1',[f.a]);
   await refuses(()=>seed(f),/CUTOVER_PAIR_SCOPE_REQUIRED/);await q('UPDATE master_wok_event_test.streams SET enabled=true WHERE id=$1',[f.a]);
   await q('UPDATE master_wok_event_test.streams SET service_date=service_date+1 WHERE id=$1',[f.nb]);
   await refuses(()=>seed(f),/CUTOVER_PAIR_SCOPE_REQUIRED/);await assertClean(f);
  });
  await rolled('non-empty destinations and request collisions are refused',async f=>{
   await call('create_booking',[f.na,'destination-row',await scalar('SELECT gen_random_uuid()::text'),'synthetic-destination',f.days.a+'T18:00:00Z',lines]);
   await refuses(()=>seed(f),/EMPTY_DESTINATION_REQUIRED/);
   await refuses(()=>call('seed_cutover_pair',[f.a,f.na,f.b,f.nb,'destination-row']),/REQUEST_ID_REUSED/);
  });
  await rolled('single-stream cutover continues to refuse connected histories',async f=>{
   await refuses(()=>call('seed_cutover_baseline',[f.a,f.na,'single-refused']),/CONNECTED_CUTOVER_REQUIRED/);await assertClean(f);
  });
  await rolled('changed retry mapping is refused after success',async f=>{
   await seed(f);const other=await scalar('SELECT gen_random_uuid()::text');
   await q('INSERT INTO master_wok_event_test.streams(id,service_date,enabled) VALUES($1,$2,true)',[other,f.days.b]);
   await refuses(()=>call('seed_cutover_pair',[f.a,f.na,f.b,other,'pair-cutover']),/REQUEST_ID_REUSED/);
  });
  await rolled('completed current owner does not resurrect capacity on either day',async f=>{
   await call('apply_booking',[f.b,'complete-before-cutover',f.orders.travelling,'complete',null,null]);
   await seed(f);const bundle=await call('export_transfer_pair',[f.na,f.nb]);const result=compareTransferBundle(bundle,{enabled:true});
   assert.equal(result.status,'COMPARED');assert.deepEqual(result.results.map(s=>s.result.remainingCommitments),[1,1]);
   assert.ok(bundle.streams.every(s=>s.batch.events[0].commitments.every(c=>c.order.orderId!=='synthetic-travelling')));
   await later();await refuses(()=>call('apply_booking',[f.nb,'reopen-completed',f.orders.travelling,'offer',f.days.b+'T20:00:00Z',null]),/TERMINAL_ORDER/);
  });
  await rolled('delivery evidence keeps its original time at cutover and clears on a later date move',async f=>{
   await q("UPDATE master_wok_event_test.booking_rows SET order_type='delivery' WHERE stream_id=ANY($1::uuid[]) AND id=$2",[[f.a,f.b],f.orders.travelling]);
   const estimatedAt=await scalar("SELECT to_char((clock_timestamp()-interval '45 minutes') AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')");
   const estimate={basis:'DELIVERY_PLANNER_ESTIMATE',estimatedAt,foodReadyAt:f.days.b+'T19:17:00Z',arrivalAt:f.days.b+'T19:30:00Z'};
   await q("UPDATE master_wok_event_test.reservations SET order_payload=jsonb_set(jsonb_set(order_payload,'{orderType}','\"delivery\"'),'{deliveryReadyEstimate}',$2::jsonb) WHERE stream_id=$1 AND order_id='synthetic-travelling'",[f.b,estimate]);
   await seed(f);const bundle=await call('export_transfer_pair',[f.na,f.nb]);assert.equal(compareTransferBundle(bundle,{enabled:true}).status,'COMPARED');
   assert.deepEqual(bundle.streams.find(s=>s.streamId===f.nb).batch.events[0].commitments.find(c=>c.order.orderId==='synthetic-travelling').order.deliveryReadyEstimate,estimate);
   await later();await call('move_booking_offer',[f.nb,f.na,'delivery-return-after-cutover',f.orders.travelling,f.days.a+'T20:00:00Z']);
   const final=await call('export_transfer_pair',[f.na,f.nb]);assert.equal(compareTransferBundle(final,{enabled:true}).status,'COMPARED');
   assert.equal(final.streams.find(s=>s.streamId===f.na).batch.events[1].order.deliveryReadyEstimate,null);
  });
  await t.test('snapshot and pair seed are invoker-only, VOLATILE and denied to public runtime roles',async()=>{
   for(const signature of ['cutover_snapshot(uuid,text,timestamptz,boolean)','seed_cutover_pair(uuid,uuid,uuid,uuid,text)']){
    const name='master_wok_event_test.'+signature;
    assert.deepEqual((await q('SELECT prosecdef,provolatile FROM pg_proc WHERE oid=$1::regprocedure',[name]))[0],{prosecdef:false,provolatile:'v'});
    for(const role of ['anon','authenticated','service_role'])assert.equal(await scalar("SELECT has_function_privilege($1,$2,'EXECUTE')",[role,name]),false);
   }
  });
 }finally{await db.close();}
});

test('actual rolled-back hosted pair export excludes earlier decisions and preserves later pairing',()=>{
 const {initial,final}=require('../fixtures/cutover-pair-staging-captures.json');
 const first=compareTransferBundle(initial,{enabled:true}),last=compareTransferBundle(final,{enabled:true});
 assert.equal(first.status,'COMPARED');assert.equal(last.status,'COMPARED');
 assert.equal(first.transferCount,0);assert.equal(last.transferCount,1);
 assert.equal(first.results.reduce((n,s)=>n+s.result.decisionCount,0),0);
 assert.equal(last.results.reduce((n,s)=>n+s.result.decisionCount,0),1);
 const sorted=last.results.slice().sort((a,b)=>a.result.serviceDate.localeCompare(b.result.serviceDate));
 assert.deepEqual(sorted.map(s=>s.result.remainingCommitments),[2,1]);
 assert.ok(last.results.every(s=>s.result.historicalDecisionCoverage===false&&s.result.verified===false));
 assert.equal(initial.streams[0].batch.events[0].at,initial.streams[1].batch.events[0].at);
});
