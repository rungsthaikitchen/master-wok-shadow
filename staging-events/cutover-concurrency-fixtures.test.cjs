const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const {validateEventBatch,replay}=require('../master-wok-chronological-replay');

// Control only the database clock in this isolated test. Execute the prepared SQL
// and real handlers with a moving clock so the expiring pack stays testable later.
const clocked=sql=>sql.replaceAll('clock_timestamp()','public.fixture_clock()');
const fixture=fs.readFileSync(path.join(__dirname,'cutover-concurrency-fixtures-25-oct.sql'),'utf8');
const runner=fs.readFileSync(path.join(__dirname,'../railway-shadow/event_cutover_trial.py'),'utf8');
const preflight=runner.match(/^PREFLIGHT='([^']+)'$/m)[1].replace('%s','$1');
const cases=[...fixture.matchAll(/VALUES\('([^']+)','2026-10-25',true\),\('([^']+)','2026-10-25',false\);\s+PERFORM master_wok_event_test.create_booking\('[^']+','cutover-create-([^']+)','([^']+)'/g)]
 .map(m=>({src:m[1],dst:m[2],label:m[3],order:m[4]}));

test('refreshed cutover fixture pack executes real PostgreSQL functions',async t=>{
 const db=new PGlite();
 const q=async(sql,args=[]) => (await db.query(sql,args)).rows;
 const scalar=async(sql,args=[]) => Object.values((await q(sql,args))[0])[0];
 const call=(name,args)=>scalar(`SELECT master_wok_event_test.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')})`,args);
 const clock=async day=>q("SELECT set_config('fixture.base',$1,false),set_config('fixture.anchor',clock_timestamp()::text,false)",[day]);
 const snapshot=async()=>JSON.stringify(await q('SELECT id,service_date,enabled,event_count FROM master_wok_event_test.streams ORDER BY id'));
 const refuse=async(fn,error)=>{
  await db.exec('SAVEPOINT refusal');
  try{await assert.rejects(fn,error);}finally{await db.exec('ROLLBACK TO refusal');}
 };
 try{
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE FUNCTION public.fixture_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$ SELECT current_setting('fixture.base')::timestamptz+(pg_catalog.clock_timestamp()-current_setting('fixture.anchor')::timestamptz) $$;");
  await clock('2026-10-24T12:00:00Z');
  for(const file of ['schema.sql','booking-store.sql','delivery-booking-store.sql','cutover-record-export.sql','cutover-baseline-snapshot.sql','cutover-baseline-store.sql']) await db.exec(clocked(fs.readFileSync(path.join(__dirname,file),'utf8')));
  assert.equal(cases.length,4);
  await t.test('atomic preparation leaves eight disabled streams and four exact baskets',async()=>{
   await db.exec(clocked(fixture));
   assert.equal(await scalar('SELECT count(*)::int FROM master_wok_event_test.streams'),8);
   assert.equal(await scalar('SELECT count(*)::int FROM master_wok_event_test.streams WHERE enabled'),0);
   assert.equal(await scalar('SELECT count(*)::int FROM master_wok_event_test.booking_rows'),4);
   for(const c of cases){
    assert.equal(await scalar('SELECT event_count FROM master_wok_event_test.streams WHERE id=$1',[c.src]),1);
    assert.equal(await scalar('SELECT event_count FROM master_wok_event_test.streams WHERE id=$1',[c.dst]),0);
    assert.equal(await scalar('SELECT qty FROM master_wok_event_test.booking_items WHERE stream_id=$1 AND order_id=$2',[c.src,c.order]),1);
   }
  });
  await t.test('repeated preparation refuses collisions without erasing history',async()=>{
   const before=await snapshot();
   await assert.rejects(db.exec(clocked(fixture)),/duplicate key/);await db.exec('ROLLBACK');
   assert.equal(await snapshot(),before);
  });
  await t.test('disabled fixtures refuse writes before explicit activation',async()=>{
   await db.exec('BEGIN');
   try{await refuse(()=>call('apply_booking',[cases[0].src,'disabled-offer',cases[0].order,'offer','2026-10-25T19:15:00Z',null]),/SOURCE_DISABLED/);}
   finally{await db.exec('ROLLBACK');}
  });
  await t.test('runner preflight query reads all exact service dates and event counts',async()=>{
   await db.exec('BEGIN');
   try{
    const ids=cases.flatMap(c=>[c.src,c.dst]);
    await q('UPDATE master_wok_event_test.streams SET enabled=true WHERE id=ANY($1::uuid[])',[ids]);
    const rows=await q(preflight,[ids]);assert.equal(rows.length,8);
    for(const row of rows){
     assert.equal(row.service_date,'2026-10-25');assert.equal(row.scope,'SYNTHETIC_STAGING_EVENTS');assert.equal(row.enabled,true);
     assert.equal(row.event_count,cases.some(c=>c.src===row.id)?1:0);
    }
   }finally{await db.exec('ROLLBACK');}
  });
  await t.test('late identity conflict rolls back earlier pairs and their reservations',async()=>{
   await db.exec('BEGIN');
   await db.exec('DELETE FROM master_wok_event_test.reservations; DELETE FROM master_wok_event_test.booking_items; DELETE FROM master_wok_event_test.booking_commands; DELETE FROM master_wok_event_test.booking_rows; DELETE FROM master_wok_event_test.events; DELETE FROM master_wok_event_test.streams;');
   await q('INSERT INTO master_wok_event_test.streams(id,service_date) VALUES($1,$2)',[cases[2].dst,'2026-10-25']);
   // Strip only the outer transaction to inject a collision in the third pair.
   await refuse(()=>db.exec(clocked(fixture).replace('BEGIN;','').replace('COMMIT;','')),/duplicate key/);
   assert.equal(await scalar('SELECT count(*)::int FROM master_wok_event_test.streams'),1);
   assert.equal(await scalar('SELECT count(*)::int FROM master_wok_event_test.events'),0);
   assert.equal(await scalar('SELECT count(*)::int FROM master_wok_event_test.reservations'),0);
   await db.exec('ROLLBACK');
  });
  await t.test('expired SQL pack refuses before changing saved fixtures',async()=>{
   const before=await snapshot();await clock('2026-10-26T12:00:00Z');
   await assert.rejects(db.exec(clocked(fixture)),/FIXTURES_EXPIRED/);await db.exec('ROLLBACK');
   assert.equal(await snapshot(),before);await clock('2026-10-24T13:00:00Z');
  });
  await t.test('fresh offer enters baseline once and acceptance keeps one commitment',async()=>{
   const c=cases[0];await db.exec('BEGIN');
   try{
    await q('UPDATE master_wok_event_test.streams SET enabled=true WHERE id=ANY($1::uuid[])',[[c.src,c.dst]]);
    await call('apply_booking',[c.src,'cutover-direct-before',c.order,'offer','2026-10-25T19:15:00Z',null]);
    assert.equal(await call('seed_cutover_baseline',[c.src,c.dst,'local-baseline']),'RECORDED');
    assert.equal(await call('seed_cutover_baseline',[c.src,c.dst,'local-baseline']),'ALREADY_RECORDED');
    await new Promise(resolve=>setTimeout(resolve,5));
    await call('apply_booking',[c.dst,'accepted',c.order,'accept',null,'cutover-direct-before']);
    const batch=await call('export',[c.dst]);validateEventBatch(batch);
    const result=replay(batch,{enabled:true});
    assert.equal(result.remainingCommitments,1);assert.equal(result.historicalDecisionCoverage,false);assert.equal(result.verified,false);
    await refuse(()=>call('apply_booking',[c.src,'late-source',c.order,'offer','2026-10-25T19:15:00Z',null]),/SOURCE_DISABLED/);
   }finally{await db.exec('ROLLBACK');}
  });
 }finally{await db.close();}
});
