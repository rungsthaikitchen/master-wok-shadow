// Private staging integration harness. Fixed generated baskets only; no
// request-driven bookings, production URLs, launch changes or notification sends.
import pg from 'npm:pg@8.23.1';
const {createAtomicCheckout}=require('./master-wok-atomic-checkout');
const {createOrderStore}=require('./master-wok-order-store');
const {createServicePlanStore}=require('./master-wok-service-plan-store');
const {readCapacityCommitments}=require('./master-wok-commitment-reader');
const {calculateCommercialOrder,catalog}=require('./master-wok-commercial');
const {assessCombinedBooking}=require('./master-wok-combined-assessment');
const {createLifecycleWriter}=require('./master-wok-lifecycle');
const {createMutationAssessment}=require('./master-wok-mutation-assessment');
const {createDeliveryCapacity}=require('./master-wok-delivery-capacity');
const {createCommercialValidator}=require('./master-wok-commercial-validator');
require('./master-wok-model-bundle');
const TOKEN='__CERTIFICATION_TOKEN__',EXPIRES='__BROWSER_EXPIRES__',schema='master_wok_rehearsal',date='2099-11-11';
const check=(ok,name)=>{if(!ok)throw Error(name);};
const runs=new Map();
async function run(phase){
 check(Deno.env.get('SUPABASE_URL')==='https://hvrqgufqjslvgiohgkvu.supabase.co','STAGING_PROJECT_REQUIRED');
 const pool=new pg.Pool({connectionString:Deno.env.get('SUPABASE_DB_URL'),max:4,connectionTimeoutMillis:10000});
 const owner=await pool.connect(),prefix='four-ring-race-'+crypto.randomUUID()+'-',checks=[];
 let owned=false,raceStatuses=[];
 const fixtureEmail=prefix+'@example.invalid',fixturePhone='07700900988';let ownsContact=false;
 const store=createOrderStore({schema}),planStore=createServicePlanStore({schema});
 let simulationClock=null;
 const clockPool={connect:async()=>{
  const c=await pool.connect();return {release:()=>c.release(),query:(sql,args)=>
   sql==='SELECT clock_timestamp() AS now'&&simulationClock?
    Promise.resolve({rows:[{now:new Date(simulationClock)}]}):c.query(sql,args)};
 }};
 const ordersTable=schema+'.orders',plansTable=schema+'.master_wok_service_plans';
 const rewrite=c=>({query:(sql,args)=>c.query(sql.replaceAll('public.orders',schema+'.orders')
  .replaceAll('public.order_items',schema+'.order_items').replaceAll('public.customers',schema+'.customers')
  .replaceAll('public.loyalty_accounts',schema+'.loyalty_accounts').replaceAll('public.discount_codes',schema+'.discount_codes')
  .replace('SELECT public.get_next_order_number() AS value',`WITH bump AS (UPDATE ${schema}.order_counters SET current_num=current_num+1 WHERE id=1 RETURNING current_num) SELECT json_build_object('assigned',current_num) AS value FROM bump`),args)});
 const clear=async()=>{
  if(!owned)return;
  await pool.query(`DELETE FROM ${schema}.master_wok_time_responses WHERE order_id IN (SELECT id FROM ${ordersTable} WHERE idempotency_key LIKE $1)`,[prefix+'%']);
  await pool.query(`DELETE FROM ${schema}.master_wok_notification_outbox WHERE order_id IN (SELECT id FROM ${ordersTable} WHERE idempotency_key LIKE $1)`,[prefix+'%']);
  await pool.query(`DELETE FROM ${schema}.master_wok_booking_receipts WHERE key LIKE $1`,[prefix+'%']);
  await pool.query(`DELETE FROM ${ordersTable} WHERE idempotency_key LIKE $1`,[prefix+'%']);
  await pool.query(`DELETE FROM ${plansTable} WHERE service_date=$1 AND NOT EXISTS
   (SELECT 1 FROM ${ordersTable} WHERE (preferred_time AT TIME ZONE 'Europe/London')::date=$1::date)`,[date]);
 };
 const snapshot=async()=>{
  const r=await pool.query(`SELECT
   (SELECT count(*)::int FROM ${ordersTable} WHERE idempotency_key LIKE $1) AS orders,
   (SELECT count(*)::int FROM ${schema}.order_items WHERE order_id IN (SELECT id FROM ${ordersTable} WHERE idempotency_key LIKE $1)) AS items,
   (SELECT count(*)::int FROM ${schema}.master_wok_booking_receipts WHERE key LIKE $1) AS receipts,
   (SELECT count(*)::int FROM ${schema}.master_wok_notification_outbox WHERE order_id IN (SELECT id FROM ${ordersTable} WHERE idempotency_key LIKE $1)) AS events,
   (SELECT count(*)::int FROM ${plansTable} WHERE service_date=$2) AS plans`,[prefix+'%',date]);
  return r.rows[0];
 };
 const request=(key,qty=12)=>({key:prefix+key,orderType:'collection',preferredTime:date+'T17:00:00Z',
  communicationPreference:'email',items:[{item_id:'green-curry',qty,modifiers:[{id:'chicken'}],spice:1}]});
 const make=(extra={})=>createAtomicCheckout({pool:clockPool,model:globalThis.MasterWokModelV1,store,planStore,
  mode:'MASTER_WOK',validateCommercialOrder:async(_c,input)=>calculateCommercialOrder(input,{now:new Date()}),
  readAvailability:async()=>({blackouts:[],openDays:[0,1,2,3,4,5,6],serviceState:{mode:'normal',capacity_throttle:0}}),
  readOrders:(c,d)=>readCapacityCommitments(rewrite(c),d),
  assessBooking:context=>{
   const r=assessCombinedBooking(context,{sharedRings:true,stagingSharedRings:true});
   // Test-only authority in this fixed-schema harness. Release certificates and
   // durable launch controls are never changed or bypassed in a deployed app.
   return r.status==='VALIDATED_COMBINED_ASSESSMENT'?{...r,status:'GREEN',bookingApprovalAllowed:true}:r;
  },...extra});
 try{
  const lock=await owner.query("SELECT pg_try_advisory_lock(hashtextextended('four-ring-private-fixture',47825)) AS locked");
  check(lock.rows[0].locked,'HARNESS_ALREADY_RUNNING');
  const empty=await pool.query(`SELECT
   (SELECT count(*) FROM ${ordersTable} WHERE (preferred_time AT TIME ZONE 'Europe/London')::date=$1::date) AS orders,
   (SELECT count(*) FROM ${plansTable} WHERE service_date=$1) AS plans`,[date]);
  check(Number(empty.rows[0].orders)===0&&Number(empty.rows[0].plans)===0,'FIXTURE_DATE_NOT_EMPTY');owned=true;
  const line=(item_id,protein=null,qty=1,spice=null)=>({item_id,qty,modifiers:protein?[{id:protein}]:[],
   spice:spice??(catalog.items.find(i=>i.id===item_id).spiceDefault||catalog.items.find(i=>i.id===item_id).spiceMin||0)});
  const original=[line('pork-dumplings'),line('red-curry','chicken',1,1),line('stir-pepper','beef',1,1),
   line('chef-pad-thai','pork',1,1),line('fried-rice','chicken'),line('jasmine-rice'),line('coconut-rice'),line('chips')];
  if(phase==='atomic'){
  const checkout=make(),same=request('same');
  const repeated=await Promise.all([checkout(same),checkout(same)]);
  check(repeated.every(r=>r.status==='GREEN')&&repeated.filter(r=>r.committed).length===1&&
   repeated[0].response.orderId===repeated[1].response.orderId,'SAME_KEY_RACE_FAILED');
  check(JSON.stringify(await snapshot())===JSON.stringify({orders:1,items:1,receipts:1,events:1,plans:1}),'SAME_KEY_DUPLICATED_DATA');
  checks.push('SAME_KEY_TWO_CONNECTIONS_ONE_ORDER_AND_PLAN');
  const changed=await checkout({...same,items:request('unused',11).items});
  check(changed.reason==='IDEMPOTENCY_CONFLICT'&&!changed.committed,'CHANGED_RETRY_ACCEPTED');
  checks.push('CHANGED_RETRY_REJECTED');await clear();
  const distinct=await Promise.all([checkout(request('a')),checkout(request('b'))]);
  raceStatuses=distinct.map(r=>r.status);
  check(distinct.filter(r=>r.committed).length===1&&distinct.filter(r=>r.status==='UNVERIFIED').length===1,'DISTINCT_KEY_OVERBOOK');
  check(JSON.stringify(await snapshot())===JSON.stringify({orders:1,items:1,receipts:1,events:1,plans:1}),'DISTINCT_KEY_PARTIAL_DATA');
  const saved=(await pool.query(`SELECT plan FROM ${plansTable} WHERE service_date=$1`,[date])).rows[0].plan;
  check(saved.modelVersion==='combined-kitchen-four-ring-staging-v1'&&saved.wok.jobs.length===12&&
   saved.wok.jobs.every(j=>j.portions===1),'FOUR_RING_PLAN_NOT_PERSISTED');
  checks.push('DISTINCT_KEY_TWO_CONNECTIONS_REASSESS_LOCKED_FOUR_RING_CAPACITY');await clear();
  const broken=make({planStore:{...planStore,save:async()=>{throw Error('INJECTED_PLAN_SAVE_FAILURE');}}});
  const failed=await broken(request('fail',1));
  check(!failed.committed&&failed.reason==='TRANSACTION_FAILED','FAILURE_NOT_REJECTED');
  check(Object.values(await snapshot()).every(v=>v===0),'FAILURE_LEFT_PARTIAL_ORDER');
  checks.push('PLAN_SAVE_FAILURE_ROLLS_BACK_HEADER_ITEMS_RECEIPT_AND_EVENT');
  }
  if(phase==='service'){
  const mutation=createMutationAssessment({model:globalThis.MasterWokModelV1,planStore,stagingSharedRings:true,
   readOrders:(c,d)=>readCapacityCommitments(rewrite(c),d),
   readAvailability:async()=>({blackouts:[],openDays:[0,1,2,3,4,5,6],serviceState:{mode:'normal',capacity_throttle:0}})});
  const lifecycle=createLifecycleWriter({pool:clockPool,schema,mode:'MASTER_WOK',assessMutation:async ctx=>{
   const r=await mutation(ctx);return r.status==='VALIDATED_LIFECYCLE_ASSESSMENT'?{...r,status:'GREEN',bookingApprovalAllowed:true}:r;
  }});
  const created=[];
  for(const [index,ready,items] of [
   [0,'17:30',[line('green-curry','chicken',1,1),line('jasmine-rice')]],
   [1,'18:00',[line('pad-thai','prawn'),line('fish-cakes')]],
   [2,'18:30',original],[3,'19:15',original.map(l=>({...l,qty:2}))],
   [4,'20:00',[line('stir-crispy'),line('pork-dumplings',null,3)]],
   [5,'20:30',[line('red-curry','pork',1,1),line('spare-ribs')]],
   [6,'21:00',[line('pad-see-ew','chicken'),line('thai-sausage')]]
  ]){
   simulationClock=date+'T'+['16:00','16:40','17:00','17:25','18:00','18:40','19:10'][index]+':00Z';
   const input={...request('service-'+index),preferredTime:date+'T'+ready+':00Z',items};
   const r=await make()(input);check(r.committed,'SERVICE_BOOKING_FAILED_'+index+':'+r.reason);created.push(r.response.orderId);
   if(index===2)check(r.response.totals.total===50,'ORIGINAL_BASKET_TOTAL_CHANGED');
   if(index===3)check(r.response.totals.total===100,'DOUBLE_BASKET_TOTAL_CHANGED');
   if(index===1){
    check((await lifecycle.adminAction({orderId:created[1],action:'suggest_time',proposedTime:date+'T18:10:00Z'})).committed,'TIME_PROPOSAL_FAILED');
    const token=(await pool.query(`SELECT confirm_token FROM ${ordersTable} WHERE id=$1`,[created[1]])).rows[0].confirm_token;
    check((await lifecycle.customerResponse({orderId:created[1],action:'customer_accept',token})).committed,'TIME_ACKNOWLEDGEMENT_FAILED');
   }
   if(index===3){
    const before=(await pool.query(`SELECT plan FROM ${plansTable} WHERE service_date=$1`,[date])).rows[0].plan;
    const fixed=before.wok.jobs.filter(j=>j.orderIds.some(id=>id.startsWith(created[0]+'@')));
    check((await lifecycle.adminAction({orderId:created[0],action:'decline'})).committed,'STARTED_CANCELLATION_FAILED');
    const after=(await pool.query(`SELECT plan FROM ${plansTable} WHERE service_date=$1`,[date])).rows[0].plan;
    check(fixed.length>0&&fixed.every(j=>after.wok.jobs.some(k=>JSON.stringify(j)===JSON.stringify(k))),'CANCELLED_STARTED_WORK_MOVED');
   }
  }
  check((await snapshot()).orders===7,'SERVICE_ORDER_COUNT_CHANGED');
  checks.push('SEVEN_ORDER_SERVICE_WITH_ORIGINAL_50_AND_100_BASKETS');
  checks.push('CUSTOMER_ACKNOWLEDGED_TIME_CHANGE_AND_STARTED_CANCELLATION');
  }
  if(phase==='delivery'){
  simulationClock=date+'T16:00:00Z';
  // Fixed server-side travel fixture: five minutes each leg. This does not
  // represent a live Google route quote or customer-supplied coordinates.
  const delivery=createDeliveryCapacity({stagingSharedRings:true,quoteLeg:async()=>({durationSeconds:300})});
  const deliveryCheckout=make({validateCommercialOrder:async(_c,input)=>{
   const priced=calculateCommercialOrder(input,{now:new Date(),deliveryQuote:input.orderType==='delivery'?{straightLineMiles:1,routeMiles:1.5}:null});
   if(input.orderType==='delivery')Object.assign(priced.header,{customer_lat:53.75,customer_lng:-1.58});
   return priced;
  },assessBooking:async context=>{
   const r=await delivery.verify(context);return r.status==='VERIFIED_KITCHEN_CAPACITY'?{...r,status:'GREEN',bookingApprovalAllowed:true}:r;
  }});
  for(const [index,ready,items,type] of [[0,'18:30',original,'delivery'],
   [1,'19:30',original.map(l=>({...l,qty:2})),'delivery'],[2,'19:00',[line('pad-thai','chicken')],'collection']]){
   const r=await deliveryCheckout({...request('delivery-'+index),orderType:type,preferredTime:date+'T'+ready+':00Z',items});
   check(r.committed,'DELIVERY_JOIN_FAILED_'+index+':'+r.reason);
  }
  const delivered=(await pool.query(`SELECT plan FROM ${plansTable} WHERE service_date=$1`,[date])).rows[0].plan;
  check(delivered.delivery.trips.length===2,'COLLECTION_ERASED_DRIVER_TRIP');
  for(const trip of delivered.delivery.trips){
   check(trip.stops[0].arrival===trip.stops[0].target,'ARRIVAL_CHANGED_TO_KITCHEN_READY');
   const jobs=[...delivered.wok.jobs,...delivered.fryer.jobs,...delivered.auxiliary.jobs].filter(j=>j.orderIds.includes(trip.stops[0].id));
   check(jobs.length>0&&jobs.every(j=>j.finish<=trip.start),'DELIVERY_COOKING_AFTER_LOADING');
  }
  checks.push('50_AND_100_DELIVERY_BASKETS_KEEP_DOOR_ARRIVAL_AND_DRIVER_TRIPS_WITH_COLLECTION');
  }
  if(phase==='loyalty'){
   const occupied=await pool.query(`SELECT
    (SELECT count(*) FROM ${schema}.customers WHERE phone=$1) AS customers,
    (SELECT count(*) FROM ${schema}.loyalty_accounts WHERE customer_phone=$1) AS accounts`,[fixturePhone]);
   check(Number(occupied.rows[0].customers)===0&&Number(occupied.rows[0].accounts)===0,'LOYALTY_FIXTURE_PHONE_IN_USE');
   await pool.query(`INSERT INTO ${schema}.loyalty_accounts(customer_phone,customer_email,points_balance,lifetime_points) VALUES($1,$2,100,0)`,[fixturePhone,fixtureEmail]);ownsContact=true;
   simulationClock=date+'T16:00:00Z';
   const trusted=createCommercialValidator(),checkout=make({validateCommercialOrder:(c,i,state)=>trusted(rewrite(c),i,state)});
   const input=(key,time,balance,reserved=0)=>{
    const i={...request(key,1),preferredTime:date+'T'+time+':00Z',customer:{name:'Synthetic loyalty rehearsal',email:fixtureEmail,phone:fixturePhone}};
    i.expectedTotals=calculateCommercialOrder(i,{now:new Date(simulationClock),settledPoints:balance,reservedPoints:reserved}).header;return i;
   };
   const first=await checkout(input('reward','18:00',100)),second=await checkout(input('earned','19:00',100,100));
   check(first.committed&&second.committed,'LOYALTY_CHECKOUT_FAILED');
   check(first.response.totals.total===4&&second.response.totals.total===9,'REWARD_RESERVATION_FAILED');
   const account=async()=> (await pool.query(`SELECT points_balance,lifetime_points FROM ${schema}.loyalty_accounts WHERE customer_phone=$1`,[fixturePhone])).rows[0];
   check((await account()).points_balance===100,'CHECKOUT_SETTLED_POINTS_EARLY');
   const mutation=createMutationAssessment({model:globalThis.MasterWokModelV1,planStore,stagingSharedRings:true,
    readOrders:(c,d)=>readCapacityCommitments(rewrite(c),d),readAvailability:async()=>({blackouts:[],serviceState:{mode:'normal',capacity_throttle:0}})});
   const buildLifecycle=p=>createLifecycleWriter({pool:p,schema,mode:'MASTER_WOK',assessMutation:async ctx=>{
    const r=await mutation(ctx);return r.status==='VALIDATED_LIFECYCLE_ASSESSMENT'?{...r,status:'GREEN',bookingApprovalAllowed:true}:r;
   }});
   simulationClock=date+'T19:15:00Z';
   const brokenPool={connect:async()=>{const c=await clockPool.connect();return {release:()=>c.release(),query:async(sql,args)=>{
    const r=await c.query(sql,args);if(sql.includes('SET loyalty_settled=true'))throw Error('INJECTED_AFTER_LOYALTY_UPDATE');return r;
   }};}};
   const failed=await buildLifecycle(brokenPool).adminAction({orderId:first.response.orderId,action:'complete'});
   check(!failed.committed&&(await account()).points_balance===100,'FAILED_COMPLETION_CHANGED_BALANCE');
   const unchanged=(await pool.query(`SELECT status,loyalty_settled FROM ${ordersTable} WHERE id=$1`,[first.response.orderId])).rows[0];
   check(unchanged.status==='pending'&&!unchanged.loyalty_settled,'FAILED_COMPLETION_CHANGED_ORDER');
   const writer=buildLifecycle(clockPool),repeated=await Promise.all([1,2].map(()=>writer.adminAction({orderId:first.response.orderId,action:'complete'})));
   check(repeated.every(r=>r.committed),'CONCURRENT_COMPLETION_FAILED');
   check((await account()).points_balance===4&&(await account()).lifetime_points===4,'DUPLICATED_REWARD_SETTLEMENT');
   check((await writer.adminAction({orderId:second.response.orderId,action:'complete'})).committed,'SECOND_COMPLETION_FAILED');
   check((await account()).points_balance===13&&(await account()).lifetime_points===13,'EARNED_POINTS_INCORRECT');
   const cancelled=await checkout(input('cancelled','20:00',13));check(cancelled.committed,'CANCELLATION_FIXTURE_FAILED');
   check((await writer.adminAction({orderId:cancelled.response.orderId,action:'decline'})).committed,'CANCELLATION_FAILED');
   check((await account()).points_balance===13,'CANCELLATION_AWARDED_POINTS');
   checks.push('TRUSTED_PRICING_RESERVES_ONE_REWARD_WITHOUT_SETTLING_AT_CHECKOUT',
    'FAILED_COMPLETION_ROLLS_BACK_ORDER_AND_POINTS',
    'CONCURRENT_COMPLETION_SETTLES_REDEMPTION_AND_EARNINGS_EXACTLY_ONCE',
    'SECOND_COMPLETION_EARNS_POINTS_AND_CANCELLATION_EARNS_NONE');
  }
  return {status:'PASS',scope:'HOSTED_PRIVATE_FOUR_RING_'+phase.toUpperCase(),checks,
   raceStatuses,productionWrites:0,realNotificationsSent:0,productionReady:false};
 }finally{
  await clear();
  if(ownsContact){
   await pool.query(`DELETE FROM ${schema}.customers WHERE phone=$1 AND email=$2`,[fixturePhone,fixtureEmail]);
   await pool.query(`DELETE FROM ${schema}.loyalty_accounts WHERE customer_phone=$1 AND customer_email=$2`,[fixturePhone,fixtureEmail]);
  }
  await owner.query("SELECT pg_advisory_unlock(hashtextextended('four-ring-private-fixture',47825))");
  owner.release();await pool.end();
 }
}
Deno.serve(async req=>{
 if(req.headers.get('authorization')!=='Bearer '+TOKEN)return new Response('Forbidden',{status:403});
 if(!Number.isFinite(Date.parse(EXPIRES))||Date.now()>Date.parse(EXPIRES))return new Response('Expired',{status:410});
 if(req.method!=='POST')return new Response('Method not allowed',{status:405});
 const phase=new URL(req.url).searchParams.get('phase');
 if(!['atomic','service','delivery','loyalty'].includes(phase))return new Response('Fixed rehearsal phase required',{status:400});
 if(!runs.has(phase))runs.set(phase,run(phase).catch(e=>({status:'FAIL',reason:e.message,productionReady:false})));
 return Response.json(await runs.get(phase),{headers:{'cache-control':'no-store'}});
});
