// Bundled staging certification runner. No production URLs or request-driven
// orders. Only generated fixtures in the private rehearsal schema are writable.
import pg from 'npm:pg@8.23.1';
const {Pool}=pg;
const {createAtomicCheckout}=require('./master-wok-atomic-checkout');
const {createOrderStore}=require('./master-wok-order-store');
const {createServicePlanStore}=require('./master-wok-service-plan-store');
const {readCapacityCommitments}=require('./master-wok-commitment-reader');
const {createLifecycleWriter}=require('./master-wok-lifecycle');
const {createMutationAssessment}=require('./master-wok-mutation-assessment');
const {calculateCommercialOrder}=require('./master-wok-commercial');
const {createCommercialValidator}=require('./master-wok-commercial-validator');
const {readBookingAvailability}=require('./master-wok-availability-reader');
const {assessCombinedBooking}=require('./master-wok-combined-assessment');
const {createLaunchControl}=require('./master-wok-launch-control');
const {createServiceControlWriter}=require('./master-wok-service-control');
const {beginBookingTransaction}=require('./master-wok-transaction-writer');
const {createBookingHttpHandler}=require('./master-wok-http');
const {createBookingRuntime}=require('./master-wok-runtime');
const {createNotificationDispatcher,createNotificationHttpHandler}=require('./master-wok-notification-dispatch');
const {createBasketAvailability}=require('./master-wok-availability');
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
 const store=createOrderStore({schema}),planStore=createServicePlanStore({schema});
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
   {...result,status:'GREEN',bookingApprovalAllowed:true}:{status:'UNVERIFIED',bookingApprovalAllowed:false};
 };
 const make=(override={})=>createAtomicCheckout({pool,model:globalThis.MasterWokModelV1,
  validateCommercialOrder:commercial,readAvailability:(c,d)=>readBookingAvailability(rewrite(c),d),
  readOrders:(c,d)=>readCapacityCommitments(rewrite(c),d),store,planStore,assessBooking:assess,mode:'MASTER_WOK',...override});
 const clear=()=>pool.query(`DELETE FROM ${schema}.master_wok_time_responses WHERE order_id IN (SELECT id FROM ${schema}.orders WHERE idempotency_key LIKE $1)`,[prefix+'%'])
  .then(()=>pool.query(`DELETE FROM ${schema}.master_wok_booking_receipts WHERE key LIKE $1`,[prefix+'%']))
  .then(()=>pool.query(`DELETE FROM ${schema}.orders WHERE idempotency_key LIKE $1`,[prefix+'%']))
  .then(()=>pool.query(`DELETE FROM ${schema}.master_wok_service_plans WHERE service_date=$1`,[date]));
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
   ALTER TABLE ${schema}.orders ADD COLUMN IF NOT EXISTS capacity_scheduler text NOT NULL DEFAULT 'LEGACY';
   ALTER TABLE ${schema}.orders ADD COLUMN IF NOT EXISTS staff_notified_at timestamptz;
   ALTER TABLE ${schema}.orders ADD COLUMN IF NOT EXISTS staff_notify_attempts integer DEFAULT 0;
   ALTER TABLE ${schema}.orders ADD COLUMN IF NOT EXISTS staff_notify_error text;
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
   ALTER TABLE ${schema}.orders ADD COLUMN IF NOT EXISTS delivery_address text;
   ALTER TABLE ${schema}.orders ADD COLUMN IF NOT EXISTS customer_lat numeric;
   ALTER TABLE ${schema}.orders ADD COLUMN IF NOT EXISTS customer_lng numeric;
   ALTER TABLE ${schema}.orders ADD COLUMN IF NOT EXISTS delivery_straight_line_miles numeric;
   ALTER TABLE ${schema}.orders ADD COLUMN IF NOT EXISTS delivery_route_miles numeric;
   ALTER TABLE ${schema}.orders ADD COLUMN IF NOT EXISTS delivery_distance_source text;
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
   CREATE TABLE IF NOT EXISTS ${schema}.master_wok_service_plans(service_date date PRIMARY KEY,plan jsonb NOT NULL,
    revision bigint NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now());
   CREATE TABLE IF NOT EXISTS ${schema}.master_wok_notification_outbox (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid NOT NULL REFERENCES ${schema}.orders ON DELETE CASCADE,
    event_type text NOT NULL,status text NOT NULL DEFAULT 'pending',created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(order_id,event_type));
   ALTER TABLE ${schema}.master_wok_notification_outbox ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}';
   ALTER TABLE ${schema}.master_wok_notification_outbox ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
   ALTER TABLE ${schema}.master_wok_notification_outbox ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now();
   ALTER TABLE ${schema}.master_wok_notification_outbox ADD COLUMN IF NOT EXISTS sent_at timestamptz;
   ALTER TABLE ${schema}.master_wok_notification_outbox ADD COLUMN IF NOT EXISTS lease_token uuid;
   ALTER TABLE ${schema}.master_wok_notification_outbox ADD COLUMN IF NOT EXISTS leased_until timestamptz;
   ALTER TABLE ${schema}.master_wok_notification_outbox ADD COLUMN IF NOT EXISTS prepared_messages jsonb;
   CREATE TABLE IF NOT EXISTS ${schema}.master_wok_notification_deliveries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id uuid NOT NULL REFERENCES ${schema}.master_wok_notification_outbox ON DELETE CASCADE,
    delivery_key text NOT NULL,message jsonb NOT NULL,fallback jsonb,status text NOT NULL DEFAULT 'pending',
    attempts integer NOT NULL DEFAULT 0,next_attempt_at timestamptz NOT NULL DEFAULT now(),provider_id text,
    UNIQUE(event_id,delivery_key));
   ALTER TABLE ${schema}.loyalty_accounts ADD COLUMN IF NOT EXISTS last_order_at timestamptz;
   ALTER TABLE ${schema}.loyalty_accounts ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
   CREATE TABLE IF NOT EXISTS ${schema}.booking_blackouts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),kind text NOT NULL,start_at timestamptz NOT NULL,
    end_at timestamptz NOT NULL,active boolean NOT NULL DEFAULT true);
   CREATE TABLE IF NOT EXISTS ${schema}.service_state (
    id integer PRIMARY KEY,mode text NOT NULL,capacity_throttle numeric NOT NULL,effective_until timestamptz);
   ALTER TABLE ${schema}.service_state ADD COLUMN IF NOT EXISTS customer_message text;
   ALTER TABLE ${schema}.service_state ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
   ALTER TABLE ${schema}.booking_blackouts ADD COLUMN IF NOT EXISTS message text;
   CREATE TABLE IF NOT EXISTS ${schema}.master_wok_launch_control (
    id integer PRIMARY KEY,mode text NOT NULL,approved_release_id text,revision bigint NOT NULL DEFAULT 1);
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
   readAvailability:(c,d)=>readBookingAvailability(rewrite(c),d),planStore});
  const lifecycle=createLifecycleWriter({pool,schema,mode:'MASTER_WOK',assessMutation:async context=>{
   const r=await checkMutation(context);
   return r.status==='VALIDATED_LIFECYCLE_ASSESSMENT'?{...r,status:'GREEN',bookingApprovalAllowed:true}:r;
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
   const completed=await Promise.all([lifecycle.adminAction({orderId:first.response.orderId,action:'complete'}),
    lifecycle.adminAction({orderId:first.response.orderId,action:'complete'})]);
   check(completed.every(r=>r.success&&r.loyalty_settled),'ATOMIC_LOYALTY_COMPLETION_FAILED');
   check((await pool.query(`SELECT points_balance FROM ${schema}.loyalty_accounts WHERE customer_phone=$1`,[phone])).rows[0].points_balance===4,'COMPLETION_REDEEMED_REWARD_MORE_THAN_ONCE');
   results.push('TRUSTED_COMMERCIAL_VALIDATION_PRICE_TAMPERING_ROLLBACK_AND_PENDING_REWARD_RESERVATION');
   results.push('CONCURRENT_COMPLETION_SETTLES_NEW_ORDER_LOYALTY_EXACTLY_ONCE');
  }finally{
   await clear();await pool.query(`DELETE FROM ${schema}.customers WHERE email=$1`,[email]);
   await pool.query(`DELETE FROM ${schema}.loyalty_accounts WHERE customer_phone=$1`,[phone]);
  }



  const clockPool=instant=>({connect:async()=>{
   const client=await pool.connect();return {release:()=>client.release(),query:(sql,args)=>
    sql==='SELECT clock_timestamp() AS now'?client.query('SELECT $1::timestamptz AS now',[instant]):client.query(sql,args)};
  }});
  const fresh=await make({pool:clockPool('2099-01-02T16:00:00Z')})(request('protected-original','2099-01-02T18:00:00Z','stir-crispy',1));
  check(fresh.committed,'PROTECTED_PLAN_SETUP_FAILED');
  const persisted=(await pool.query(`SELECT plan,revision FROM ${schema}.master_wok_service_plans WHERE service_date=$1`,[date])).rows[0];
  const previousJob=persisted.plan.wok.jobs.find(j=>j.orderIds.includes(fresh.response.orderId+'@2099-01-02T18:00:00.000Z'));
  check(!!previousJob,'CANDIDATE_PLAN_ID_NOT_REMAPPED');
  const begun=persisted.plan.fryer.jobs[0].start+1;
  const clock='2099-01-02T'+String(Math.floor(begun/60)).padStart(2,'0')+':'+String(begun%60).padStart(2,'0')+':00Z';
  const freshConnectionCheckout=make({pool:clockPool(clock)});
  const nextBooking=await freshConnectionCheckout(request('protected-next','2099-01-02T19:00:00Z','green-curry',1));
  check(nextBooking.committed,'BOOKING_AROUND_STARTED_WORK_FAILED');
  const savedPlanRecord=(await pool.query(`SELECT plan,revision FROM ${schema}.master_wok_service_plans WHERE service_date=$1`,[date])).rows[0];
  check(Number(savedPlanRecord.revision)===Number(persisted.revision)+1,'SERVICE_PLAN_REVISION_NOT_ATOMIC');
  check(JSON.stringify(savedPlanRecord.plan.wok.jobs.find(j=>j.orderIds.includes(previousJob.orderIds[0])))===JSON.stringify(previousJob),'STARTED_WOK_MOVED_AFTER_RECONNECT');
  results.push('SAVED_PLAN_RELOADED_ON_FRESH_CONNECTION_AND_STARTED_DEPENDENCY_REMAINS_FIXED');
  const failedPlanStore={...planStore,save:async(c,d,plan)=>{await planStore.save(c,d,plan);throw Error('INJECTED_AFTER_PLAN_WRITE');}};
  const failedPlan=await make({pool:clockPool(clock),planStore:failedPlanStore})(request('protected-failed','2099-01-02T20:00:00Z','green-curry',1));
  check(!failedPlan.committed,'PLAN_WRITE_FAILURE_COMMITTED_ORDER');
  const afterFailure=(await pool.query(`SELECT plan,revision FROM ${schema}.master_wok_service_plans WHERE service_date=$1`,[date])).rows[0];
  check(JSON.stringify(afterFailure)===JSON.stringify(savedPlanRecord),'FAILED_BOOKING_LEFT_SERVICE_PLAN_CHANGE');
  check((await pool.query(`SELECT count(*)::int AS n FROM ${schema}.orders WHERE idempotency_key=$1`,[prefix+'protected-failed'])).rows[0].n===0,'FAILED_PLAN_LEFT_ORDER');
  results.push('FAILURE_AFTER_PLAN_WRITE_ROLLS_BACK_ORDER_ITEMS_RECEIPT_AND_PLAN');
  const liveLifecycle=createLifecycleWriter({pool:clockPool(clock),schema,mode:'MASTER_WOK',assessMutation:async context=>{
   const assessed=await checkMutation(context);
   return assessed.status==='VALIDATED_LIFECYCLE_ASSESSMENT'?{...assessed,status:'GREEN',bookingApprovalAllowed:true}:assessed;
  }});
  check((await liveLifecycle.adminAction({orderId:fresh.response.orderId,action:'decline'})).committed,'STARTED_ORDER_CANCELLATION_FAILED');
  const afterCancellation=(await pool.query(`SELECT plan FROM ${schema}.master_wok_service_plans WHERE service_date=$1`,[date])).rows[0].plan;
  check(JSON.stringify(afterCancellation.wok.jobs.find(j=>j.orderIds.includes(previousJob.orderIds[0])))===JSON.stringify(previousJob),'CANCELLATION_FREED_STARTED_RESOURCES');
  results.push('CANCELLATION_PRESERVES_STARTED_RESOURCE_ALLOCATION_IN_COMMITTED_PLAN');
  await clear();
  {
  // Private fixture release identity is deliberately NOT a production approval.
  const releaseId='private-staging-fixture-release';
  const gate=createLaunchControl({schema,releaseId});
  await pool.query(`INSERT INTO ${schema}.master_wok_launch_control(id,mode,approved_release_id)
   VALUES(1,'LEGACY',$1) ON CONFLICT(id) DO UPDATE SET mode='LEGACY',approved_release_id=$1`,[releaseId]);
  const gatedCheckout=make({assertWriteAllowed:gate.assertWriteAllowed});
  check(!(await gatedCheckout(request('gate-off'))).committed,'DURABLE_LEGACY_GATE_BYPASSED');
  await pool.query(`UPDATE ${schema}.master_wok_launch_control SET mode='MASTER_WOK' WHERE id=1`);
  const stale=make({assertWriteAllowed:createLaunchControl({schema,releaseId:'different-release-id'}).assertWriteAllowed});
  check(!(await stale(request('gate-stale'))).committed,'STALE_RELEASE_GATE_BYPASSED');
  let entered,unblock;
  const inside=new Promise(resolve=>{entered=resolve;}),continueWrite=new Promise(resolve=>{unblock=resolve;});
  const slow=make({assertWriteAllowed:gate.assertWriteAllowed,store:{...store,persist:async(c,data)=>{
   const result=await store.persist(c,data);entered();await continueWrite;return result;
  }}});
  const booking=slow(request('gate-inflight'));
  await inside;
  const drain=await pool.connect(),pid=(await drain.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  const draining=(async()=>{await beginBookingTransaction(drain);
   await drain.query(`UPDATE ${schema}.master_wok_launch_control SET mode='DRAINING',revision=revision+1 WHERE id=1`);
   await drain.query('COMMIT');})();
  let waiting=false;
  for(let attempt=0;attempt<50;attempt++){
   const state=(await pool.query('SELECT wait_event FROM pg_stat_activity WHERE pid=$1',[pid])).rows[0];
   if(state?.wait_event==='advisory'){waiting=true;break;}
   await new Promise(resolve=>setTimeout(resolve,20));
  }
  unblock();const committed=await booking;await draining;drain.release();
  check(waiting&&committed.committed,'DRAIN_DID_NOT_WAIT_FOR_EXISTING_BOOKING');
  check(!(await gatedCheckout(request('gate-after-drain'))).committed,'WRITE_COMMITTED_AFTER_DRAIN');
  check((await pool.query(`SELECT count(*)::int AS n FROM ${schema}.orders WHERE idempotency_key LIKE $1`,[prefix+'gate-%'])).rows[0].n===1,'GATE_LEFT_UNEXPECTED_ORDERS');
  results.push('DURABLE_GATE_REFUSES_LEGACY_STALE_RELEASE_AND_POST_DRAIN_WRITES');
  results.push('DRAIN_WAITS_FOR_INFLIGHT_TRANSACTION_BEFORE_DISABLING_WRITER');
  await clear();
  await pool.query(`UPDATE ${schema}.master_wok_launch_control SET mode='MASTER_WOK' WHERE id=1`);
  const controls=createServiceControlWriter({pool,schema,assertWriteAllowed:gate.assertWriteAllowed});
  check((await controls({action:'set_service_state',mode:'paused',customer_message:'Fixture pause'})).ok,'SERVICE_PAUSE_WRITE_FAILED');
  check(!(await gatedCheckout(request('pause'))).committed,'LOCKED_PAUSE_IGNORED');
  for(const [mode,throttle] of [['busy',0.5],['very_busy',1]]){
   const changed=await controls({action:'set_service_state',mode});
   check(changed.ok&&Number(changed.service_state[0].capacity_throttle)===throttle,'LEGACY_THROTTLE_VALUE_CHANGED');
  }
  check((await controls({action:'set_service_state',mode:'normal'})).ok,'SERVICE_NORMAL_WRITE_FAILED');
  check(!(await controls({action:'create_blackout',kind:'closed',start_at:date+'T17:10:00Z',end_at:date+'T17:00:00Z'})).ok,'INVALID_BLACKOUT_COMMITTED');
  const closed=await controls({action:'create_blackout',kind:'fully_booked',start_at:date+'T17:00:00Z',end_at:date+'T17:06:00Z',message:'Private fixture'});
  check(closed.ok&&!(await gatedCheckout(request('closed'))).committed,'LOCKED_BLACKOUT_IGNORED');
  check((await controls({action:'deactivate_blackout',blackout_id:closed.blackout[0].id})).ok,'BLACKOUT_DEACTIVATION_FAILED');
  await pool.query(`DELETE FROM ${schema}.booking_blackouts WHERE id=$1`,[closed.blackout[0].id]);
  results.push('SERVICE_AND_BLACKOUT_MUTATIONS_SHARE_BOOKING_LOCK_AND_PRESERVE_MODE_VALUES');
  const http=createBookingRuntime({pool,model:globalThis.MasterWokModelV1,secret:TOKEN,releaseId,schema,
   validateCommercialOrder:commercial,readAvailability:(c,d)=>readBookingAvailability(rewrite(c),d),
   readOrders:(c,d)=>readCapacityCommitments(rewrite(c),d),assessBooking:assess,
   assessMutation:async context=>{const result=await checkMutation(context);
    return result.status==='VALIDATED_LIFECYCLE_ASSESSMENT'?{...result,status:'GREEN',bookingApprovalAllowed:true}:result;}});
  const httpInput={operation:'checkout',payload:request('http-booking')};
  const call=async input=>http(new Request('https://staging.invalid/master-wok-booking',{method:'POST',
   headers:{'content-type':'application/json','x-master-wok-secret':TOKEN},body:JSON.stringify(input)}));
  const reserved=await call(httpInput),reservedBody=await reserved.json();
  check(reserved.status===200&&reservedBody.success&&reservedBody.orderId,'HTTP_CHECKOUT_TO_DATABASE_FAILED');
  const replay=await call(httpInput),replayed=await replay.json();
  check(replay.status===200&&replayed.replayed&&replayed.orderId===reservedBody.orderId,'HTTP_REPLAY_NOT_STABLE');
  const modeResponse=await call({operation:'mode'});
  check((await modeResponse.json()).mode==='MASTER_WOK','HTTP_DURABLE_MODE_MISSING');
  results.push('AUTHENTICATED_HTTP_ENVELOPE_COMMITS_DATABASE_ORDER_AND_REPLAYS_SAME_RECEIPT');
  await clear();
  await pool.query(`DELETE FROM ${schema}.master_wok_launch_control WHERE id=1`);
  }
  {
   const dispatch=createNotificationDispatcher({pool,schema});
   const source=await make()(request('notification-source','2099-01-02T18:00:00Z','green-curry',1));
   check(source.committed,'NOTIFICATION_SOURCE_FAILED');
   const claimed=await Promise.all([dispatch({action:'claim'}),dispatch({action:'claim'})]);
   check(claimed.filter(r=>r.event).length===1,'CONCURRENT_WORKERS_CLAIMED_SAME_EVENT');
   const event=claimed.find(r=>r.event).event,context={eventId:event.id,token:event.token};
   check(event.payload.order_id===source.response.orderId&&event.payload.notification_mode==='order_created','SERVER_NOTIFICATION_SNAPSHOT_MISSING');
   const messages=[{key:'staff_push',primary:{channel:'pushover',title:'Fixture',body:'No real send'}},
    {key:'z_customer',primary:{channel:'sms',recipient:'07700900123',body:'Fixture'},
     fallback:{channel:'email',recipient:'fixture@example.invalid',subject:'Fixture',body:'Fixture'}}];
   await dispatch({...context,action:'prepare',messages});
   await dispatch({...context,action:'prepare',messages});
   const staff=(await dispatch({...context,action:'next'})).delivery;
   await dispatch({...context,action:'result',deliveryId:staff.id,outcome:'sent',providerId:'fixture-provider-id'});
   check(!!(await pool.query(`SELECT staff_notified_at FROM ${schema}.orders WHERE id=$1`,[source.response.orderId])).rows[0].staff_notified_at,'LEGACY_STAFF_NOTIFICATION_MARKER_NOT_UPDATED');
   check((await dispatch({...context,action:'result',deliveryId:staff.id,outcome:'sent'})).replayed,'DELIVERY_ACK_REPLAY_UNSTABLE');
   const customer=(await dispatch({...context,action:'next'})).delivery;
   check(customer.message.channel==='sms','CUSTOMER_PREFERENCE_CHANGED');
   await dispatch({...context,action:'result',deliveryId:customer.id,outcome:'failed'});
   const fallback=(await dispatch({...context,action:'next'})).delivery;
   check(fallback.id===customer.id&&fallback.message.channel==='email','DEFINITIVE_FAILURE_FALLBACK_MISSING');
   await dispatch({...context,action:'result',deliveryId:fallback.id,outcome:'sent'});
   check((await dispatch({...context,action:'next'})).status==='sent','PARTIAL_CHANNEL_SETTLEMENT_FAILED');
   check(!(await dispatch({action:'claim'})).event,'ACCEPTED_NOTIFICATION_RESENT');
   results.push('NOTIFICATION_WORKERS_EXCLUSIVE_CLAIM_STABLE_MANIFEST_AND_ACCEPTED_CHANNEL_NO_RESEND');
   results.push('CUSTOMER_FALLBACK_ONLY_AFTER_DEFINITIVE_REJECTION_PRESERVES_STAFF_SUCCESS');
   await clear();
   const prior=await make()(request('notification-previous-staff','2099-01-02T18:00:00Z','green-curry',1));
   check(prior.committed,'PRIOR_STAFF_FIXTURE_FAILED');
   await pool.query(`UPDATE ${schema}.orders SET staff_notified_at=now() WHERE id=$1`,[prior.response.orderId]);
   const priorEvent=(await dispatch({action:'claim'})).event,priorContext={eventId:priorEvent.id,token:priorEvent.token};
   await dispatch({...priorContext,action:'prepare',messages:[messages[0]]});
   check((await dispatch({...priorContext,action:'next'})).status==='sent','LEGACY_STAFF_ALERT_WOULD_BE_DUPLICATED');
   results.push('LEGACY_STAFF_NOTIFICATION_MARKER_IS_PRESERVED_AND_PREVENTS_DUPLICATE_PUSH');
   await clear();
   const unknown=await make()(request('notification-unknown','2099-01-02T18:00:00Z','green-curry',1));
   check(unknown.committed,'UNKNOWN_SEND_SOURCE_FAILED');
   const pending=(await dispatch({action:'claim'})).event,c={eventId:pending.id,token:pending.token};
   await dispatch({...c,action:'prepare',messages:[messages[1]]});
   await dispatch({...c,action:'next'});
   // Simulate a provider accepting the send followed by a worker crash before
   // acknowledgement. Expiry MUST quarantine rather than resend/fallback.
   await pool.query(`UPDATE ${schema}.master_wok_notification_outbox SET leased_until=now()-interval '1 second' WHERE id=$1`,[pending.id]);
   check((await dispatch({action:'claim'})).attentionRequired,'EXPIRED_SEND_NOT_QUARANTINED');
   check(!(await dispatch({action:'claim'})).event,'AMBIGUOUS_SEND_AUTOMATICALLY_RETRIED');
   const quarantined=(await pool.query(`SELECT status FROM ${schema}.master_wok_notification_deliveries WHERE event_id=$1`,[pending.id])).rows;
   check(quarantined.length===1&&quarantined[0].status==='uncertain','AMBIGUOUS_SEND_FELL_BACK');
   results.push('WORKER_CRASH_AFTER_PROVIDER_SEND_QUARANTINES_WITHOUT_RESEND_OR_FALLBACK');
   await clear();
   const proposal=await make()(request('notification-proposal','2099-01-02T18:00:00Z','green-curry',1));
   check(proposal.committed,'NOTIFICATION_PROPOSAL_SETUP_FAILED');
   const suggested=await lifecycle.adminAction({orderId:proposal.response.orderId,action:'suggest_time',proposedTime:'2099-01-02T19:00:00Z'});
   check(suggested.committed,'NOTIFICATION_PROPOSAL_FAILED');
   const snapshot=(await pool.query(`SELECT payload FROM ${schema}.master_wok_notification_outbox WHERE order_id=$1 AND event_type LIKE 'time_suggested:%'`,[proposal.response.orderId])).rows[0]?.payload;
   check(/^[a-f0-9]{32,64}$/.test(snapshot?.confirm_token||'')&&snapshot.preferred_time==='2099-01-02T19:00:00.000Z','OPAQUE_PROPOSAL_SNAPSHOT_MISSING');
   check((await lifecycle.adminAction({orderId:proposal.response.orderId,action:'decline'})).committed,'NOTIFICATION_CANCELLATION_FAILED');
   // Created + proposed events are now obsolete. Neither should be sent.
   const staleA=await dispatch({action:'claim'}),staleB=await dispatch({action:'claim'});
   check(staleA.skipped&&staleB.skipped,'SUPERSEDED_NOTIFICATION_NOT_SUPPRESSED');
   results.push('LIFECYCLE_NOTIFICATION_SNAPSHOTS_USE_OPAQUE_TOKENS_AND_SKIP_CANCELLED_PROPOSALS');
   await clear();
   const handler=createNotificationHttpHandler({secret:'notification-fixture-secret-1234567890',dispatch});
   const denied=await handler(new Request('https://staging.invalid',{method:'POST',headers:{'x-master-wok-secret':'notification-fixture-secret-1234567890'},body:'{"action":"claim"}'}));
   check(denied.status===401,'BOOKING_SECRET_AUTHORIZED_NOTIFICATION_WORKER');
   results.push('NOTIFICATION_ENDPOINT_REQUIRES_SEPARATE_WORKER_AUTHENTICATION');
  }
  {
   const email=prefix+'delivery@example.invalid',phone='07700900126';
   let outside=false,routeFails=false;const requests=[];
   const trusted=createCommercialValidator({deliveryService:{supabaseUrl:'https://hvrqgufqjslvgiohgkvu.supabase.co',publicKey:'sb_publishable_private_fixture',fetch:async(url,options)=>{
    const body=JSON.parse(options.body),path=new URL(url).pathname;requests.push({path,body});
    if(path.endsWith('geocode-address'))return {ok:true,json:async()=>({ok:true,customer_lat:outside?54:53.75,customer_lng:-1.58})};
    if(routeFails)throw Error('Fixture route outage');return {ok:true,json:async()=>({ok:true,routeMiles:1.4})};
   }}});
   const delivery=make({validateCommercialOrder:(c,i,state)=>trusted(rewrite(c),i,state)});
   const input={key:prefix+'delivery',preferredTime:'2099-01-02T18:00:00Z',orderType:'delivery',customer:{name:'Private fixture',email,phone,address:'Fixture address'},
    items:[{item_id:'green-curry',qty:1,modifiers:[{id:'chicken'}],spice:1}],expectedTotals:{subtotal:9,total:11,delivery_fee:2,discount:0,loyalty_discount:0},
    customer_lat:0,customer_lng:0,routeMiles:0};
   try{
    const booked=await delivery(input);check(booked.committed,'SERVER_DELIVERY_CHECKOUT_FAILED');
    const saved=(await pool.query(`SELECT customer_lat,customer_lng,delivery_route_miles,delivery_fee,total FROM ${schema}.orders WHERE id=$1`,[booked.response.orderId])).rows[0];
    check(Number(saved.customer_lat)===53.75&&Number(saved.delivery_route_miles)===1.4&&Number(saved.delivery_fee)===2&&Number(saved.total)===11,'CLIENT_DISTANCE_OR_FEE_WAS_TRUSTED');
    check(requests[0].body.customer_address==='Fixture address'&&requests[1].body.origin.lat===53.744437,'EXISTING_DELIVERY_SERVICE_CONTRACT_CHANGED');
    results.push('SERVER_GEOCODE_AND_ROUTE_CONTRACT_JOINED_TO_ATOMIC_DELIVERY_BOOKING_IGNORES_CLIENT_DISTANCE');
    await clear();requests.length=0;outside=true;
    const rejected=await delivery({...input,key:prefix+'delivery-outside',items:[{...input.items[0],qty:4}],expectedTotals:{...input.expectedTotals,subtotal:36,total:36,delivery_fee:0}});
    check(!rejected.committed&&requests.length===1,'FREE_DELIVERY_BYPASSED_RADIUS');
    results.push('FREE_DELIVERY_STILL_ENFORCES_SERVER_VERIFIED_THREE_MILE_RADIUS');
    outside=false;routeFails=true;
    const fallback=await delivery({...input,key:prefix+'delivery-fallback',expectedTotals:{...input.expectedTotals,total:12,delivery_fee:3}});
    check(fallback.committed&&fallback.response.totals.delivery_fee===3,'ROUTE_OUTAGE_FALLBACK_NOT_PRESERVED');
    const priceChanged=await delivery({...input,key:prefix+'delivery-stale-price'});
    check(!priceChanged.committed&&priceChanged.reason==='CHECKOUT_PRICE_CHANGED','CHANGED_FEE_ACCEPTED_WITHOUT_CUSTOMER_REVIEW');
    results.push('TRUSTED_DELIVERY_FALLBACK_PRESERVED_AND_CHANGED_CHECKOUT_TOTAL_REFUSED');
   }finally{await clear();await pool.query(`DELETE FROM ${schema}.customers WHERE email=$1`,[email]);}
  }
  {
   const args={pool,model:globalThis.MasterWokModelV1,readAvailability:(c,d)=>readBookingAvailability(rewrite(c),d),
    readOrders:(c,d)=>readCapacityCommitments(rewrite(c),d),planStore,assertWriteAllowed:async()=>{}};
   const hint=createBasketAvailability({...args,assessBooking:assess});
   const items=[{item_id:'pad-thai',qty:2,modifiers:[{id:'chicken'}],spice:null}],times=['2099-01-02T17:05:00.000Z'];
   const before=(await pool.query(`SELECT count(*)::int n FROM ${schema}.orders`)).rows[0].n;
   const initial=await hint({times,items});
   check(initial.success&&initial.hints[0].available&&initial.bookingApprovalAllowed===false,'READ_ONLY_HINT_FAILED');
   check((await pool.query(`SELECT count(*)::int n FROM ${schema}.orders`)).rows[0].n===before,'AVAILABILITY_CREATED_AN_ORDER');
   check((await pool.query(`SELECT count(*)::int n FROM ${schema}.master_wok_service_plans`)).rows[0].n===0,'AVAILABILITY_PERSISTED_A_PLAN');
   const prototype=createBasketAvailability({...args,assessBooking:assessCombinedBooking});
   check((await prototype({times,items})).hints.every(h=>!h.available),'PROTOTYPE_HINT_BECAME_APPROVAL');
   results.push('BASKET_AVAILABILITY_ROLLS_BACK_WITHOUT_ORDER_OR_PLAN_AND_REQUIRES_CERTIFIED_ASSESSOR');
   const source=await make()({...request('hint-race'),items});check(source.committed,'HINT_RACE_SETUP_FAILED');
   const planBefore=(await pool.query(`SELECT revision FROM ${schema}.master_wok_service_plans WHERE service_date=$1`,[date])).rows[0].revision;
   const latest=await hint({times,items});
   check(latest.success&&!latest.hints[0].available,'AVAILABILITY_DID_NOT_RELOAD_COMMITTED_ORDER');
   const replayAttempt=await make()({...request('hint-stale'),items});check(!replayAttempt.committed,'OLD_HINT_RESERVED_CAPACITY');
   check((await pool.query(`SELECT revision FROM ${schema}.master_wok_service_plans WHERE service_date=$1`,[date])).rows[0].revision===planBefore,'HINT_CHANGED_COMMITTED_PLAN');
   results.push('FRESH_AVAILABILITY_SEES_CONCURRENT_BOOKING_AND_OLD_HINT_CANNOT_RESERVE_CAPACITY');
   await clear();
   const allTimes=Array.from({length:61},(_,i)=>new Date(Date.parse('2099-01-02T17:00:00Z')+i*300000).toISOString());
   const started=performance.now(),day=await hint({times:allTimes,items});
   check(day.success&&day.hints.length===61&&performance.now()-started<5000,'WHOLE_DAY_HINT_BUDGET_FAILED');
   results.push('WHOLE_DAY_NORMAL_AND_OVERRUN_HINTS_USE_ONE_SNAPSHOT_WITH_BOUNDED_REQUEST');
  }
  {
   const email=prefix+'confirmed-recipes@example.invalid',phone='07700900127';
   const trusted=createCommercialValidator();
   const items=[{item_id:'fish-cakes',qty:1,modifiers:[],spice:1},
    {item_id:'fried-prawns',qty:1,modifiers:[],spice:null},{item_id:'pork-dumplings',qty:1,modifiers:[],spice:null},
    {item_id:'spare-ribs',qty:1,modifiers:[],spice:null},{item_id:'fried-egg',qty:2,modifiers:[],spice:null},
    {item_id:'stir-basil',qty:1,modifiers:[{id:'chicken'},{id:'extra-egg'}],spice:1}];
   const base={orderType:'collection',preferredTime:'2099-01-02T18:00:00Z',items,
    customer:{name:'Confirmed recipe fixture',email,phone},paymentPreference:'on_arrival',communicationPreference:'sms'};
   const prices=calculateCommercialOrder(base,{now:'2099-01-02T16:00:00Z'}).header;
   const input={...base,key:prefix+'confirmed-recipes',expectedTotals:Object.fromEntries(['subtotal','total','discount','loyalty_discount','delivery_fee'].map(k=>[k,prices[k]]))};
   const build=(extra={})=>make({validateCommercialOrder:(c,i,state)=>trusted(rewrite(c),i,state),...extra});
   try{
    const created=await build({pool:clockPool('2099-01-02T16:00:00Z')})(input);
    check(created.committed,'CONFIRMED_RECIPE_COMMERCIAL_BOOKING_FAILED');
    const saved=(await pool.query(`SELECT plan FROM ${schema}.master_wok_service_plans WHERE service_date=$1`,[date])).rows[0].plan;
    check(saved.auxiliary.jobs.filter(j=>j.resource==='microwave').length===2,'MICROWAVE_CYCLES_NOT_PERSISTED');
    check(saved.auxiliary.jobs.filter(j=>j.itemId==='fried-egg').reduce((n,j)=>n+j.portions,0)===3,'EXTRA_EGG_NOT_COUNTED');
    check(saved.auxiliary.jobs.every(j=>j.orderIds.every(id=>id.startsWith(created.response.orderId+'@'))),'AUXILIARY_ORDER_ID_NOT_REMAPPED');
    check(saved.fryer.jobs.some(j=>j.type==='fishCakeBatch'&&j.finish-j.start===3)&&saved.fryer.jobs.some(j=>j.type==='friedPrawnBatch'&&j.finish-j.start===2),'CONFIRMED_FRY_TIMINGS_NOT_PERSISTED');
    results.push('ACTUAL_COMMERCIAL_MIXED_STARTER_MAIN_AND_EXTRA_EGG_BASKET_PERSISTS_ALL_RESOURCE_JOBS');
    const runningJob=saved.auxiliary.jobs.filter(j=>j.resource==='microwave').sort((a,b)=>a.start-b.start)[0];
    const minute=runningJob.start+1;
    const clock='2099-01-02T'+String(Math.floor(minute/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0')+':00Z';
    const next=await make({pool:clockPool(clock)})(request('confirmed-next','2099-01-02T19:00:00Z','green-curry',1));
    check(next.committed,'BOOKING_AROUND_STARTED_MICROWAVE_FAILED');
    const reloaded=(await pool.query(`SELECT plan FROM ${schema}.master_wok_service_plans WHERE service_date=$1`,[date])).rows[0].plan;
    check(reloaded.auxiliary.jobs.some(j=>JSON.stringify(j)===JSON.stringify(runningJob)),'STARTED_MICROWAVE_MOVED_AFTER_RECONNECT');
    results.push('FRESH_CONNECTION_BOOKING_PRESERVES_STARTED_MICROWAVE_CYCLE');
    const writer=createLifecycleWriter({pool:clockPool(clock),schema,mode:'MASTER_WOK',assessMutation:async ctx=>{
     const a=await checkMutation(ctx);return a.status==='VALIDATED_LIFECYCLE_ASSESSMENT'?{...a,status:'GREEN',bookingApprovalAllowed:true}:a;
    }});
    check((await writer.adminAction({orderId:created.response.orderId,action:'decline'})).committed,'STARTED_AUXILIARY_CANCELLATION_FAILED');
    const cancelled=(await pool.query(`SELECT plan FROM ${schema}.master_wok_service_plans WHERE service_date=$1`,[date])).rows[0].plan;
    check(cancelled.auxiliary.jobs.some(j=>JSON.stringify(j)===JSON.stringify(runningJob)),'CANCELLATION_ERASED_STARTED_MICROWAVE');
    results.push('CANCELLATION_PRESERVES_STARTED_AUXILIARY_WORK_WITHOUT_CHEF_CONFIRMATIONS');
    const beforeFailure=(await pool.query(`SELECT plan,revision FROM ${schema}.master_wok_service_plans WHERE service_date=$1`,[date])).rows[0];
    const broken={...planStore,save:async(c,d,p)=>{await planStore.save(c,d,p);throw Error('FIXTURE_AFTER_AUXILIARY_PLAN');}};
    const failed=await build({pool:clockPool(clock),planStore:broken})({...input,key:prefix+'confirmed-failure',preferredTime:'2099-01-02T20:00:00Z'});
    check(!failed.committed,'AUXILIARY_PLAN_FAILURE_COMMITTED');
    check(JSON.stringify((await pool.query(`SELECT plan,revision FROM ${schema}.master_wok_service_plans WHERE service_date=$1`,[date])).rows[0])===JSON.stringify(beforeFailure),'FAILED_AUXILIARY_PLAN_LEFT_CHANGE');
    check((await pool.query(`SELECT count(*)::int n FROM ${schema}.orders WHERE idempotency_key=$1`,[prefix+'confirmed-failure'])).rows[0].n===0,'FAILED_AUXILIARY_PLAN_LEFT_ORDER');
    results.push('FAILURE_AFTER_AUXILIARY_PLAN_WRITE_ROLLS_BACK_FULL_MIXED_BASKET');
   }finally{await clear();await pool.query(`DELETE FROM ${schema}.customers WHERE email=$1`,[email]);}
  }
  return {status:'PASS',scope:'PRIVATE_STAGING_ATOMIC_CHECKOUT_REHEARSAL',tests:results,
   productionReady:false,productionWrites:0,publicStagingOrderWrites:0};
 }finally{await clear();await pool.query(`DELETE FROM ${schema}.master_wok_launch_control WHERE approved_release_id=$1`,['private-staging-fixture-release']);await pool.end();}
}
Deno.serve(async req=>{
 if(req.headers.get('authorization')!=='Bearer '+TOKEN)return new Response('Forbidden',{status:403});
 if(req.method!=='POST')return new Response('Method not allowed',{status:405});
 if(!running)running=run().catch(e=>({status:'FAIL',reason:e.message,productionReady:false}));
 return Response.json(await running);
});
