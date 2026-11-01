// Temporary browser/database bridge. Only the fixed private rehearsal schema,
// generated example.invalid customer, collection baskets and this run's keys
// are allowed. No notification provider is called and no live booking authority.
import pg from 'npm:pg@8.23.1';
const {Pool}=pg;
const {beginBookingTransaction}=require('./master-wok-transaction-writer');
const {createBookingRuntime}=require('./master-wok-runtime');
const {createMutationAssessment}=require('./master-wok-mutation-assessment');
const {createOrderStore}=require('./master-wok-order-store');
const {createServicePlanStore}=require('./master-wok-service-plan-store');
const {catalog}=require('./master-wok-commercial');
const {createCommercialValidator}=require('./master-wok-commercial-validator');
const {readCapacityCommitments}=require('./master-wok-commitment-reader');
const {readBookingAvailability}=require('./master-wok-availability-reader');
const {assessCombinedBooking}=require('./master-wok-combined-assessment');
const {createLaunchControl}=require('./master-wok-launch-control');
require('./master-wok-model-bundle');
const TOKEN='__CERTIFICATION_TOKEN__',RUN='__BROWSER_RUN__',EMAIL='browser-'+RUN+'@example.invalid';
const EXPIRES='__BROWSER_EXPIRES__';
const schema='master_wok_rehearsal',prefix='browser-'+RUN+'-';
Deno.serve(async req=>{
 if(!/^[a-f0-9]{64}$/.test(TOKEN)||!/^[a-f0-9]{16}$/.test(RUN))return new Response('Unbuilt staging fixture',{status:403});
 if(req.headers.get('authorization')!=='Bearer '+TOKEN&&req.headers.get('x-master-wok-secret')!==TOKEN)return new Response('Forbidden',{status:403});
 if(Deno.env.get('SUPABASE_URL')!=='https://hvrqgufqjslvgiohgkvu.supabase.co')return new Response('Staging required',{status:403});
 if(!Number.isFinite(Date.parse(EXPIRES))||Date.now()>Date.parse(EXPIRES))return new Response('Staging rehearsal expired',{status:410});
 if(req.method!=='POST')return new Response('POST required',{status:405});
 const pool=new Pool({connectionString:Deno.env.get('SUPABASE_DB_URL'),max:2,connectionTimeoutMillis:10000});
 const rewrite=c=>({query:(sql,args)=>c.query(sql
  .replaceAll('public.orders',schema+'.orders').replaceAll('public.order_items',schema+'.order_items')
  .replaceAll('public.customers',schema+'.customers').replaceAll('public.loyalty_accounts',schema+'.loyalty_accounts')
  .replaceAll('public.discount_codes',schema+'.discount_codes').replaceAll('public.service_state',schema+'.service_state')
  .replaceAll('public.booking_blackouts',schema+'.booking_blackouts')
  .replace('SELECT public.get_next_order_number() AS value',`WITH bump AS (UPDATE ${schema}.order_counters SET current_num=current_num+1 WHERE id=1 RETURNING current_num) SELECT json_build_object('assigned',current_num) AS value FROM bump`),args)});
 try{
  const envelope=await req.json();
  const gate=createLaunchControl({schema,releaseId:'private-browser-'+RUN});
  if(envelope.operation==='mode')return Response.json({mode:(await gate.read(pool)).mode},{headers:{'Cache-Control':'no-store'}});
  const isAvailability=envelope.operation==='availability',isLifecycle=['admin_action','customer_response'].includes(envelope.operation);
  const input=['checkout','availability','admin_action','customer_response'].includes(envelope.operation)?envelope.payload:envelope;
  if(!input||typeof input!=='object')return new Response('Fixture required',{status:400});
  if(input.operation==='cleanup'){
   const c=await pool.connect();
   try{
   await beginBookingTransaction(c);await gate.assertWriteAllowed(c);
   const dates=(await c.query(`SELECT service_date::text FROM ${schema}.master_wok_booking_receipts WHERE key LIKE $1`,[prefix+'%'])).rows.map(r=>r.service_date);
   await c.query(`DELETE FROM ${schema}.master_wok_time_responses WHERE order_id IN(SELECT id FROM ${schema}.orders WHERE idempotency_key LIKE $1)`,[prefix+'%']);
   await c.query(`DELETE FROM ${schema}.master_wok_booking_receipts WHERE key LIKE $1`,[prefix+'%']);
   await c.query(`DELETE FROM ${schema}.orders WHERE idempotency_key LIKE $1`,[prefix+'%']);
   await c.query(`DELETE FROM ${schema}.customers c WHERE email=$1 AND NOT EXISTS(SELECT 1 FROM ${schema}.orders o WHERE o.customer_id=c.id)`,[EMAIL]);
   for(const date of dates)await c.query(`DELETE FROM ${schema}.master_wok_service_plans WHERE service_date=$1 AND NOT EXISTS(SELECT 1 FROM ${schema}.orders WHERE (coalesce(confirmed_time,proposed_time,preferred_time) AT TIME ZONE 'Europe/London')::date=$1::date)`,[date]);
   await c.query(`DELETE FROM ${schema}.master_wok_launch_control WHERE approved_release_id=$1`,['private-browser-'+RUN]);
   await c.query('COMMIT');
   return Response.json({success:true,scope:'PRIVATE_STAGING_BROWSER_FIXTURE_CLEANUP'});
   }catch(error){try{await c.query('ROLLBACK');}catch(_){}throw error;}finally{c.release();}
  }
  if(envelope.operation==='admin_action'&&input.action==='preview_list_orders'){
   if((await gate.read(pool)).mode!=='MASTER_WOK')return new Response('Staging admin disabled',{status:503});
   const result=await pool.query(`SELECT to_jsonb(o)||jsonb_build_object('customers',to_jsonb(c),
    'order_items',(SELECT coalesce(jsonb_agg(i),'[]'::jsonb) FROM ${schema}.order_items i WHERE i.order_id=o.id)) AS item
    FROM ${schema}.orders o JOIN ${schema}.customers c ON c.id=o.customer_id
    WHERE o.idempotency_key LIKE $1 AND c.email=$2 AND NOT o.is_test ORDER BY o.created_at DESC LIMIT 20`,[prefix+'%',EMAIL]);
   return Response.json({success:true,notification_managed:true,orders:result.rows.map(r=>r.item)});
  }
  if(isLifecycle){
   if(!/^[a-f0-9-]{36}$/i.test(input.orderId||''))return new Response('Fixture only',{status:400});
   const own=(await pool.query(`SELECT o.id FROM ${schema}.orders o JOIN ${schema}.customers c ON c.id=o.customer_id
    WHERE o.id=$1 AND o.idempotency_key LIKE $2 AND c.email=$3`,[input.orderId,prefix+'%',EMAIL])).rows[0];
   if(!own)return new Response('Fixture only',{status:403});
  }else if(!Array.isArray(input.items)||input.items.length>8||
   input.items.some(i=>!catalog.items.some(item=>item.id===i.item_id)||!Number.isInteger(i.qty)||i.qty<1||i.qty>2)||
   (!isAvailability&&(input.orderType!=='collection'||input.customer?.email!==EMAIL||typeof input.key!=='string'||input.key.length>64)))return new Response('Fixture only',{status:400});
  const fixtureAssessment=context=>{
   const tested=assessCombinedBooking(context);
   // Confined fixture authorization, never a production certification.
   return tested.status==='VALIDATED_COMBINED_ASSESSMENT'?{...tested,status:'GREEN',bookingApprovalAllowed:true}:tested;
  };
  const readOrders=(c,d)=>readCapacityCommitments(rewrite(c),d);
  const readAvailability=(c,d)=>readBookingAvailability(rewrite(c),d);
  const planStore=createServicePlanStore({schema});
  const mutation=createMutationAssessment({model:globalThis.MasterWokModelV1,readOrders,readAvailability,planStore});
  const commercial=createCommercialValidator();
  const handler=createBookingRuntime({pool,model:globalThis.MasterWokModelV1,secret:TOKEN,
   releaseId:'private-browser-'+RUN,schema,readOrders,readAvailability,
   validateCommercialOrder:(c,i,state)=>commercial(rewrite(c),i,state),assessBooking:fixtureAssessment,
   assessMutation:async context=>{const result=await mutation(context);
    return result.status==='VALIDATED_LIFECYCLE_ASSESSMENT'?{...result,status:'GREEN',bookingApprovalAllowed:true}:result;}});
  // Reuse the exact application runtime; only the private fixture boundary above
  // can authorize these test assessments. No production bootstrap is enabled.
  const operation=isLifecycle?envelope.operation:isAvailability?'availability':'checkout';
  return await handler(new Request(req.url,{method:'POST',headers:{'content-type':'application/json','x-master-wok-secret':TOKEN},
   body:JSON.stringify({operation,payload:isLifecycle||isAvailability?input:{...input,key:prefix+input.key}})}));
 }catch(_){return Response.json({success:false,reason:'STAGING_BRIDGE_FAILURE'},{status:503});}
 finally{await pool.end();}
});
