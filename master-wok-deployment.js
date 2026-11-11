'use strict';
const {createBookingRuntime}=require('./master-wok-runtime');
const {createReleaseAssessors}=require('./master-wok-release-assessors');
const {readCapacityCommitments}=require('./master-wok-commitment-reader');
const {readBookingAvailability}=require('./master-wok-availability-reader');
const {createServicePlanStore}=require('./master-wok-service-plan-store');
const {RING_MODEL_VERSION}=require('./master-wok-protected-plan');
function createDeploymentRuntime({pool,model,certificate,sourceSha256,releaseId,projectRef,
 secret,notificationSecret,deliveryPublicKey,deliveryProjectRef=projectRef,reviewApprovalsEnabled=false}={}){
 if(typeof secret!=='string'||secret.length<32||typeof notificationSecret!=='string'||
  notificationSecret.length<32||secret===notificationSecret)throw Error('DISTINCT_SERVER_SECRETS_REQUIRED');
 const schema=projectRef==='hvrqgufqjslvgiohgkvu'?'master_wok_rehearsal':'public';
 if(deliveryProjectRef!==projectRef&&!(schema==='master_wok_rehearsal'&&deliveryProjectRef==='ubyjrrsvbbqomitpaidb'))
  throw Error('DELIVERY_PROJECT_NOT_ALLOWED');
 if(certificate?.deliveryProjectRef!==deliveryProjectRef)throw Error('DELIVERY_PROJECT_NOT_CERTIFIED');
 // Only fixed internal table names are rewritten for private staging. Production
 // uses the existing public readers unchanged; requests never select a schema.
 const connection=c=>schema==='public'?c:{query:(sql,args)=>c.query(sql
  .replaceAll('public.orders',schema+'.orders').replaceAll('public.order_items',schema+'.order_items')
  .replaceAll('public.service_state',schema+'.service_state').replaceAll('public.booking_blackouts',schema+'.booking_blackouts'),args)};
 const readOrders=(c,d)=>readCapacityCommitments(connection(c),d);
 const readAvailability=(c,d)=>readBookingAvailability(connection(c),d);
 const planStore=createServicePlanStore({schema});
 const deliveryService={supabaseUrl:'https://'+deliveryProjectRef+'.supabase.co',publicKey:deliveryPublicKey};
 // Hardware selection is certificate-bound. Candidate certificates remain
 // private staging only; certified deployment requires every release check.
 // The historical model identifier is retained to avoid relabelling plans.
 const stagingSharedRings=certificate.modelVersion===RING_MODEL_VERSION&&
  certificate.kitchenConfiguration==='FOUR_RING_ONE_PORTION_V1';
 const deliveryCapacity=certificate.deliveryScheduling===1?
  require('./master-wok-delivery-capacity').createDeliveryCapacity({stagingSharedRings,quoteLeg:require('./master-wok-route-duration').createRouteDurationQuoter(deliveryService)}):undefined;
 const quoteDelivery=require('./master-wok-delivery-quote').createDeliveryQuoter(deliveryService);
 const assessors=createReleaseAssessors({certificate,releaseId,sourceSha256,projectRef,schema,model,readOrders,readAvailability,planStore,deliveryCapacity});
 // Staging commercial tables and counter are private as well.
 const {createCommercialValidator}=require('./master-wok-commercial-validator');
 const commercial=createCommercialValidator({quoteDelivery});
 const commercialConnection=c=>schema==='public'?c:{query:(sql,args)=>connection(c).query(sql
  .replaceAll('public.customers',schema+'.customers').replaceAll('public.loyalty_accounts',schema+'.loyalty_accounts')
  .replaceAll('public.discount_codes',schema+'.discount_codes')
  .replace('SELECT public.get_next_order_number() AS value',`WITH bump AS (UPDATE ${schema}.order_counters SET current_num=current_num+1 WHERE id=1 RETURNING current_num) SELECT json_build_object('assigned',current_num) AS value FROM bump`),args)};
 return createBookingRuntime({pool,model,reviewApprovalsEnabled,deliveryCapacity,quoteDelivery:deliveryCapacity?quoteDelivery:undefined,secret,notificationSecret,releaseId,schema,readOrders,readAvailability,
  notificationOrderKeyPrefix:certificate.status==='CANDIDATE_FOR_STAGING'?certificate.fixturePrefix:undefined,
  readPreviewOrders:certificate.status==='CANDIDATE_FOR_STAGING'?async()=>{
   const r=await pool.query(`SELECT to_jsonb(o)||jsonb_build_object('customers',to_jsonb(c),
    'order_items',(SELECT coalesce(jsonb_agg(i),'[]'::jsonb) FROM ${schema}.order_items i WHERE i.order_id=o.id)) AS item
    FROM ${schema}.orders o LEFT JOIN ${schema}.customers c ON c.id=o.customer_id
    WHERE o.idempotency_key LIKE $1 AND o.is_test=false ORDER BY o.created_at DESC LIMIT 20`,[certificate.fixturePrefix+'%']);
   return {success:true,notification_managed:true,orders:r.rows.map(row=>row.item)};
  }:undefined,
  validateCommercialOrder:(c,input,state)=>{
   if(certificate.status==='CANDIDATE_FOR_STAGING'){
    if(!input.key?.startsWith(certificate.fixturePrefix))throw Error('PRIVATE_FIXTURE_KEY_REQUIRED');
    if(!input.customer?.email?.endsWith('@example.invalid'))throw Error('PRIVATE_FIXTURE_EMAIL_REQUIRED');
   }
   return commercial(commercialConnection(c),input,state);
  },...assessors});
}
module.exports={createDeploymentRuntime};
