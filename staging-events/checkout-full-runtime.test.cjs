const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {database}=require('./command-route-test-helper.cjs');
const {prepareCheckout}=require('./checkout-production-field-adapter.cjs');
const {FullSubmissionAttempt}=require('./checkout-full-persistence-client.cjs');
const fixtures=require('../fixtures/checkout-full-trial-26-oct-v1.json');
test('all six full trial envelopes are derived from the reviewed mapper with isolated bindings',async()=>{
 for(const f of fixtures){const m=prepareCheckout(f.input);assert.deepEqual(f.payload,{source:m.source,orderAlias:m.engineProjection.orderId,privateWrite:m.privateWrite});assert.equal(f.input.order.idempotency_key,f.request);assert.equal(f.input.orderId,f.order);assert.equal(f.input.quoteId,f.quote);assert.equal(f.input.routeId,f.route);new FullSubmissionAttempt(f.input);}
 assert.equal(new Set(fixtures.map(f=>f.request)).size,6);assert.equal(new Set(fixtures.map(f=>f.quote)).size,6);assert.equal(new Set(fixtures.map(f=>f.page)).size,3);
});
test('temporary real-role grants permit atomic full snapshots and cleanup revokes access',async()=>{
 const d=await database();const {db,q,scalar}=d;
 try{
  await db.exec(fs.readFileSync(path.join(__dirname,'handlers.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(__dirname,'runtime-role-proposal.sql'),'utf8').replace(/^CREATE ROLE .*;$/gm,''));
  for(const file of ['booking-store-role.sql','delivery-booking-store-role.sql'])await db.exec(fs.readFileSync(path.join(__dirname,file),'utf8'));
  for(const file of ['checkout-full-persistence-candidate.sql','checkout-full-runtime-role.sql','checkout-full-runtime-fixtures.sql'])await db.exec(fs.readFileSync(path.join(__dirname,file),'utf8'));
  assert.equal(await scalar('SELECT count(*)::int FROM master_wok_event_test.streams WHERE enabled'),0);
  await q('UPDATE master_wok_event_test.streams SET enabled=true');
  for(const f of fixtures){
   await db.exec('BEGIN; SET LOCAL ROLE master_wok_event_writer_login;');
   assert.equal(await scalar('SELECT master_wok_event_test.submit_full_checkout($1,$2,$3,$4,$5)',[f.route,f.request,f.order,f.quote,f.payload]),'RECORDED');
   assert.equal(await scalar('SELECT master_wok_event_test.submit_full_checkout($1,$2,$3,$4,$5)',[f.route,f.request,f.order,f.quote,f.payload]),'ALREADY_RECORDED');
   await db.exec('COMMIT;');
   assert.deepEqual(await scalar('SELECT payload FROM master_wok_event_test.full_checkout_orders WHERE route_id=$1 AND request_id=$2',[f.route,f.request]),f.input.order);
   assert.deepEqual((await q('SELECT payload FROM master_wok_event_test.full_checkout_items WHERE route_id=$1 AND request_id=$2 ORDER BY line_no',[f.route,f.request])).map(x=>x.payload),f.input.items);
  }
  const denied=["SELECT * FROM master_wok_event_test.full_checkout_orders","SELECT * FROM master_wok_event_test.full_checkout_items","UPDATE master_wok_event_test.full_checkout_quotes SET payload='{}'","DELETE FROM master_wok_event_test.full_checkout_submissions"];
  for(const sql of denied){await db.exec('BEGIN; SET LOCAL ROLE master_wok_event_writer_login;');await assert.rejects(db.exec(sql),/permission denied/);await db.exec('ROLLBACK;');}
  const f=fixtures[4],packet={eventCount:2,batch:await scalar('SELECT master_wok_event_test.export($1)',[f.stream])};
  if(process.env.MASTER_WOK_WRITE_FULL_CAPTURE==='1')fs.writeFileSync(path.join(__dirname,'../fixtures/checkout-full-local-capture.json'),JSON.stringify(packet,null,2)+'\n');
  await db.exec(fs.readFileSync(path.join(__dirname,'checkout-full-runtime-cleanup.sql'),'utf8'));
  assert.equal(await scalar('SELECT count(*)::int FROM master_wok_event_test.streams WHERE enabled'),0);
  assert.equal(await scalar("SELECT has_function_privilege('master_wok_event_writer_login','master_wok_event_test.submit_full_checkout(uuid,text,uuid,uuid,jsonb)','EXECUTE')"),false);
  for(const table of ['full_checkout_quotes','full_checkout_submissions','full_checkout_orders','full_checkout_items'])assert.equal(await scalar("SELECT has_table_privilege('master_wok_event_writer_login',$1,'SELECT,INSERT,UPDATE,DELETE')",['master_wok_event_test.'+table]),false);
 }finally{await db.close();}
});
