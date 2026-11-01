// Temporary browser/database bridge. Only the fixed private rehearsal schema,
// generated example.invalid customer, collection baskets and this run's keys
// are allowed. No notification provider is called and no live booking authority.
import pg from 'npm:pg@8.23.1';
const {Pool}=pg;
const {createAtomicCheckout}=require('./master-wok-atomic-checkout');
const {createOrderStore}=require('./master-wok-order-store');
const {createServicePlanStore}=require('./master-wok-service-plan-store');
const {createCommercialValidator}=require('./master-wok-commercial-validator');
const {readCapacityCommitments}=require('./master-wok-commitment-reader');
const {readBookingAvailability}=require('./master-wok-availability-reader');
const {assessCombinedBooking}=require('./master-wok-combined-assessment');
require('./master-wok-model-bundle');
const TOKEN='__CERTIFICATION_TOKEN__',RUN='__BROWSER_RUN__',EMAIL='browser-'+RUN+'@example.invalid';
const schema='master_wok_rehearsal',prefix='browser-'+RUN+'-';
Deno.serve(async req=>{
 if(!/^[a-f0-9]{64}$/.test(TOKEN)||!/^[a-f0-9]{16}$/.test(RUN))return new Response('Unbuilt staging fixture',{status:403});
 if(req.headers.get('authorization')!=='Bearer '+TOKEN)return new Response('Forbidden',{status:403});
 if(Deno.env.get('SUPABASE_URL')!=='https://hvrqgufqjslvgiohgkvu.supabase.co')return new Response('Staging required',{status:403});
 if(req.method!=='POST')return new Response('POST required',{status:405});
 const pool=new Pool({connectionString:Deno.env.get('SUPABASE_DB_URL'),max:2,connectionTimeoutMillis:10000});
 const rewrite=c=>({query:(sql,args)=>c.query(sql
  .replaceAll('public.orders',schema+'.orders').replaceAll('public.order_items',schema+'.order_items')
  .replaceAll('public.customers',schema+'.customers').replaceAll('public.loyalty_accounts',schema+'.loyalty_accounts')
  .replaceAll('public.discount_codes',schema+'.discount_codes').replaceAll('public.service_state',schema+'.service_state')
  .replaceAll('public.booking_blackouts',schema+'.booking_blackouts')
  .replace('SELECT public.get_next_order_number() AS value',`WITH bump AS (UPDATE ${schema}.order_counters SET current_num=current_num+1 WHERE id=1 RETURNING current_num) SELECT json_build_object('assigned',current_num) AS value FROM bump`),args)});
 try{
  const input=await req.json();
  if(input.operation==='cleanup'){
   const dates=(await pool.query(`SELECT service_date::text FROM ${schema}.master_wok_booking_receipts WHERE key LIKE $1`,[prefix+'%'])).rows.map(r=>r.service_date);
   await pool.query(`DELETE FROM ${schema}.master_wok_time_responses WHERE order_id IN(SELECT id FROM ${schema}.orders WHERE idempotency_key LIKE $1)`,[prefix+'%']);
   await pool.query(`DELETE FROM ${schema}.master_wok_booking_receipts WHERE key LIKE $1`,[prefix+'%']);
   await pool.query(`DELETE FROM ${schema}.orders WHERE idempotency_key LIKE $1`,[prefix+'%']);
   await pool.query(`DELETE FROM ${schema}.customers c WHERE email=$1 AND NOT EXISTS(SELECT 1 FROM ${schema}.orders o WHERE o.customer_id=c.id)`,[EMAIL]);
   for(const date of dates)await pool.query(`DELETE FROM ${schema}.master_wok_service_plans WHERE service_date=$1 AND NOT EXISTS(SELECT 1 FROM ${schema}.orders WHERE (coalesce(confirmed_time,proposed_time,preferred_time) AT TIME ZONE 'Europe/London')::date=$1::date)`,[date]);
   return Response.json({success:true,scope:'PRIVATE_STAGING_BROWSER_FIXTURE_CLEANUP'});
  }
  if(input.orderType!=='collection'||input.customer?.email!==EMAIL||!Array.isArray(input.items)||
   input.items.length>3||input.items.some(i=>!['green-curry','panang-curry','stir-crispy','pad-thai'].includes(i.item_id)||i.qty>2)||
   typeof input.key!=='string'||input.key.length>64)return new Response('Fixture only',{status:400});
  const commercial=createCommercialValidator();
  const checkout=createAtomicCheckout({pool,model:globalThis.MasterWokModelV1,mode:'MASTER_WOK',
   store:createOrderStore({schema}),planStore:createServicePlanStore({schema}),
   readOrders:(c,d)=>readCapacityCommitments(rewrite(c),d),
   readAvailability:(c,d)=>readBookingAvailability(rewrite(c),d),
   validateCommercialOrder:(c,i,state)=>commercial(rewrite(c),i,state),
   assessBooking:context=>{
    const tested=assessCombinedBooking(context);
    // Explicitly confined staging fixture authorization, never production.
    return tested.status==='VALIDATED_COMBINED_ASSESSMENT'?{...tested,status:'GREEN',bookingApprovalAllowed:true}:tested;
   }});
  const result=await checkout({...input,key:prefix+input.key});
  const success=result.status==='GREEN'&&(result.committed||result.reason==='REPLAY');
  return Response.json(success?{success:true,...result.response}:{success:false,...result},
   {status:success?200:result.reason==='REVIEW_REQUIRED'||result.reason==='CHECKOUT_PRICE_CHANGED'?409:503});
 }catch(_){return Response.json({success:false,reason:'STAGING_BRIDGE_FAILURE'},{status:503});}
 finally{await pool.end();}
});
