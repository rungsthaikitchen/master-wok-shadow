const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const {validateEventBatch,replay}=require('../master-wok-chronological-replay');

test('source cutover runs against isolated PostgreSQL with rollback',async t=>{
 const db=new PGlite();
 try{
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  for(const f of ['schema.sql','booking-store.sql','delivery-booking-store.sql','cutover-record-export.sql','cutover-baseline-snapshot.sql','cutover-baseline-store.sql']) await db.exec(fs.readFileSync(path.join(__dirname,f),'utf8'));
  const q=async(sql,args=[]) => (await db.query(sql,args)).rows;
  const scalar=async(sql,args=[]) => Object.values((await q(sql,args))[0])[0];
  const call=async(name,args) => scalar(`SELECT master_wok_event_test.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')})`,args);
  async function fixtures(){
   const day=await scalar("SELECT ((clock_timestamp() AT TIME ZONE 'Europe/London')::date+1)::text");
   const src=await scalar('SELECT gen_random_uuid()::text');const dst=await scalar('SELECT gen_random_uuid()::text');
   await q('INSERT INTO master_wok_event_test.streams(id,service_date,enabled) VALUES($1,$3,true),($2,$3,true)',[src,dst,day]);
   const ids={};
   for(const a of ['offer','confirmed','unreserved','pending']){
    ids[a]=await scalar('SELECT gen_random_uuid()::text');
    await call('create_booking',[src,'create_'+a,ids[a],'synthetic-'+a,day+'T17:00:00Z',[{item_id:'green-curry',qty:1,modifiers:[{id:'chicken'}]}]]);
   }
   await call('apply_booking',[src,'offer_current',ids.offer,'offer',day+'T18:00:00Z',null]);
   await call('apply_booking',[src,'confirm_current',ids.confirmed,'confirm',null,null]);
   await call('apply_booking',[src,'offer_rejected',ids.unreserved,'offer',day+'T18:30:00Z',null]);
   await call('apply_booking',[src,'reject_current',ids.unreserved,'reject',null,'offer_rejected']);
   return {src,dst,ids,day};
  }
  async function rolled(name,fn){await t.test(name,async()=>{await db.exec('BEGIN');try{await fn(await fixtures());}finally{await db.exec('ROLLBACK');}});}
  const seed=f=>call('seed_cutover_baseline',[f.src,f.dst,'baseline_capture']);
  async function refuses(fn,error){await db.exec('SAVEPOINT expected_refusal');try{await assert.rejects(fn,error);}finally{await db.exec('ROLLBACK TO expected_refusal');}}
  const later=()=>new Promise(resolve=>setTimeout(resolve,4));
  await rolled('snapshot seeds exact held targets, baskets, revisions and future-only replay',async f=>{
   assert.equal(await seed(f),'RECORDED');
   let batch=await call('export',[f.dst]);validateEventBatch(batch);
   let result=replay(batch,{enabled:true});assert.equal(result.decisionCount,0);assert.equal(result.baselineCommitments,3);assert.equal(result.historicalDecisionCoverage,false);
   assert.deepEqual(batch.events[0].unreservedOrderIds,['synthetic-unreserved']);
   const offer=batch.events[0].commitments.find(c=>c.order.orderId==='synthetic-offer');
   assert.equal(offer.proposalEventId,'offer_current');assert.equal(offer.order.targetAt,f.day+'T18:00:00.000000Z');
   await later();await call('apply_booking',[f.dst,'accept_after',f.ids.offer,'accept',null,'offer_current']);
   assert.equal(await scalar('SELECT count(*)::int FROM master_wok_event_test.reservations WHERE stream_id=$1',[f.dst]),3);
   await call('apply_booking',[f.dst,'next_offer',f.ids.pending,'offer',f.day+'T19:00:00Z',null]);
   await refuses(()=>call('apply_booking',[f.dst,'stale_accept',f.ids.pending,'accept',null,'create_pending']),/STALE_PROPOSAL_RESPONSE/);
   await call('apply_booking',[f.dst,'reject_next',f.ids.pending,'reject',null,'next_offer']);
   await call('apply_booking',[f.dst,'close_unreserved',f.ids.unreserved,'complete',null,null]);
   batch=await call('export',[f.dst]);validateEventBatch(batch);result=replay(batch,{enabled:true});
   assert.equal(result.decisionCount,1);assert.equal(result.remainingCommitments,2);assert.equal(result.verified,false);
   assert.equal(await scalar('SELECT enabled FROM master_wok_event_test.streams WHERE id=$1',[f.src]),false);
   await refuses(()=>call('apply_booking',[f.src,'late_old_writer',f.ids.offer,'cancel',null,null]),/SOURCE_DISABLED/);
   assert.equal(await seed(f),'ALREADY_RECORDED');
   // Earlier create receipt was copied, so a client retry does not create another event.
   assert.equal(await call('create_booking',[f.dst,'create_pending',f.ids.pending,'synthetic-pending',f.day+'T17:00:00Z',[{item_id:'green-curry',qty:1,modifiers:[{id:'chicken'}]}]]),'ALREADY_RECORDED');
   assert.equal((await call('export',[f.dst])).events.length,batch.events.length);
  });
  await rolled('failure after seed rolls back cutover, receipts and all projection copies',async f=>{
   await db.exec('SAVEPOINT before_seed');await seed(f);
   await assert.rejects(db.exec('SELECT 1/0'),/division by zero/);await db.exec('ROLLBACK TO before_seed');
   assert.equal(await scalar('SELECT enabled FROM master_wok_event_test.streams WHERE id=$1',[f.src]),true);
   for(const table of ['events','booking_rows','booking_items','booking_commands','reservations']) assert.equal(await scalar(`SELECT count(*)::int FROM master_wok_event_test.${table} WHERE stream_id=$1`,[f.dst]),0);
   assert.equal(await seed(f),'RECORDED');
  });
  for(const [name,sql,error] of [
   ['missing basket','DELETE FROM master_wok_event_test.booking_items WHERE stream_id=$1 AND order_id=$2','COMPLETE_BASKET_REQUIRED'],
   ['stale offer revision',"UPDATE master_wok_event_test.booking_rows SET current_proposal_event_id='wrong' WHERE stream_id=$1 AND id=$2",'CUTOVER_REVISION_UNVERIFIED'],
   ['mismatched target',"UPDATE master_wok_event_test.reservations SET order_payload=jsonb_set(order_payload,'{targetAt}','\"2099-01-01T18:00:00Z\"') WHERE stream_id=$1 AND order_id='synthetic-offer'",'COMPLETE_RESERVATION_PAYLOAD_REQUIRED'],
   ['extra private payload',"UPDATE master_wok_event_test.reservations SET order_payload=order_payload||'{\"address\":\"refused\"}' WHERE stream_id=$1 AND order_id='synthetic-offer'",'COMPLETE_RESERVATION_PAYLOAD_REQUIRED'],
   ['duplicate held revision',"UPDATE master_wok_event_test.reservations SET proposal_event_id='offer_current' WHERE stream_id=$1 AND order_id='synthetic-pending'",'DUPLICATE_PROPOSAL_REVISION'],
   ['unknown lifecycle status',"UPDATE master_wok_event_test.booking_rows SET status='unknown' WHERE stream_id=$1 AND id=$2",'CUTOVER_STATUS_UNVERIFIED'],
   ['private modifier field',"UPDATE master_wok_event_test.booking_items SET modifiers='[{\"id\":\"chicken\",\"notes\":\"private\"}]' WHERE stream_id=$1 AND order_id=$2",'MODIFIER_REQUIRED'],
   ['uncovered active booking',"DELETE FROM master_wok_event_test.reservations WHERE stream_id=$1 AND order_id='synthetic-offer'",'RESERVATION_STATE_MISMATCH']
  ]) await rolled(`refuses ${name} atomically`,async f=>{
   await q(sql,[f.src,...(sql.includes('$2')?[f.ids.offer]:[])]);await db.exec('SAVEPOINT refusal');
   await assert.rejects(seed(f),new RegExp(error));await db.exec('ROLLBACK TO refusal');
   assert.equal(await scalar('SELECT enabled FROM master_wok_event_test.streams WHERE id=$1',[f.src]),true);
   assert.equal(await scalar('SELECT event_count FROM master_wok_event_test.streams WHERE id=$1',[f.dst]),0);
   assert.equal(await scalar('SELECT count(*)::int FROM master_wok_event_test.booking_rows WHERE stream_id=$1',[f.dst]),0);
  });
  await rolled('pending hold cannot be accepted as a communicated offer',async f=>{
   await seed(f);await later();await refuses(()=>call('apply_booking',[f.dst,'false_accept',f.ids.pending,'accept',null,'create_pending']),/STALE_PROPOSAL_RESPONSE/);
  });
  await rolled('same-millisecond events are refused without invented timestamps',async f=>{
   await seed(f);const batch=await call('export',[f.dst]);
   await refuses(()=>call('record',[f.dst,{eventId:'same_clock',at:batch.events[0].at,kind:'PROPOSAL_RESPONSE',orderId:'synthetic-offer',proposalEventId:'offer_current',response:'ACCEPTED'}]),/CUTOVER_EVENT_BARRIER_REQUIRED/);
  });
  await rolled('cutover command cannot reuse a historical request id',async f=>{
   await refuses(()=>call('seed_cutover_baseline',[f.src,f.dst,'offer_current']),/REQUEST_ID_REUSED/);
  });
  await rolled('delivery estimate is preserved byte-for-byte, including old evidence time',async f=>{
   const delivery=await scalar('SELECT gen_random_uuid()::text');
   await call('create_delivery_booking',[f.src,'create_delivery',delivery,'synthetic-delivery',f.day+'T19:00:00Z',[{item_id:'green-curry',qty:1,modifiers:[{id:'chicken'}]}],null]);
   const estimatedAt=await scalar("SELECT to_char((clock_timestamp()-interval '45 minutes') AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')");
   const estimate={basis:'DELIVERY_PLANNER_ESTIMATE',estimatedAt,foodReadyAt:f.day+'T18:47:00Z',arrivalAt:f.day+'T19:00:00Z'};
   await q("UPDATE master_wok_event_test.reservations SET order_payload=jsonb_set(order_payload,'{deliveryReadyEstimate}',$2::jsonb) WHERE stream_id=$1 AND order_id='synthetic-delivery'",[f.src,estimate]);
   await seed(f);const batch=await call('export',[f.dst]);validateEventBatch(batch);
   assert.deepEqual(batch.events[0].commitments.find(c=>c.order.orderId==='synthetic-delivery').order.deliveryReadyEstimate,estimate);
   assert.equal(replay(batch,{enabled:true}).decisionCount,0);
  });
  await rolled('refuses non-empty destination and another service day',async f=>{
   await q('UPDATE master_wok_event_test.streams SET service_date=service_date+1 WHERE id=$1',[f.dst]);
   await refuses(()=>seed(f),/CUTOVER_SCOPE_REQUIRED/);
   await q('UPDATE master_wok_event_test.streams SET service_date=service_date-1 WHERE id=$1',[f.dst]);
   await call('create_booking',[f.dst,'destination_booking',await scalar('SELECT gen_random_uuid()::text'),'synthetic-destination',f.day+'T17:00:00Z',[{item_id:'jasmine-rice',qty:1,modifiers:[]}]]);
   await refuses(()=>seed(f),/EMPTY_DESTINATION_REQUIRED/);
  });
  await rolled('refuses connected histories requiring a coordinated multi-stream cutover',async f=>{
   await q("INSERT INTO master_wok_event_test.events VALUES($1,999,'transfer_marker','{\"kind\":\"RESERVATION_TRANSFERRED_OUT\"}')",[f.src]);
   await refuses(()=>seed(f),/CONNECTED_CUTOVER_REQUIRED/);
  });
  await rolled('captured revision ids cannot become later event ids',async f=>{
   await seed(f);await later();const batch=await call('export',[f.dst]);
   await refuses(()=>call('record',[f.dst,{eventId:'offer_current',at:new Date().toISOString(),kind:'PROPOSAL_RESPONSE',orderId:'synthetic-offer',proposalEventId:'offer_current',response:'ACCEPTED'}]),/EVENT_ID_REUSED/);
   assert.equal((await call('export',[f.dst])).events.length,batch.events.length);
  });
  await t.test('candidate grants no runtime execution and uses invoker permissions',async()=>{
   for(const role of ['anon','authenticated','service_role']) assert.equal(await scalar("SELECT has_function_privilege($1,'master_wok_event_test.seed_cutover_baseline(uuid,uuid,text)','EXECUTE')",[role]),false);
   assert.equal(await scalar("SELECT prosecdef FROM pg_proc WHERE oid='master_wok_event_test.seed_cutover_baseline(uuid,uuid,text)'::regprocedure"),false);
  });
 }finally{await db.close();}
});

test('actual rolled-back hosted cutover export preserves future-only lifecycle',()=>{
 const batch=require('../fixtures/cutover-baseline-staging-capture.json');
 assert.equal(validateEventBatch(batch).length,5);
 const result=replay(batch,{enabled:true});
 assert.equal(result.status,'REPLAYED');assert.equal(result.decisionCount,1);
 assert.equal(result.baselineCommitments,1);assert.equal(result.remainingCommitments,0);
 assert.equal(result.historicalDecisionCoverage,false);assert.equal(result.verified,false);
 assert.deepEqual(batch.events.map(e=>e.kind),['CUTOVER_BASELINE','PROPOSAL_RESPONSE','BOOKING_DECISION','PROPOSAL_RESPONSE','ORDER_STATE_CHANGED']);
});
