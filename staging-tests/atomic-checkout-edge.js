// Bundled staging certification runner. No production URLs or request-driven
// orders. Only generated fixtures in the private rehearsal schema are writable.
import pg from 'npm:pg@8.23.1';
const {Pool}=pg;
const {createAtomicCheckout}=require('./master-wok-atomic-checkout');
const {createOrderStore}=require('./master-wok-order-store');
const {readCapacityCommitments}=require('./master-wok-commitment-reader');
const {createLifecycleWriter}=require('./master-wok-lifecycle');
const {createMutationAssessment}=require('./master-wok-mutation-assessment');
const {calculateCommercialOrder}=require('./master-wok-commercial');
const {createCommercialValidator}=require('./master-wok-commercial-validator');
const {readBookingAvailability}=require('./master-wok-availability-reader');
const {assessCombinedBooking}=require('./master-wok-combined-assessment');
require('./master-wok-model-bundle');
const TOKEN='__CERTIFICATION_TOKEN__';
const schema='master_wok_rehearsal';
const check=(condition,message)=>{if(!condition)throw Error(message);};
let running=null;
async function run(){
 check(Deno.env.get('SUPABASE_URL')==='https://hvrqgufqjslvgiohgkvu.supabase.co','STAGING_PROJECT_REQUIRED');
 const url=Deno.env.get('SUPABASE_DB_URL');check(!!url,'DATABASE_URL_MISSING');
 const pool=new Pool({connectionString:url,max:4,connectionTimeoutMillis:10000});
 const prefix='cert-'+crypto.randomUUID()+'-',date='2099-01-02';
 const results=[];
 const store=createOrderStore({schema});
 const rewrite=c=>({query:(sql,args)=>c.query(sql.replaceAll('public.orders',schema+'.orders')
  .replaceAll('public.order_items',schema+'.order_items')
  .replaceAll('public.booking_blackouts',schema+'.booking_blackouts')
  .replaceAll('public.service_state',schema+'.service_state')
  .replaceAll('public.customers',schema+'.customers').replaceAll('public.discount_codes',schema+'.discount_codes')
  .replaceAll('public.loyalty_accounts',schema+'.loyalty_accounts')
  .replace('SELECT public.get_next_order_number() AS value',`WITH bump AS (UPDATE ${schema}.order_counters SET current_num=current_num+1 WHERE id=1 RETURNING current_num) SELECT json_build_object('assigned',current_num) AS value FROM bump`),args)});
 const request=(key,ready='2099-01-02T17:05:00Z',item='pad-thai',qty=2)=>({key:prefix+key,preferredTime:ready,
  items:[{item_id:item,qty,modifiers:[],spice:1}]});
 const commercial=async(_c,input)=>({header:{order_type:'collection',subtotal:20,total:20,
  preferred_time:input.preferredTime,notes:'Generated staging certification fixture'},
  items:input.items.map(l=>({...l,name:l.item_id,unit_price:10,kitchen_load:1}))});
 const assess=ctx=>{
  const result=assessCombinedBooking(ctx);
  // Test-only authorization, confined to a fixed private schema and generated
  // fixtures. No production assessor or launch flag is enabled by this test.
  return result.status==='VALIDATED_COMBINED_ASSESSMENT'?
   {status:'GREEN',bookingApprovalAllowed:true}:{status:'UNVERIFIED',bookingApprovalAllowed:false};
 };
 const make=(override={})=>createAtomicCheckout({pool,model:globalThis.MasterWokModelV1,
  validateCommercialOrder:commercial,readAvailability:(c,d)=>readBookingAvailability(rewrite(c),d),
  readOrders:(c,d)=>readCapacityCommitments(rewrite(c),d),store,assessBooking:assess,mode:'MASTER_WOK',...override});
 const clear=()=>pool.query(`DELETE FROM ${schema}.master_wok_time_responses WHERE order_id IN (SELECT id FROM ${schema}.orders WHERE idempotency_key LIKE $1)`,[prefix+'%'])
  .then(()=>pool.query(`DELETE FROM ${schema}.master_wok_booking_receipts WHERE key LIKE $1`,[prefix+'%']))
  .then(()=>pool.query(`DELETE FROM ${schema}.orders WHERE idempotency_key LIKE $1`,[prefix+'%']));
 try{
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema};
   REVOKE ALL ON SCHEMA ${schema} FROM PUBLIC,anon,authenticated;
   CREATE TABLE IF NOT EXISTS ${schema}.orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),created_at timestamptz NOT NULL DEFAULT now(),
    preferred_time timestamptz,proposed_time timestamptz,confirmed_time timestamptz,
    status text NOT NULL DEFAULT 'pending',is_test boolean NOT NULL DEFAULT false,
    order_type text,subtotal numeric NOT NULL DEFAULT 0,total numeric,notes text,
    idempotency_key text UNIQUE,loyalty_settled boolean NOT NULL DEFAULT false);
   CREATE TABLE IF NOT EXISTS ${schema}.order_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid NOT NULL REFERENCES ${schema}.orders ON DELETE CASCADE,
    item_id text NOT NULL,name text NOT NULL,unit_price numeric NOT NULL,
    qty integer NOT NULL CHECK(qty>0),modifiers jsonb NOT NULL,spice integer,img text,item_note text,kitchen_load numeric);
   CREATE TABLE IF NOT EXISTS ${schema}.master_wok_booking_receipts (
    key text PRIMARY KEY,service_date date NOT NULL,order_id uuid NOT NULL UNIQUE REFERENCES ${schema}.orders,
    fingerprint text NOT NULL,response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
   ALTER TABLE ${schema}.orders ADD COLUMN IF NOT EXISTS confirm_token text;
   ALTER TABLE ${schema}.orders ADD COLUMN IF NOT EXISTS paid boolean DEFAULT false;
   ALTER TABLE ${schema}.orders ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'unpaid';
   ALTER TABLE ${schema}.orders ADD COLUMN IF NOT EXISTS paid_at timestamptz;
   ALTER TABLE ${schema}.orders ADD COLUMN IF NOT EXISTS customer_id uuid;
   ALTER TABLE ${schema}.orders ADD COLUMN IF NOT EXISTS discount numeric DEFAULT 0;
   ALTER TABLE ${schema}.orders ADD COLUMN IF NOT EXISTS discount_code text;
   ALTER TABLE ${schema}.orders ADD COLUMN IF NOT EXISTS discount_label text;
   ALTER TABLE ${schema}.orders ADD COLUMN IF NOT EXISTS discount_amount numeric DEFAULT 0;
   ALTER TABLE ${schema}.orders ADD COLUMN IF NOT EXISTS delivery_fee numeric DEFAULT 0;
   ALTER TABLE ${schema}.orders ADD COLUMN IF NOT EXISTS loyalty_discount numeric DEFAULT 0;
   ALTER TABLE ${schema}.orders ADD COLUMN IF NOT EXISTS loyalty_points_redeem_pending integer DEFAULT 0;
   ALTER TABLE ${schema}.orders ADD COLUMN IF NOT EXISTS loyalty_points_earned_pending integer DEFAULT 0;
   ALTER TABLE ${schema}.orders ADD COLUMN IF NOT EXISTS loyalty_reward_applied boolean DEFAULT false;
   ALTER TABLE ${schema}.orders ADD COLUMN IF NOT EXISTS loyalty_expected_balance integer;
   ALTER TABLE ${schema}.orders ADD COLUMN IF NOT EXISTS asap_requested boolean DEFAULT false;
   ALTER TABLE ${schema}.orders ADD COLUMN IF NOT EXISTS payment_preference text;
   ALTER TABLE ${schema}.orders ADD COLUMN IF NOT EXISTS communication_preference text;
   ALTER TABLE ${schema}.orders ADD COLUMN IF NOT EXISTS order_ref text;
   CREATE TABLE IF NOT EXISTS ${schema}.customers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),full_name text NOT NULL,
    email text UNIQUE,phone text UNIQUE,address text);
   CREATE TABLE IF NOT EXISTS ${schema}.discount_codes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),code text UNIQUE,
    active boolean DEFAULT true,discount_type text,discount_value numeric,min_food_subtotal numeric DEFAULT 0,
    max_uses integer,used_count integer DEFAULT 0,starts_at timestamptz,expires_at timestamptz,allowed_weekdays integer[]);
   CREATE TABLE IF NOT EXISTS ${schema}.loyalty_accounts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),customer_phone text UNIQUE,
    customer_email text,points_balance integer DEFAULT 0,lifetime_points integer DEFAULT 0);
   CREATE TABLE IF NOT EXISTS ${schema}.order_counters(id integer PRIMARY KEY,current_num integer NOT NULL);
   INSERT INTO ${schema}.order_counters(id,current_num) VALUES (1,0) ON CONFLICT(id) DO NOTHING;
   CREATE TABLE IF NOT EXISTS ${schema}.master_wok_time_responses (token text PRIMARY KEY,
    order_id uuid NOT NULL REFERENCES ${schema}.orders,decision text NOT NULL,response jsonb NOT NULL);
   CREATE TABLE IF NOT EXISTS ${schema}.booking_blackouts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),kind text NOT NULL,start_at timestamptz NOT NULL,
    end_at timestamptz NOT NULL,active boolean NOT NULL DEFAULT true);
   CREATE TABLE IF NOT EXISTS ${schema}.service_state (
    id integer PRIMARY KEY,mode text NOT NULL,capacity_throttle numeric NOT NULL,effective_until timestamptz);
   INSERT INTO ${schema}.service_state(id,mode,capacity_throttle) VALUES (1,'normal',0)
    ON CONFLICT(id) DO NOTHING;
   REVOKE ALL ON ALL TABLES IN SCHEMA ${schema} FROM PUBLIC,anon,authenticated;`);
  const checkout=make();
  const a=request('a'),b=request('b');
  const competing=await Promise.all([checkout(a),checkout(b)]);
  check(competing.filter(r=>r.committed).length===1,'CONCURRENT_CAPACITY_OVERBOOKED_OR_NO_COMMIT');
  const winner=competing[0].committed?a:b;
  const saved=competing.find(r=>r.committed);
  const counts=await pool.query(`SELECT (SELECT count(*) FROM ${schema}.orders WHERE idempotency_key LIKE $1)::int AS orders,
   (SELECT count(*) FROM ${schema}.order_items i JOIN ${schema}.orders o ON o.id=i.order_id WHERE o.idempotency_key LIKE $1)::int AS items,
   (SELECT count(*) FROM ${schema}.master_wok_booking_receipts WHERE key LIKE $1)::int AS receipts`,[prefix+'%']);
  check(counts.rows[0].orders===1&&counts.rows[0].items===1&&counts.rows[0].receipts===1,'INCOMPLETE_ORDER');
  results.push('CONCURRENT_REAL_BASKETS_ONE_COMMIT_HEADER_ITEMS_RECEIPT');
  const replay=await checkout(winner);
  check(replay.reason==='REPLAY'&&replay.response.orderId===saved.response.orderId,'REPLAY_CHANGED_RESPONSE');
  const conflict=await checkout({...winner,preferredTime:'2099-01-03T18:00:00Z'});
  check(conflict.reason==='IDEMPOTENCY_CONFLICT','CROSS_DATE_KEY_REUSE_ACCEPTED');
  results.push('IDEMPOTENT_REPLAY_AND_CROSS_DATE_CONFLICT');
  await clear();
  const failStore={...store,persist:async(c,data)=>{await store.persist(c,data);throw Error('INJECTED_AFTER_ITEMS_AND_RECEIPT');}};
  const failure=await make({store:failStore})(request('rollback'));
  check(!failure.committed,'FAILURE_COMMITTED');
  const absent=await pool.query(`SELECT count(*)::int AS n FROM ${schema}.orders WHERE idempotency_key LIKE $1`,[prefix+'%']);
  check(absent.rows[0].n===0,'ROLLBACK_LEFT_HEADER');
  results.push('ROLLBACK_AFTER_COMPLETE_PERSISTENCE_LEAVES_NO_ORDER');
  const both=await Promise.all([checkout(request('retry')),checkout(request('retry'))]);
  check(both.filter(r=>r.committed).length===1&&both.some(r=>r.reason==='REPLAY'),'CONCURRENT_RETRY_DUPLICATED');
  results.push('CONCURRENT_IDENTICAL_RETRY_ONE_ORDER');
  await clear();
  const plain={...request('simple','2099-01-02T18:00:00Z','green-curry',1),
   items:[{item_id:'green-curry',qty:1,modifiers:[{id:'chicken'}],spice:1},
    {item_id:'stir-crispy',qty:1,modifiers:[],spice:1}]};
  const mixed=await checkout(plain);check(mixed.committed,'MIXED_REAL_BASKET_FAILED');
  results.push('MIXED_WOK_AND_FRYER_BASKET_COMMITTED_ATOMICALLY');
  await clear();
  const proto=make({assessBooking:()=>({status:'GREEN',bookingApprovalAllowed:false})});
  check(!(await proto(request('prototype'))).committed,'PROTOTYPE_APPROVED');
  const off=make({mode:'LEGACY'});check((await off(request('off'))).status==='LEGACY','ROLLBACK_FLAG_FAILED');
  results.push('PROTOTYPE_REFUSED_AND_LEGACY_FLAG_OFF');
  const blackout=await pool.query(`INSERT INTO ${schema}.booking_blackouts(kind,start_at,end_at) VALUES
   ('fully_booked','2099-01-02T17:00:00Z','2099-01-02T17:10:00Z') RETURNING id`);
  try{check(!(await checkout(request('blackout'))).committed,'BLACKOUT_ACCEPTED');}
  finally{await pool.query(`DELETE FROM ${schema}.booking_blackouts WHERE id=$1`,[blackout.rows[0].id]);}
  results.push('LOCKED_BLACKOUT_REFUSES_BOOKING');
  for(const [label,change] of [
   ['CANCELLED_ORDER_RELEASES_CAPACITY',"status='cancelled'"],
   ['TEST_ORDER_EXCLUDED_FROM_REAL_CAPACITY','is_test=true'],
   ['PROPOSED_TIME_COUNTED_AT_NEW_SERVICE_TIME',"proposed_time='2099-01-02T18:30:00Z'"],
   ['CONFIRMED_TIME_COUNTED_AT_NEW_SERVICE_TIME',"confirmed_time='2099-01-02T18:30:00Z'"]
  ]){
   const first=await checkout(request('lifecycle-first'));check(first.committed,label+'_SETUP');
   await pool.query(`UPDATE ${schema}.orders SET ${change} WHERE id=$1`,[first.response.orderId]);
   check((await checkout(request('lifecycle-next'))).committed,label+'_FAILED');
   results.push(label);await clear();
  }
  await pool.query(`INSERT INTO ${schema}.orders(idempotency_key,preferred_time) VALUES ($1,$2)`,
   [prefix+'incomplete','2099-01-02T17:05:00Z']);
  check(!(await checkout(request('incomplete-blocked'))).committed,'INCOMPLETE_ORDER_IGNORED');
  results.push('INCOMPLETE_COMMITTED_HEADER_FAILS_CLOSED');await clear();
  const checkMutation=createMutationAssessment({model:globalThis.MasterWokModelV1,
   readOrders:(c,d)=>readCapacityCommitments(rewrite(c),d),
   readAvailability:(c,d)=>readBookingAvailability(rewrite(c),d)});
  const lifecycle=createLifecycleWriter({pool,schema,mode:'MASTER_WOK',assessMutation:async context=>{
   const r=await checkMutation(context);
   return r.status==='VALIDATED_LIFECYCLE_ASSESSMENT'?{status:'GREEN',bookingApprovalAllowed:true}:r;
  }});
  const original=await checkout(request('ack','2099-01-02T18:00:00Z','green-curry',1));
  check(original.committed,'ACK_SETUP_FAILED');
  const orderId=original.response.orderId;
  const proposal=await lifecycle.adminAction({orderId,action:'suggest_time',proposedTime:'2099-01-02T19:00:00Z'});
  check(proposal.committed,'PROPOSED_TIME_TRANSACTION_FAILED');
  const bothTimes=await readCapacityCommitments(rewrite(pool),date);
  check(bothTimes.filter(r=>r.source_order_id===orderId).length===2,'ORIGINAL_COMMITMENT_RELEASED_BEFORE_ACK');
  const guarded=await lifecycle.adminAction({orderId,action:'accept'});
  check(!guarded.committed,'STAFF_ACCEPT_BYPASSED_CUSTOMER_ACK');
  const responseToken=(await pool.query(`SELECT confirm_token FROM ${schema}.orders WHERE id=$1`,[orderId])).rows[0].confirm_token;
  const accepted=await lifecycle.customerResponse({orderId,token:responseToken,action:'customer_accept'});
  check(accepted.committed,'CUSTOMER_ACK_TRANSACTION_FAILED');
  const acknowledged=await readCapacityCommitments(rewrite(pool),date);
  check(acknowledged.length===1&&new Date(acknowledged[0].confirmed_time).toISOString()==='2099-01-02T19:00:00.000Z','ACK_TIME_NOT_AUTHORITATIVE');
  const retry=await lifecycle.customerResponse({orderId,token:responseToken,action:'customer_accept'});
  check(retry.replayed===true&&!retry.committed,'CUSTOMER_RETRY_NOT_IDEMPOTENT');
  const reversal=await lifecycle.customerResponse({orderId,token:responseToken,action:'customer_decline'});
  check(!reversal.success,'USED_TOKEN_REVERSED_DECISION');
  results.push('PROPOSAL_HOLDS_BOTH_TIMES_CUSTOMER_ACK_COMMITS_RETRY_IS_STABLE');
  const paid=await lifecycle.adminAction({orderId,action:'mark_paid'});
  check(paid.committed&&paid.status==='customer_accepted_time','MARK_PAID_CHANGED_BOOKING_STATUS');
  results.push('MARK_PAID_DOES_NOT_COMPLETE_ORDER');
  const secondProposal=await lifecycle.adminAction({orderId,action:'suggest_time',proposedTime:'2099-01-02T20:00:00Z'});
  check(secondProposal.committed,'SECOND_PROPOSAL_FAILED');
  const secondToken=(await pool.query(`SELECT confirm_token FROM ${schema}.orders WHERE id=$1`,[orderId])).rows[0].confirm_token;
  await Promise.all([lifecycle.adminAction({orderId,action:'decline'}),
   lifecycle.customerResponse({orderId,token:secondToken,action:'customer_accept'})]);
  const finalOrder=(await pool.query(`SELECT status FROM ${schema}.orders WHERE id=$1`,[orderId])).rows[0];
  check(finalOrder.status==='cancelled','CUSTOMER_RESPONSE_REVIVED_CANCELLED_ORDER');
  results.push('CONCURRENT_CANCELLATION_AND_ACK_CANNOT_REVIVE_ORDER');await clear();
  const realPrice=calculateCommercialOrder({orderType:'collection',preferredTime:'2099-01-02T18:00:00Z',
   items:[{item_id:'panang-curry',qty:2,modifiers:[{id:'chicken',delta:-100}],spice:1}],paymentPreference:'in_advance'},
   {now:new Date().toISOString()});
  check(realPrice.header.subtotal===18&&realPrice.header.payment_preference==='in_advance','REAL_MENU_PRICE_NOT_APPLIED');
  results.push('CURRENT_MENU_PRICES_AND_PAYMENT_PREFERENCE_VALIDATED_IN_RUNTIME');
  const email=prefix+'@example.invalid',phone='07'+String(Date.now()).slice(-9);
  await pool.query(`INSERT INTO ${schema}.loyalty_accounts(customer_phone,customer_email,points_balance) VALUES($1,$2,100)`,[phone,email]);
  const validate=createCommercialValidator();
  const pricedCheckout=make({validateCommercialOrder:(c,i,state)=>validate(rewrite(c),i,state)});
  const baseInput={...request('commercial-one','2099-01-02T18:00:00Z','panang-curry',1),
   orderType:'collection',paymentPreference:'in_advance',customer:{name:'Staging certification fixture',email,phone},
   items:[{item_id:'panang-curry',qty:1,modifiers:[{id:'chicken'}],spice:1}],
   expectedTotals:{subtotal:9,total:4,discount:5,loyalty_discount:5,delivery_fee:0}};
  try{
   const bad=await pricedCheckout({...baseInput,key:prefix+'commercial-bad',expectedTotals:{...baseInput.expectedTotals,total:0.01}});
   check(!bad.committed,'CLIENT_TOTAL_TRUSTED');
   check((await pool.query(`SELECT count(*)::int AS n FROM ${schema}.customers WHERE email=$1`,[email])).rows[0].n===0,'FAILED_PRICE_LEFT_CUSTOMER_WRITE');
   const first=await pricedCheckout(baseInput);check(first.committed,'REAL_COMMERCIAL_VALIDATOR_FAILED');
   const second=await pricedCheckout({...baseInput,key:prefix+'commercial-two',preferredTime:'2099-01-02T19:00:00Z',
    expectedTotals:{subtotal:9,total:9,discount:0,loyalty_discount:0,delivery_fee:0}});
   check(second.committed,'PENDING_REWARD_RESERVATION_FAILED');
   const values=(await pool.query(`SELECT total,loyalty_points_redeem_pending,loyalty_points_earned_pending,payment_preference
    FROM ${schema}.orders WHERE id=$1`,[first.response.orderId])).rows[0];
   check(Number(values.total)===4&&values.loyalty_points_redeem_pending===100&&values.loyalty_points_earned_pending===4&&values.payment_preference==='in_advance','COMMERCIAL_FIELDS_CHANGED');
   check((await pool.query(`SELECT points_balance FROM ${schema}.loyalty_accounts WHERE customer_phone=$1`,[phone])).rows[0].points_balance===100,'CHECKOUT_PREMATURELY_REDEEMED_POINTS');
   results.push('TRUSTED_COMMERCIAL_VALIDATION_PRICE_TAMPERING_ROLLBACK_AND_PENDING_REWARD_RESERVATION');
  }finally{
   await clear();await pool.query(`DELETE FROM ${schema}.customers WHERE email=$1`,[email]);
   await pool.query(`DELETE FROM ${schema}.loyalty_accounts WHERE customer_phone=$1`,[phone]);
  }



  return {status:'PASS',scope:'PRIVATE_STAGING_ATOMIC_CHECKOUT_REHEARSAL',tests:results,
   productionReady:false,productionWrites:0,publicStagingOrderWrites:0};
 }finally{await clear();await pool.end();}
}
Deno.serve(async req=>{
 if(req.headers.get('authorization')!=='Bearer '+TOKEN)return new Response('Forbidden',{status:403});
 if(req.method!=='POST')return new Response('Method not allowed',{status:405});
 if(!running)running=run().catch(e=>({status:'FAIL',reason:e.message,productionReady:false}));
 return Response.json(await running);
});
