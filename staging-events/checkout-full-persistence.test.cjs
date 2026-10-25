const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {database}=require('./command-route-test-helper.cjs');
const {FullSubmissionAttempt,QUERY,PROJECT}=require('./checkout-full-persistence-client.cjs');
const {prepareCheckout}=require('./checkout-production-field-adapter.cjs');
const shapes=require('../fixtures/checkout-source-shapes-25-oct.json');
function sample(f,page='index.html'){
 const c={customerId:f.customer,submitTotals:{subtotal:24,delivery_fee:0,delivery_straight_line_miles:null,delivery_route_miles:0,delivery_distance_source:null,total:20,loyalty_discount:3,loyalty_points_redeem_pending:30,loyalty_points_earned_pending:20,loyalty_reward_applied:true,loyalty_expected_balance:100},totalDiscount:4,disc:{discount:1},appliedDiscountCode:'SYNTHETIC',appliedDiscountAmount:1,orderType:'collection',notes:'SYNTHETIC-PRIVATE-NOTE',orderRef:'SYNTHETIC-PRIVATE-REF',payment_preference:'cash',preferredTimeISO:f.day+'T18:30:00Z',finalPreferredTimeISO:f.day+'T18:30:00Z',asapRequested:false,communicationPreference:'sms',idempotencyKey:f.request,orderId:f.booking,item_id:'green-curry',kitchenLoad:1,line:{name:'SYNTHETIC-PRIVATE-DISPLAY',unitPrice:12,qty:2,mods:[{id:'chicken',name:'SYNTHETIC-PRIVATE-MOD',delta:0.001}],spice:2,img:'/synthetic-private.png'}};
 const order=JSON.parse(JSON.stringify(vm.runInNewContext('('+shapes.pages[page].order.expression+')',c)));
 const item=JSON.parse(JSON.stringify(vm.runInNewContext('('+shapes.pages[page].items.expression+')',c)));
 return {enabled:true,project:PROJECT,sourcePage:page,orderId:f.booking,orderAlias:'synthetic-full-persist',order,items:[item,{...structuredClone(item),item_id:'sticky-rice',item_note:'SYNTHETIC-PRIVATE-ITEM-NOTE'}],routeId:f.route,quoteId:f.quote};
}
test('default-off client does not inspect private inputs or call transport',async()=>{
 const a=new FullSubmissionAttempt({get order(){throw Error('PRIVATE');}});
 assert.equal((await a.submit(()=>{throw Error('CALLED');})).status,'DISABLED');
});
test('full field persistence and minimal engine event are atomic (local PostgreSQL)',async t=>{
 const d=await database();const {db,q,scalar,call}=d;
 await db.exec(fs.readFileSync(path.join(__dirname,'checkout-full-persistence-candidate.sql'),'utf8'));
 async function fixture(page){const f=await d.fixture(true);Object.assign(f,(await q('SELECT gen_random_uuid()::text AS quote,gen_random_uuid()::text AS request,gen_random_uuid()::text AS customer'))[0]);f.input=sample(f,page);return f;}
 async function envelope(f){let p;await new FullSubmissionAttempt(f.input).submit(async x=>{p=x.parameters[4];return[{result:'RECORDED'}];});return p;}
 async function quote(f,p){f.payload=p||await envelope(f);await q("INSERT INTO master_wok_event_test.full_checkout_quotes(id,route_id,payload,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '10 minutes')",[f.quote,f.route,f.payload]);}
 const direct=f=>call('submit_full_checkout',[f.route,f.request,f.booking,f.quote,f.payload]);
 const submit=f=>new FullSubmissionAttempt(f.input).submit(p=>q(p.query,p.parameters));
 async function counts(f){return (await q('SELECT (SELECT count(*)::int FROM master_wok_event_test.full_checkout_submissions WHERE route_id=$1) receipts,(SELECT count(*)::int FROM master_wok_event_test.full_checkout_orders WHERE route_id=$1) private_orders,(SELECT count(*)::int FROM master_wok_event_test.full_checkout_items WHERE route_id=$1) private_items,(SELECT count(*)::int FROM master_wok_event_test.booking_rows WHERE stream_id=$2) bookings,(SELECT count(*)::int FROM master_wok_event_test.reservations WHERE stream_id=$2) holds,(SELECT event_count FROM master_wok_event_test.streams WHERE id=$2) events',[f.route,f.src]))[0];}
 const empty={receipts:0,private_orders:0,private_items:0,bookings:0,holds:0,events:0};
 const complete={receipts:1,private_orders:1,private_items:2,bookings:1,holds:1,events:1};
 try{
  await t.test('all three source shapes retain every field, null, absent value and item ordering',async()=>{
   for(const page of Object.keys(shapes.pages)){
    const f=await fixture(page);await quote(f);assert.equal((await submit(f)).status,'RECORDED');assert.deepEqual(await counts(f),complete);
    assert.deepEqual(await scalar('SELECT payload FROM master_wok_event_test.full_checkout_orders WHERE route_id=$1',[f.route]),f.input.order);
    assert.deepEqual((await q('SELECT payload FROM master_wok_event_test.full_checkout_items WHERE route_id=$1 ORDER BY line_no',[f.route])).map(x=>x.payload),f.input.items);
    const e=await scalar('SELECT payload FROM master_wok_event_test.events WHERE stream_id=$1',[f.src]);
    assert.equal(e.kind,'RESERVATION_SET');assert.equal(e.actualDecision,undefined);assert.equal(e.order.lines.length,2);assert.deepEqual(e.order.lines[0].mods,[{id:'chicken'}]);
    for(const canary of [f.customer,f.booking,f.request,'PRIVATE','unit_price','loyalty','discount','spice','kitchen_load','notes','order_ref'])assert.equal(JSON.stringify(e).includes(canary),false,'private canary leaked: '+canary);
   }
  });
  await t.test('financial discrepancies/extra precision persist without repricing',async()=>{
   const f=await fixture();f.input.order.total=17.123;await quote(f);await submit(f);
   assert.equal(await scalar("SELECT (payload->>'total')::numeric FROM master_wok_event_test.full_checkout_orders WHERE route_id=$1",[f.route]),'17.123');
   assert.equal((await scalar('SELECT payload FROM master_wok_event_test.full_checkout_items WHERE route_id=$1 AND line_no=1',[f.route])).modifiers[0].delta,0.001);
  });
  await t.test('failed second private item rolls back first item, receipt, order and engine',async()=>{
   const f=await fixture();await quote(f);
   await db.exec("CREATE FUNCTION master_wok_event_test.fail_full_item() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.line_no=2 THEN RAISE EXCEPTION 'INJECTED_SECOND_ITEM'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_full_item BEFORE INSERT ON master_wok_event_test.full_checkout_items FOR EACH ROW EXECUTE FUNCTION master_wok_event_test.fail_full_item();");
   try{await assert.rejects(direct(f),/INJECTED_SECOND_ITEM/);assert.deepEqual(await counts(f),empty);}finally{await db.exec('DROP TRIGGER fail_full_item ON master_wok_event_test.full_checkout_items; DROP FUNCTION master_wok_event_test.fail_full_item();');}
  });
  for(const [table,label] of [['events','OUTBOX'],['booking_commands','LATE_RECEIPT']])await t.test(label+' failure rolls back full private basket and all engine writes',async()=>{
   const f=await fixture();await quote(f);
   await db.exec(`CREATE FUNCTION master_wok_event_test.fail_full_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'INJECTED_${label}'; END $$; CREATE TRIGGER fail_full_write BEFORE INSERT ON master_wok_event_test.${table} FOR EACH ROW EXECUTE FUNCTION master_wok_event_test.fail_full_write();`);
   try{await assert.rejects(direct(f),new RegExp('INJECTED_'+label));assert.deepEqual(await counts(f),empty);}finally{await db.exec(`DROP TRIGGER fail_full_write ON master_wok_event_test.${table}; DROP FUNCTION master_wok_event_test.fail_full_write();`);}
  });
  await t.test('lost committed response retries frozen full payload without duplicate reservation',async()=>{
   const f=await fixture();await quote(f);const a=new FullSubmissionAttempt(f.input);
   f.input.order.notes='MUTATED';f.input.items.reverse();
   await assert.rejects(a.submit(async p=>{assert.equal(p.query,QUERY);await q(p.query,p.parameters);p.parameters[4].privateWrite.order.notes='TRANSPORT MUTATION';throw Error('PRIVATE lost response');}),/^Error: FULL_CHECKOUT_SUBMISSION_FAILED$/);
   assert.equal((await a.submit(p=>q(p.query,p.parameters))).status,'ALREADY_RECORDED');assert.deepEqual(await counts(f),complete);
   assert.equal((await scalar('SELECT payload FROM master_wok_event_test.full_checkout_orders WHERE route_id=$1',[f.route])).notes,'SYNTHETIC-PRIVATE-NOTE');
  });
  await t.test('changed request, changed quote content, reused quote and cross-order lines refuse',async()=>{
   const f=await fixture();await quote(f);await direct(f);
   f.payload.privateWrite.order.notes='changed';await assert.rejects(direct(f),/FULL_CHECKOUT_REQUEST_REUSED/);
   const fresh=await fixture();await quote(fresh);fresh.payload.privateWrite.order.notes='unquoted';await assert.rejects(direct(fresh),/FULL_CHECKOUT_TRUSTED_QUOTE_MISMATCH/);assert.deepEqual(await counts(fresh),empty);
   const used=await fixture();await quote(used);await direct(used);used.request=await scalar('SELECT gen_random_uuid()::text');await assert.rejects(direct(used),/FULL_CHECKOUT_QUOTE_USED/);
   const cross=await fixture();const p=await envelope(cross);p.privateWrite.items[1].order_id=f.booking;await quote(cross,p);await assert.rejects(direct(cross),/FULL_CHECKOUT_ITEM_REQUIRED/);assert.deepEqual(await counts(cross),empty);
  });
  await t.test('direct SQL rejects malformed or extra fields even when fixture quote matches',async()=>{
   const changes=[p=>p.privateWrite.order.secret='PRIVATE',p=>p.engineProjection={},p=>p.privateWrite.items[1].qty=0,p=>p.privateWrite.order.idempotency_key='wrong',p=>p.privateWrite.items[1].modifiers[0].name=null,p=>p.privateWrite.order.asap_requested=true,p=>p.privateWrite.order.preferred_time='2026-02-30T18:00:00Z',p=>p.source.websiteCommit='unreviewed',p=>p.privateWrite.order.customer_id=null,p=>p.privateWrite.order.preferred_time='2026-10-26T24:00:00Z'];
   for(const change of changes){const f=await fixture();const p=await envelope(f);change(p);await quote(f,p);await assert.rejects(direct(f));assert.deepEqual(await counts(f),empty);}
  });
  await t.test('exact retry survives expiry, a later proposal and route cutover',async()=>{
   const f=await fixture();await quote(f);await direct(f);
   await call('routed_apply_booking',[f.route,'later-proposal','synthetic-full-persist','offer',f.day+'T19:30:00Z',null,null]);
   await q("UPDATE master_wok_event_test.full_checkout_quotes SET created_at=clock_timestamp()-interval '20 minutes',expires_at=clock_timestamp()-interval '10 minutes' WHERE id=$1",[f.quote]);
   assert.equal(await direct(f),'ALREADY_RECORDED');await call('switch_command_route',[f.route,0,f.dst,'full-checkout-cutover']);assert.equal(await direct(f),'ALREADY_RECORDED');
   assert.equal(await scalar('SELECT event_count FROM master_wok_event_test.streams WHERE id=$1',[f.dst]),1);assert.equal((await counts(f)).private_orders,1);
   const expired=await fixture();await quote(expired);await q("UPDATE master_wok_event_test.full_checkout_quotes SET created_at=clock_timestamp()-interval '20 minutes',expires_at=clock_timestamp()-interval '10 minutes' WHERE id=$1",[expired.quote]);await assert.rejects(direct(expired),/FULL_CHECKOUT_QUOTE_EXPIRED/);assert.deepEqual(await counts(expired),empty);
  });
  await t.test('delivery retains arrival and private distances without fabricating driver activity',async()=>{
   const f=await fixture();Object.assign(f.input.order,{order_type:'delivery',delivery_route_miles:1.5,delivery_fee:0});await quote(f);await submit(f);
   const e=await scalar('SELECT payload FROM master_wok_event_test.events WHERE stream_id=$1',[f.src]);assert.equal(e.order.orderType,'delivery');assert.equal(e.order.deliveryReadyEstimate,null);assert.equal(e.kind,'RESERVATION_SET');
  });
  await t.test('ASAP and production project refuse in client before transport; SQL route disabled also refuses',async()=>{
   const f=await fixture();for(const change of [x=>x.order.asap_requested=true,x=>x.project='ubyjrrsvbbqomitpaidb',x=>x.order.preferred_time=null]){const input=structuredClone(f.input);change(input);assert.throws(()=>new FullSubmissionAttempt(input));}
   await quote(f);await q('UPDATE master_wok_event_test.streams SET enabled=false WHERE id=$1',[f.src]);await assert.rejects(direct(f),/CURRENT_ROUTE_DISABLED/);assert.deepEqual(await counts(f),empty);
  });
  await t.test('no public/browser/service/runtime privileges introduced; private tables all have RLS',async()=>{
   for(const role of ['anon','authenticated','service_role','master_wok_event_writer_login','master_wok_event_reader_login']){
    assert.equal(await scalar("SELECT has_function_privilege($1,'master_wok_event_test.submit_full_checkout(uuid,text,uuid,uuid,jsonb)','EXECUTE')",[role]),false);
    for(const table of ['full_checkout_quotes','full_checkout_submissions','full_checkout_orders','full_checkout_items']){
     assert.equal(await scalar("SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE')",[role,'master_wok_event_test.'+table]),false);
     assert.equal(await scalar("SELECT relrowsecurity FROM pg_class WHERE oid=$1::regclass",['master_wok_event_test.'+table]),true);
    }
   }
  });
 }finally{await db.close();}
});
