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
const schema='master_wok_delivery_'+RUN,sourceSchema='master_wok_rehearsal',releaseId='delivery-rehearsal-'+RUN;
const check=(yes,code)=>{if(!yes)throw Error(code);};
Deno.serve(async req=>{
 if(Deno.env.get('SUPABASE_URL')!=='https://hvrqgufqjslvgiohgkvu.supabase.co'||
  !/^[a-f0-9]{64}$/.test(TOKEN)||!/^[a-f0-9]{16}$/.test(RUN)||req.headers.get('x-master-wok-secret')!==TOKEN)return new Response('Forbidden',{status:403});
 if(!Number.isFinite(Date.parse(EXPIRES))||Date.now()>Date.parse(EXPIRES))return new Response('Expired',{status:410});
 if(req.method!=='POST')return new Response('POST required',{status:405});
 const native=new pg.Pool({connectionString:Deno.env.get('SUPABASE_DB_URL'),max:4,connectionTimeoutMillis:10000});
 const rewrite=sql=>sql.replaceAll('"master_wok_rehearsal"','"'+schema+'"').replaceAll('master_wok_rehearsal.',schema+'.')
  .replace('SELECT public.get_next_order_number() AS value',`WITH bump AS (UPDATE ${schema}.order_counters SET current_num=current_num+1 WHERE id=1 RETURNING current_num) SELECT json_build_object('assigned',current_num) AS value FROM bump`)
  .replaceAll('public.',schema+'.');
 const pool={async connect(){const c=await native.connect();return {query:(sql,args)=>c.query(rewrite(sql),args),release:()=>c.release()};},query:(sql,args)=>native.query(rewrite(sql),args)};

 try{
  const input=await req.clone().json();
  if(input.operation==='initialize_rehearsal'){
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
  return Response.json({ok:true,schema});
  }
  const model=globalThis.MasterWokModelV1,planStore=createServicePlanStore({schema:sourceSchema});
  const readOrders=(c,d)=>readCapacityCommitments(c,d),readAvailability=(c,d)=>readBookingAvailability(c,d);
  const deliveryService={supabaseUrl:'https://ubyjrrsvbbqomitpaidb.supabase.co',
   publicKey:'sb_publishable_wnLIasgPkPRUH3UnCpTMZw_hW6PHz2O'};
  const quoteDelivery=require('./master-wok-delivery-quote').createDeliveryQuoter(deliveryService);
  const quoteLeg=require('./master-wok-route-duration').createRouteDurationQuoter(deliveryService);
  const deliveryCapacity=createDeliveryCapacity({quoteLeg});
  const commercial=createCommercialValidator({quoteDelivery});
  const binding={releaseId,sourceSha256:'__RUNTIME_SOURCE_SHA256__',projectRef:'hvrqgufqjslvgiohgkvu',schema:sourceSchema};
  const certificate={schemaVersion:1,status:'CANDIDATE_FOR_STAGING',deliveryScheduling:1,...binding,modelVersion:'combined-kitchen-protected-v3',fixturePrefix:'delivery-fixture-',checks:Object.fromEntries([...REQUIRED_CHECKS,...DELIVERY_CHECKS].map(k=>[k,'PENDING']))};
  const assessors=createReleaseAssessors({...binding,certificate,model,readOrders,readAvailability,planStore,deliveryCapacity});
  const runtime=createBookingRuntime({pool,model,secret:TOKEN,releaseId,schema:sourceSchema,readOrders,readAvailability,
   validateCommercialOrder:(c,input,state)=>{
    check(input.key?.startsWith('delivery-fixture-')&&input.customer?.email?.endsWith('@example.invalid'),'FIXTURE_ONLY');
    return commercial(c,input,state);
   },readPreviewOrders:async()=>{
    const {rows}=await pool.query(`SELECT to_jsonb(o) || jsonb_build_object('customers',to_jsonb(c),'order_items',
     (SELECT coalesce(jsonb_agg(i),'[]'::jsonb) FROM ${schema}.order_items i WHERE i.order_id=o.id)) AS item
     FROM ${schema}.orders o JOIN ${schema}.customers c ON c.id=o.customer_id
     WHERE o.idempotency_key LIKE 'delivery-fixture-%' AND o.is_test=false ORDER BY o.created_at DESC LIMIT 20`);
    return {success:true,notification_managed:true,orders:rows.map(row=>row.item)};
   },deliveryCapacity,quoteDelivery,...assessors});
  return await runtime(req);
 }catch(error){return Response.json({error:'STAGING_RUNTIME_FAILED'},{status:503});}
 finally{await native.end();}
});
