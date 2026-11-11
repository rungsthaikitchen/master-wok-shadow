// Private PostgreSQL integration rehearsal. Isolated schema; no real customers,
// provider sends, production changes or shared rehearsal launch-mode changes.
import pg from 'npm:pg@8.23.1';
const {createBookingRuntime}=require('./master-wok-runtime');
const {createReleaseAssessors,REQUIRED_CHECKS,DELIVERY_CHECKS}=require('./master-wok-release-assessors');
const {createDeliveryCapacity}=require('./master-wok-delivery-capacity');
const {createCommercialValidator}=require('./master-wok-commercial-validator');
const {readCapacityCommitments}=require('./master-wok-commitment-reader');
const {readBookingAvailability}=require('./master-wok-availability-reader');
const {createServicePlanStore}=require('./master-wok-service-plan-store');
require('./master-wok-model-bundle');
const TOKEN='__CERTIFICATION_TOKEN__',RUN='__BROWSER_RUN__',EXPIRES='__BROWSER_EXPIRES__';
const schema='master_wok_delivery_'+RUN,sourceSchema='master_wok_rehearsal',date='2026-11-05',releaseId='delivery-rehearsal-'+RUN;
const check=(yes,code)=>{if(!yes)throw Error(code);};
Deno.serve(async req=>{
 if(Deno.env.get('SUPABASE_URL')!=='https://hvrqgufqjslvgiohgkvu.supabase.co'||
  !/^[a-f0-9]{64}$/.test(TOKEN)||!/^[a-f0-9]{16}$/.test(RUN)||req.headers.get('authorization')!=='Bearer '+TOKEN)return new Response('Forbidden',{status:403});
 if(!Number.isFinite(Date.parse(EXPIRES))||Date.now()>Date.parse(EXPIRES))return new Response('Expired',{status:410});
 if(req.method!=='POST')return new Response('POST required',{status:405});
 const native=new pg.Pool({connectionString:Deno.env.get('SUPABASE_DB_URL'),max:4,connectionTimeoutMillis:10000});
 const rewrite=sql=>sql.replaceAll('"master_wok_rehearsal"','"'+schema+'"').replaceAll('master_wok_rehearsal.',schema+'.')
  .replace('SELECT public.get_next_order_number() AS value',`WITH bump AS (UPDATE ${schema}.order_counters SET current_num=current_num+1 WHERE id=1 RETURNING current_num) SELECT json_build_object('assigned',current_num) AS value FROM bump`)
  .replaceAll('public.',schema+'.');
 const pool={async connect(){const c=await native.connect();return {query:(sql,args)=>c.query(rewrite(sql),args),release:()=>c.release()};},query:(sql,args)=>native.query(rewrite(sql),args)};
 const results=[];let phase='SETUP';
 try{
  const setup=await native.connect();
  try{
   await setup.query('BEGIN');
   // CREATE without IF NOT EXISTS prevents a rerun overwriting evidence.
   await setup.query(`CREATE SCHEMA ${schema}`);
   for(const name of ['orders','order_items','customers','loyalty_accounts','discount_codes','service_state','booking_blackouts','order_counters',
    'master_wok_launch_control','master_wok_service_plans','master_wok_booking_receipts','master_wok_time_responses',
    'master_wok_notification_outbox','master_wok_notification_deliveries']){
    await setup.query(`CREATE TABLE ${schema}.${name} (LIKE ${sourceSchema}.${name} INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)`);
    await setup.query(`ALTER TABLE ${schema}.${name} ENABLE ROW LEVEL SECURITY`);
    await setup.query(`REVOKE ALL ON ${schema}.${name} FROM PUBLIC,anon,authenticated,service_role`);
   }
   await setup.query(`INSERT INTO ${schema}.master_wok_launch_control(id,mode,approved_release_id,revision) VALUES(1,'MASTER_WOK',$1,1)`,[releaseId]);
   await setup.query(`INSERT INTO ${schema}.order_counters VALUES(1,0)`);
   await setup.query(`INSERT INTO ${schema}.service_state(id,mode,capacity_throttle) VALUES(1,'normal',0)`);
   await setup.query('COMMIT');
  }catch(e){await setup.query('ROLLBACK');throw e;}finally{setup.release();}
  const model=globalThis.MasterWokModelV1,planStore=createServicePlanStore({schema:sourceSchema});
  const readOrders=(c,d)=>readCapacityCommitments(c,d),readAvailability=(c,d)=>readBookingAvailability(c,d);
  const quoteDelivery=async({address})=>({straightLineMiles:1,routeMiles:1,customerLatitude:address==='B'?53.76:address==='C'?53.77:53.75,customerLongitude:-1.58});
  const deliveryCapacity=createDeliveryCapacity({quoteLeg:async({origin,destination})=>({durationSeconds:origin.lat===53.744437?300:destination.lat===53.744437?420:120})});
  const binding={releaseId,sourceSha256:'__RUNTIME_SOURCE_SHA256__',projectRef:'hvrqgufqjslvgiohgkvu',schema:sourceSchema};
  const certificate={schemaVersion:1,status:'CANDIDATE_FOR_STAGING',deliveryScheduling:1,...binding,modelVersion:'combined-kitchen-protected-v3',fixturePrefix:'delivery-fixture-',checks:Object.fromEntries([...REQUIRED_CHECKS,...DELIVERY_CHECKS].map(k=>[k,'PENDING']))};
  const assessors=createReleaseAssessors({...binding,certificate,model,readOrders,readAvailability,planStore,deliveryCapacity});
  const runtime=createBookingRuntime({pool,model,secret:TOKEN,releaseId,schema:sourceSchema,readOrders,readAvailability,
   validateCommercialOrder:createCommercialValidator({quoteDelivery}),deliveryCapacity,quoteDelivery,...assessors});
  async function call(operation,payload){const r=await runtime(new Request('https://fixture.invalid/',{method:'POST',headers:{'content-type':'application/json','x-master-wok-secret':TOKEN},body:JSON.stringify({operation,payload})}));return {status:r.status,body:await r.json()};}
  const items=[{item_id:'green-curry',qty:1,modifiers:[{id:'chicken'}],spice:1}];
  const input=(key,time,address='A')=>({key:'delivery-fixture-'+key,orderType:'delivery',preferredTime:date+'T'+time+':00Z',
   customer:{name:'TEST Delivery '+key,email:'delivery-'+key+'-'+RUN+'@example.invalid',phone:'07700900126',address},items,
   expectedTotals:{subtotal:9,total:11,delivery_fee:2,discount:0,loyalty_discount:0}});
  phase='BOOK_A';const a=await call('checkout',input('a','18:30'));check(a.status===200&&a.body.committed,'BOOK_A_FAILED');
  phase='REPLAY';const replay=await call('checkout',input('a','18:30'));check(replay.status===200&&replay.body.replayed&&replay.body.orderId===a.body.orderId,'REPLAY_FAILED');results.push('same-key replay');
  phase='BOOK_B';const b=await call('checkout',input('b','18:50','B'));check(b.status===200&&b.body.committed,'BOOK_B_FAILED:'+JSON.stringify(b));
  phase='BEFORE_COMBINE_HINT';const hint=()=>call('availability',{orderType:'delivery',address:'C',items,times:[date+'T18:55:00Z']});
  const before=await hint();check(before.status===200&&!before.body.hints[0].available,'UNCOMBINED_DRIVER_CONFLICT_REQUIRED');
  phase='RECOMMEND';const opts=await call('admin_action',{action:'delivery_trip_options',orderId:a.body.orderId});
  check(opts.status===200&&opts.body.recommendations.length>0,'RECOMMENDATION_REQUIRED');
  const revision=opts.body.revision;
  phase='MANUAL_PREVIEW';const command={orderId:a.body.orderId,orderIds:[a.body.orderId,b.body.orderId],expectedRevision:revision};
  const preview=await call('admin_action',{...command,action:'preview_delivery_combination'});check(preview.status===200&&!preview.body.committed,'PREVIEW_FAILED');
  phase='ATOMIC_COMBINE';const combine=await call('admin_action',{...command,action:'combine_deliveries'});check(combine.status===200&&combine.body.committed,'COMBINE_FAILED');
  phase='STALE_COMBINE';const stale=await call('admin_action',{...command,action:'combine_deliveries'});check(stale.status===409&&stale.body.reason==='DELIVERY_PLAN_CHANGED_REFRESH','STALE_REVISION_NOT_REFUSED');
  phase='SPLIT_AND_RECOMBINE';const split=await call('admin_action',{action:'split_delivery_trip',orderId:a.body.orderId,expectedRevision:combine.body.revision});
  check(split.status===200&&split.body.committed,'SPLIT_FAILED');
  const recombine=await call('admin_action',{...command,action:'combine_deliveries',expectedRevision:split.body.revision});
  check(recombine.status===200&&recombine.body.committed,'RECOMBINE_FAILED');results.push('split and recombine re-assess both resources');
  phase='AFTER_COMBINE_HINT';const after=await hint();check(after.status===200&&after.body.hints[0].available,'COMBINATION_NOT_USED_BY_SUBSEQUENT_HINT');results.push('recommendation, manual preview, atomic confirmation, stale revision, subsequent driver capacity');
  phase='CONCURRENT_BOOKINGS';const concurrent=await Promise.all([call('checkout',input('c1','18:55','C')),call('checkout',input('c2','18:55','C'))]);
  check(concurrent.filter(r=>r.status===200&&r.body.committed).length===1&&concurrent.filter(r=>r.status===409).length===1,'CONCURRENT_DRIVER_OVERBOOKING');results.push('concurrent driver conflict: exactly one booking');
  phase='PLAN_AND_RECEIPTS';const plan=(await pool.query(`SELECT plan,revision FROM ${schema}.master_wok_service_plans WHERE service_date=$1`,[date])).rows[0];
  check(plan.plan.delivery.trips.length===2&&plan.plan.delivery.trips.some(t=>t.stops.length===2),'COMBINED_TRIP_LOST');
  check(plan.plan.delivery.decisions.length===3,'ADMIN_AUDIT_LOST');
  const counts=(await pool.query(`SELECT (SELECT count(*) FROM ${schema}.orders) AS orders,(SELECT count(*) FROM ${schema}.master_wok_booking_receipts) AS receipts,(SELECT count(*) FROM ${schema}.master_wok_notification_deliveries) AS provider_deliveries`)).rows[0];
  check(Number(counts.orders)===3&&Number(counts.receipts)===3&&Number(counts.provider_deliveries)===0,'ATOMIC_COUNTS_FAILED');
  phase='CUSTOMER_TIME_PROPOSAL';const winner=concurrent.find(r=>r.status===200).body;
  const suggest=await call('admin_action',{action:'suggest_time',orderId:winner.orderId,proposedTime:date+'T20:30:00Z'});
  check(suggest.status===200,'DELIVERY_SUGGESTION_FAILED');
  const token=(await pool.query(`SELECT confirm_token FROM ${schema}.orders WHERE id=$1`,[winner.orderId])).rows[0].confirm_token;
  phase='CUSTOMER_ACKNOWLEDGEMENT';const accepted=await call('customer_response',{action:'customer_accept',orderId:winner.orderId,token});
  check(accepted.status===200&&accepted.body.committed,'DELIVERY_ACKNOWLEDGEMENT_FAILED');
  const ackReplay=await call('customer_response',{action:'customer_accept',orderId:winner.orderId,token});
  check(ackReplay.status===200&&ackReplay.body.replayed,'DELIVERY_ACK_REPLAY_FAILED');
  phase='TEST_RELEASE';const test=await call('admin_action',{action:'set_test',orderId:winner.orderId,isTest:true});
  check(test.status===200,'DELIVERY_TEST_RELEASE_FAILED');results.push('delivery proposal, acknowledgement replay and test release');
  phase='DRAIN';await pool.query(`UPDATE ${schema}.master_wok_launch_control SET mode='DRAINING',revision=revision+1 WHERE id=1`);
  const drained=await call('checkout',input('drain','20:00'));check(drained.status!==200,'DRAIN_DID_NOT_BLOCK');results.push('drain blocks new delivery bookings');
  await pool.query(`UPDATE ${schema}.master_wok_launch_control SET mode='LEGACY',revision=revision+1 WHERE id=1`);
  return Response.json({status:'PASS',scope:'ISOLATED_STAGING_POSTGRES_DRIVER_AND_KITCHEN',schema,date,results,counts,planRevision:plan.revision,
   realRouteCalls:0,providerSends:0,productionWrites:0,modeAfter:'LEGACY',limitations:['Deterministic route-duration fixtures; no hosted browser or real route/provider certification.']});
 }catch(error){return Response.json({status:'FAIL',phase,reason:error.message,schema,results},{status:500});}
 finally{try{await native.query(`UPDATE ${schema}.master_wok_launch_control SET mode='LEGACY' WHERE id=1 AND mode<>'LEGACY'`);}catch(_){}await native.end();}
});
