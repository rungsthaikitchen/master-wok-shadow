// Fixed, expiring staging rehearsal. Every write remains inside one outer
// transaction and is rolled back; no outbox row is visible to a worker.
import pg from 'npm:pg@8.23.1';
require('./master-wok-model-bundle');
// Fixed trusted routing fixtures; no geocoding or provider calls occur.
require('./master-wok-delivery-quote').createDeliveryQuoter=()=>async()=>({straightLineMiles:1,routeMiles:2,customerLatitude:53.752,customerLongitude:-1.58});
require('./master-wok-route-duration').createRouteDurationQuoter=()=>async()=>({durationSeconds:480});
const {createDeploymentRuntime}=require('./master-wok-deployment');
const pairedFixture=require('./staging-tests/current-overlap-replay-20261118.json');
const certificate=require('./master-wok-release-candidate.staging.json');
const {priceBasket}=require('./master-wok-commercial');
const TOKEN_HASH='__CERTIFICATION_TOKEN__',EXPIRES='__BROWSER_EXPIRES__';
const settings=__PRIVATE_CONFIGURATION__;
Deno.serve(async request=>{
 const reply=(x,status=200)=>Response.json(x,{status,headers:{'Cache-Control':'no-store'}});
 if(request.method!=='POST'||Deno.env.get('SUPABASE_URL')!=='https://hvrqgufqjslvgiohgkvu.supabase.co'||Date.now()>Date.parse(EXPIRES))return reply({error:'DISABLED'},403);
 const token=request.headers.get('x-rehearsal-token')||'';
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),b=>b.toString(16).padStart(2,'0')).join('');
 if(!/^[a-f0-9]{64}$/.test(token)||digest!==TOKEN_HASH)return reply({error:'UNAUTHORIZED'},401);
 const pool=new pg.Pool({connectionString:Deno.env.get('SUPABASE_DB_URL'),max:1,connectionTimeoutMillis:10000});let c;
 const checks=[],date='2026-12-12',key=certificate.fixturePrefix+'advisory-'+crypto.randomUUID();let orderId;
 const check=(ok,name)=>{if(!ok)throw Error(name);checks.push(name);};
 try{
  c=await pool.connect();
  check(!(await c.query('SELECT service_date FROM master_wok_rehearsal.master_wok_service_plans WHERE service_date=$1',[date])).rows.length,'empty_fixture_date');
  await c.query('BEGIN');let serial=0,savepoint=null;
  const held={release(){},query:async(sql,args)=>{
   if(/^BEGIN\b/.test(sql)){savepoint='advisory_'+(++serial);return c.query('SAVEPOINT '+savepoint);}
   if(/^SET TRANSACTION/.test(sql))return {rows:[]};
   if(sql==='COMMIT'){const s=savepoint;savepoint=null;return c.query('RELEASE SAVEPOINT '+s);}
   if(sql==='ROLLBACK'){if(!savepoint)return {rows:[]};const s=savepoint;savepoint=null;await c.query('ROLLBACK TO SAVEPOINT '+s);return c.query('RELEASE SAVEPOINT '+s);}
   return c.query(sql,args);
  }};
  const transport=createDeploymentRuntime({pool:{connect:async()=>held,query:(sql,args)=>c.query(sql,args)},model:globalThis.MasterWokModelV1,certificate,sourceSha256:certificate.sourceSha256,projectRef:'hvrqgufqjslvgiohgkvu',schema:'master_wok_rehearsal',releaseId:settings.MASTER_WOK_RELEASE_ID,secret:settings.MASTER_WOK_BOOKING_SECRET,notificationSecret:settings.MASTER_WOK_NOTIFICATION_SECRET,deliveryProjectRef:settings.MASTER_WOK_DELIVERY_PROJECT_REF,deliveryPublicKey:settings.MASTER_WOK_DELIVERY_PUBLIC_KEY,paymentsEnabled:true,reviewApprovalsEnabled:true});
  async function call(operation,payload){const r=await transport(new Request('https://private.invalid/',{method:'POST',headers:{'Content-Type':'application/json','x-master-wok-secret':settings.MASTER_WOK_BOOKING_SECRET},body:JSON.stringify({operation,payload})}));return {status:r.status,body:await r.json()};}
  const items=pairedFixture.orders[0].items,total=priceBasket(items).subtotalCents/100;
  const customer={name:'Private paired checkout rehearsal',email:key+'@example.invalid',phone:'07700900'+String(Math.floor(Math.random()*1000)).padStart(3,'0'),address:'Fixed synthetic routing fixture'};
  const baseRequest={key:key+'-base',customer,preferredTime:date+'T20:00:00Z',orderType:'collection',items,communicationPreference:'email',paymentPreference:'on_arrival',expectedTotals:{subtotal:total,total,delivery_fee:0,discount:0,loyalty_discount:0}};
  const base=await call('checkout',baseRequest);check(base.status===200&&base.body.success,'first_collection_reserved');
  const checkout={key,customer,preferredTime:date+'T20:00:00Z',orderType:'delivery',items,communicationPreference:'email',paymentPreference:'on_arrival',expectedTotals:{subtotal:total,total,delivery_fee:0,discount:0,loyalty_discount:0}};
  const booked=await call('checkout',checkout);check(booked.status===200&&booked.body.success,'pending_checkout');orderId=booked.body.orderId;
  check(booked.body.holdingReviewRequired===true,'customer_received_pending_review');
  const again=await call('checkout',checkout);check(again.body.orderId===orderId&&again.body.holdingReviewRequired===true,'idempotent_pending_receipt');
  const read=await call('payments',{action:'holding_list',orderIds:[orderId],staffActor:'staff@example.invalid'});
  check(read.status===200&&read.body.holding[0].warnings.length>0,'admin_warning_visible');const row=read.body.holding[0];
  check(row.warnings[0].estimatedMinutes>20&&row.warnings[0].dishes[0].name,'affected_dishes_and_estimate');
  const refused=await call('admin_action',{action:'accept',orderId});check(refused.status===409&&refused.body.reason==='EXTENDED_HOLDING_REVIEW_REQUIRED','old_accept_cannot_bypass');
  const stale=await call('payments',{action:'holding_accept',orderId,holdingWarningToken:'stale',staffActor:'staff@example.invalid'});check(stale.status===409,'stale_warning_refused');
  const pending=(await c.query('SELECT status FROM master_wok_rehearsal.orders WHERE id=$1',[orderId])).rows[0];check(pending.status==='pending','refused_accept_rolled_back');
  const accepted=await call('payments',{action:'holding_accept',orderId,holdingWarningToken:row.warningToken,staffActor:'staff@example.invalid'});check(accepted.status===200&&accepted.body.success,'staff_accept_committed_to_savepoint');
  const reviewed=await call('payments',{action:'holding_list',orderIds:[orderId],staffActor:'staff@example.invalid'});check(reviewed.body.holding[0].warnings.every(w=>w.acknowledgement?.staffActor==='staff@example.invalid'),'staff_acknowledgement_audited');
  const duplicate=await call('payments',{action:'holding_accept',orderId,holdingWarningToken:row.warningToken,staffActor:'staff@example.invalid'});check(duplicate.status===200,'accept_retry_safe');
  const completed=await call('admin_action',{action:'complete',orderId});check(completed.status===200&&completed.body.success,'capacity_neutral_completion');
  const notices=(await c.query('SELECT event_type FROM master_wok_rehearsal.master_wok_notification_outbox WHERE order_id=$1',[orderId])).rows;
  check(notices.length===2,'one_creation_and_one_confirmation_event');
  await c.query('ROLLBACK');
  check(!(await c.query('SELECT id FROM master_wok_rehearsal.orders WHERE id=$1',[orderId])).rows.length,'no_order_persisted');
  check(!(await c.query('SELECT id FROM master_wok_rehearsal.orders WHERE id=$1',[base.body.orderId])).rows.length,'no_first_order_persisted');
  check(!(await c.query('SELECT service_date FROM master_wok_rehearsal.master_wok_service_plans WHERE service_date=$1',[date])).rows.length,'no_plan_persisted');
  check(!(await c.query('SELECT order_id FROM master_wok_rehearsal.master_wok_notification_outbox WHERE order_id=$1',[orderId])).rows.length,'no_notification_persisted');
  return reply({success:true,checks,estimatedMinutes:row.warnings[0].estimatedMinutes,notificationsSent:0,persistentOrders:0});
 }catch(error){return reply({success:false,checks,error:error.message},500);}
 finally{if(c){try{await c.query('ROLLBACK');}catch(_){}c.release();}await pool.end();}
});
