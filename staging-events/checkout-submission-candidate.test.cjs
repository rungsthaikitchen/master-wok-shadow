const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {database}=require('./command-route-test-helper.cjs');
test('complete checkout, engine basket, reservation, event and receipt share one transaction',async t=>{
 const d=await database();const {db,q,scalar,call}=d;
 await db.exec(fs.readFileSync(path.join(__dirname,'checkout-submission-candidate.sql'),'utf8'));
 async function fixture(){
  const f=await d.fixture(true);f.quote=await scalar('SELECT gen_random_uuid()::text');
  f.payload={order_alias:'synthetic-checkout',customer_alias:'synthetic-customer',order_type:'collection',preferred_time:f.day+'T18:00:00Z',payment_preference:'cash',communication_preference:'sms',subtotal_pence:2400,discount_pence:200,delivery_fee_pence:0,total_pence:2200,lines:[{item_id:'green-curry',qty:2,unit_price_pence:1200,spice:2,modifiers:[{id:'chicken',delta_pence:0}]}]};
  return f;
 }
 async function quote(f){await q("INSERT INTO master_wok_event_test.checkout_quotes(id,route_id,payload,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '10 minutes')",[f.quote,f.route,f.payload]);}
 const submit=(f,rid='checkout')=>call('submit_checkout',[f.route,rid,f.booking,f.quote,f.payload]);
 async function counts(f){return (await q('SELECT (SELECT count(*)::integer FROM master_wok_event_test.checkout_submissions WHERE route_id=$1) AS receipts,(SELECT count(*)::integer FROM master_wok_event_test.booking_rows WHERE stream_id=$2) AS orders,(SELECT count(*)::integer FROM master_wok_event_test.booking_items WHERE stream_id=$2) AS items,(SELECT count(*)::integer FROM master_wok_event_test.reservations WHERE stream_id=$2) AS reservations,(SELECT event_count FROM master_wok_event_test.streams WHERE id=$2) AS events',[f.route,f.src]))[0];}
 const empty={receipts:0,orders:0,items:0,reservations:0,events:0};
 try{
  await t.test('full supported snapshot persists; engine export excludes customer and money',async()=>{
   const f=await fixture();await quote(f);assert.equal(await submit(f),'RECORDED');assert.deepEqual(await counts(f),{receipts:1,orders:1,items:1,reservations:1,events:1});
   assert.deepEqual(await scalar('SELECT committed_payload FROM master_wok_event_test.checkout_submissions WHERE route_id=$1',[f.route]),f.payload);
   const e=await scalar('SELECT payload FROM master_wok_event_test.events WHERE stream_id=$1',[f.src]);
   assert.equal(e.kind,'RESERVATION_SET');assert.equal(e.actualDecision,undefined);assert.equal(e.order.lines[0].qty,2);assert.deepEqual(e.order.lines[0].mods,[{id:'chicken'}]);assert.equal(JSON.stringify(e).includes('customer_alias'),false);assert.equal(JSON.stringify(e).includes('pence'),false);
  });
  await t.test('bad second basket line rolls back receipt, first line, order, event and hold',async()=>{
   const f=await fixture();f.payload.lines.push({...f.payload.lines[0],item_id:'INVALID'});f.payload.subtotal_pence=4800;f.payload.total_pence=4600;await quote(f);
   await assert.rejects(submit(f));assert.deepEqual(await counts(f),empty);
  });
  await t.test('outbox failure cannot leave a persisted checkout or partial booking',async()=>{
   const f=await fixture();await quote(f);
   await db.exec("CREATE FUNCTION master_wok_event_test.fail_checkout_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'INJECTED_OUTBOX_FAILURE'; END $$; CREATE TRIGGER fail_checkout_event BEFORE INSERT ON master_wok_event_test.events FOR EACH ROW EXECUTE FUNCTION master_wok_event_test.fail_checkout_event();");
   try{await assert.rejects(submit(f),/INJECTED_OUTBOX_FAILURE/);assert.deepEqual(await counts(f),empty);}finally{await db.exec('DROP TRIGGER fail_checkout_event ON master_wok_event_test.events; DROP FUNCTION master_wok_event_test.fail_checkout_event();');}
  });
  await t.test('late command-receipt failure rolls back an already appended event and reservation',async()=>{
   const f=await fixture();await quote(f);
   await db.exec("CREATE FUNCTION master_wok_event_test.fail_checkout_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'INJECTED_RECEIPT_FAILURE'; END $$; CREATE TRIGGER fail_checkout_receipt BEFORE INSERT ON master_wok_event_test.booking_commands FOR EACH ROW EXECUTE FUNCTION master_wok_event_test.fail_checkout_receipt();");
   try{await assert.rejects(submit(f),/INJECTED_RECEIPT_FAILURE/);assert.deepEqual(await counts(f),empty);}finally{await db.exec('DROP TRIGGER fail_checkout_receipt ON master_wok_event_test.booking_commands; DROP FUNCTION master_wok_event_test.fail_checkout_receipt();');}
  });
  await t.test('unquoted changes and inconsistent totals refuse the whole submission',async()=>{
   const f=await fixture();await quote(f);f.payload.total_pence=1;await assert.rejects(submit(f),/TRUSTED_QUOTE_MISMATCH/);assert.deepEqual(await counts(f),empty);
   await q('UPDATE master_wok_event_test.checkout_quotes SET payload=$2 WHERE id=$1',[f.quote,f.payload]);await assert.rejects(submit(f),/CHECKOUT_TOTAL_MISMATCH/);assert.deepEqual(await counts(f),empty);
  });
  await t.test('empty basket, fractional money and unexpected private fields are rejected',async()=>{
   for(const change of [p=>p.lines=[],p=>p.total_pence=2200.5,p=>p.address='synthetic-address']){
    const f=await fixture();change(f.payload);await quote(f);await assert.rejects(submit(f));assert.deepEqual(await counts(f),empty);
   }
  });
  await t.test('same quote cannot create another order; changed idempotency payload is refused',async()=>{
   const f=await fixture();await quote(f);await submit(f);await assert.rejects(submit(f,'another-request'),/CHECKOUT_QUOTE_USED/);
   f.booking=await scalar('SELECT gen_random_uuid()::text');await assert.rejects(submit(f),/CHECKOUT_REQUEST_REUSED/);assert.equal((await counts(f)).events,1);
  });
  await t.test('adapter loses a response after SQL commit and retries the identical basket without duplication',async()=>{
   const {SubmissionAttempt,PROJECT,QUERY}=require('./checkout-submission-client.cjs');
   const f=await fixture();await quote(f);const attempt=new SubmissionAttempt({enabled:true,project:PROJECT,routeId:f.route,requestId:'lost-checkout-response',orderId:f.booking,quoteId:f.quote,checkout:f.payload});
   await assert.rejects(attempt.submit(async p=>{assert.equal(p.query,QUERY);await q(p.query,p.parameters);throw Error('response lost after commit');}),/CHECKOUT_SUBMISSION_FAILED/);
   assert.equal((await attempt.submit(p=>q(p.query,p.parameters))).status,'ALREADY_RECORDED');assert.deepEqual(await counts(f),{receipts:1,orders:1,items:1,reservations:1,events:1});
  });
  await t.test('expiry blocks new writes but committed exact retry survives expiry and a later offer',async()=>{
   const f=await fixture();await quote(f);await submit(f);
   await call('routed_apply_booking',[f.route,'later-offer','synthetic-checkout','offer',f.day+'T19:00:00Z',null,null]);
   await q("UPDATE master_wok_event_test.checkout_quotes SET created_at=clock_timestamp()-interval '20 minutes',expires_at=clock_timestamp()-interval '10 minutes' WHERE id=$1",[f.quote]);
   assert.equal(await submit(f),'ALREADY_RECORDED');assert.equal((await counts(f)).events,2);
   const fresh=await fixture();await quote(fresh);await q("UPDATE master_wok_event_test.checkout_quotes SET created_at=clock_timestamp()-interval '20 minutes',expires_at=clock_timestamp()-interval '10 minutes' WHERE id=$1",[fresh.quote]);await assert.rejects(submit(fresh),/CHECKOUT_QUOTE_EXPIRED/);assert.deepEqual(await counts(fresh),empty);
  });
  await t.test('route-wide receipt survives cutover without recreating the booking in the destination',async()=>{
   const f=await fixture();await quote(f);await submit(f);await call('switch_command_route',[f.route,0,f.dst,'checkout-cutover']);
   assert.equal(await submit(f),'ALREADY_RECORDED');assert.equal(await scalar('SELECT event_count FROM master_wok_event_test.streams WHERE id=$1',[f.dst]),1);
  });
  await t.test('delivery is persisted without inventing food-ready or driver activity',async()=>{
   const f=await fixture();f.payload.order_type='delivery';f.payload.delivery_fee_pence=300;f.payload.total_pence=2500;await quote(f);await submit(f);
   const e=await scalar('SELECT payload FROM master_wok_event_test.events WHERE stream_id=$1',[f.src]);assert.equal(e.order.orderType,'delivery');assert.equal(e.order.deliveryReadyEstimate,null);assert.equal(e.kind,'RESERVATION_SET');
  });
  await t.test('disabled route and public execution remain refused',async()=>{
   const f=await fixture();await quote(f);await q('UPDATE master_wok_event_test.streams SET enabled=false WHERE id=$1',[f.src]);await assert.rejects(submit(f),/CURRENT_ROUTE_DISABLED/);assert.deepEqual(await counts(f),empty);
   for(const role of ['anon','authenticated','service_role','master_wok_event_writer_login'])assert.equal(await scalar("SELECT has_function_privilege($1,'master_wok_event_test.submit_checkout(uuid,text,uuid,uuid,jsonb)','EXECUTE')",[role]),false);
  });
 }finally{await db.close();}
});
