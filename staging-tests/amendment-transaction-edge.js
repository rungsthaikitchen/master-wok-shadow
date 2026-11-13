// Private staging only. Synthetic fixtures and no notification providers.
import pg from 'npm:pg@8.23.1';
const {createAmendmentWriter}=require('./master-wok-amendments');
const {createMutationAssessment}=require('./master-wok-mutation-assessment');
const {createDeliveryCapacity}=require('./master-wok-delivery-capacity');
const {createServicePlanStore}=require('./master-wok-service-plan-store');
const {readCapacityCommitments}=require('./master-wok-commitment-reader');
const {readBookingAvailability}=require('./master-wok-availability-reader');
const {beginBookingTransaction}=require('./master-wok-transaction-writer');
require('./master-wok-model-bundle');
const token='__TOKEN__',expires=__EXPIRES__;
const pool=new pg.Pool({connectionString:Deno.env.get('SUPABASE_DB_URL'),max:4});
Deno.serve(async req=>{
 if(Deno.env.get('SUPABASE_URL')!=='https://hvrqgufqjslvgiohgkvu.supabase.co'||Date.now()>expires||req.headers.get('x-amendment-certification')!==token)return Response.json({error:'Unavailable'},{status:403});
 if(req.method!=='POST')return Response.json({error:'Method'},{status:405});
 const schema='master_wok_rehearsal',ids=Array.from({length:4},()=>crypto.randomUUID()),run=crypto.randomUUID().slice(0,8),code=('AMEND-'+run).toUpperCase(),date='2027-02-11',checks=[];
 const assert=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
 const quote={straightLineMiles:1,routeMiles:2,customerLatitude:53.74,customerLongitude:-1.57};
 const rewrite=c=>({query:(sql,args)=>c.query(sql.replaceAll('public.orders',schema+'.orders').replaceAll('public.order_items',schema+'.order_items').replaceAll('public.service_state',schema+'.service_state').replaceAll('public.booking_blackouts',schema+'.booking_blackouts'),args)});
 const gate=async c=>{if((await c.query(`SELECT mode FROM ${schema}.master_wok_launch_control WHERE id=1`)).rows[0]?.mode!=='MASTER_WOK')throw Error('STAGING_NOT_READY');};
 const planStore=createServicePlanStore({schema});
 const mutation=createMutationAssessment({model:globalThis.MasterWokModelV1,readOrders:(c,d)=>readCapacityCommitments(rewrite(c),d),readAvailability:(c,d)=>readBookingAvailability(rewrite(c),d),planStore,stagingSharedRings:true,deliveryCapacity:createDeliveryCapacity({stagingSharedRings:true,quoteLeg:async()=>({durationSeconds:300})})});
 const assessMutation=async c=>{const r=await mutation(c);return r.status==='VALIDATED_LIFECYCLE_ASSESSMENT'?{...r,status:'GREEN',bookingApprovalAllowed:true}:r;};
 const diagnosticPool={connect:async()=>{const c=await pool.connect();return {query:async(sql,args)=>{try{return await c.query(sql,args);}catch(e){console.error(JSON.stringify({event:'AMENDMENT_FIXTURE_SQL_FAILURE',code:e.code,message:e.message}));throw e;}},release:()=>c.release()};}};
 const options={pool:diagnosticPool,schema,assertWriteAllowed:gate,quoteDelivery:async()=>quote,assessMutation,planStore};
 const writer=createAmendmentWriter(options),staffActor='amendment-test@example.invalid';
 const read=id=>writer({action:'amend_read',orderId:id,staffActor});
 const input=(id,version,changes)=>({action:'amend_preview',orderId:id,staffActor,expectedVersion:version,changes});
 const save=(i,p,key=crypto.randomUUID())=>({...i,action:'amend_save',expectedPreview:p.preview,reason:'Synthetic amendment check',idempotencyKey:key});
 const delivery={orderType:'delivery',deliveryAddress:'Synthetic staging address',deliveryFee:'3.00',discountCode:code};
 let result;
 try{
  const setup=await pool.connect();try{await beginBookingTransaction(setup,{key:'amend-fixtures'});await gate(setup);
   assert(!(await setup.query(`SELECT id FROM ${schema}.orders WHERE (coalesce(confirmed_time,preferred_time) AT TIME ZONE 'Europe/London')::date=$1::date`,[date])).rows.length,'isolated_schedule_date');
   assert(!(await setup.query(`SELECT service_date FROM ${schema}.master_wok_service_plans WHERE service_date=$1`,[date])).rows.length,'isolated_schedule_plan');
   await setup.query(`INSERT INTO ${schema}.discount_codes(code,active,discount_type,discount_value,used_count) VALUES($1,true,'percent',10,0)`,[code]);
   for(let n=0;n<ids.length;n++){
    await setup.query(`INSERT INTO ${schema}.orders(id,status,total,subtotal,discount,discount_amount,loyalty_discount,delivery_fee,order_type,delivery_address,customer_lat,customer_lng,delivery_straight_line_miles,delivery_route_miles,loyalty_points_earned_pending,loyalty_expected_balance,paid,is_test,idempotency_key,capacity_scheduler,preferred_time) VALUES($1,'confirmed',25.5,22.5,0,0,0,3,'delivery','Synthetic staging address',53.74,-1.57,1,2,22,35,false,false,$2,'MASTER_WOK',$3)`,[ids[n],'amendment-certification-'+run+'-'+n,n===1?date+'T19:00:00Z':'2027-02-12T19:00:00Z']);
    if(n===1)await setup.query(`INSERT INTO ${schema}.order_items(order_id,item_id,name,unit_price,qty,modifiers,spice) VALUES($1,'stir-pepper','Synthetic black pepper',9,1,'[{"id":"chicken","name":"Chicken","delta":0}]'::jsonb,0)`,[ids[n]]);
   }await setup.query('COMMIT');}catch(e){await setup.query('ROLLBACK');throw e;}finally{setup.release();}
  const r=await read(ids[0]),i=input(ids[0],r.version,delivery),p=await writer(i);assert(p.success&&Number(p.after.total)===23.25,'discount_preview_recalculates_'+(p.reason||p.after?.total));
  assert(Number((await pool.query(`SELECT total FROM ${schema}.orders WHERE id=$1`,[ids[0]])).rows[0].total)===25.5,'preview_rolls_back');
  const request=save(i,p),s=await writer(request);assert(s.success&&s.committed,'discount_and_audit_commit');
  assert((await writer(request)).replayed,'identical_retry_once');
  assert((await writer({...request,reason:'Changed retry'})).reason==='AMENDMENT_IDEMPOTENCY_CONFLICT','changed_retry_refused');
  assert((await writer(i)).reason==='AMENDMENT_ORDER_CHANGED_REFRESH','stale_editor_refused');
  assert(Number((await pool.query(`SELECT used_count FROM ${schema}.discount_codes WHERE code=$1`,[code])).rows[0].used_count)===1,'discount_counter_increment_once');
  const r2=await read(ids[0]),i2=input(ids[0],r2.version,{...delivery,discountCode:''}),p2=await writer(i2);assert((await writer(save(i2,p2))).success,'discount_removal');
  assert(Number((await pool.query(`SELECT used_count FROM ${schema}.discount_codes WHERE code=$1`,[code])).rows[0].used_count)===0,'discount_counter_released');
  const rr=await read(ids[2]),ri=input(ids[2],rr.version,{...delivery,discountCode:'',deliveryFee:'0.00'}),rp=await writer(ri);
  const race=await Promise.all([writer(save(ri,rp)),writer(save(ri,rp))]);assert(race.filter(x=>x.success).length===1&&race.filter(x=>x.reason==='AMENDMENT_ORDER_CHANGED_REFRESH').length===1,'concurrent_edits_one_commit');
  const failPool={connect:async()=>{const c=await pool.connect();return {query:(sql,args)=>{if(sql.startsWith('INSERT INTO')&&sql.includes('.order_amendments('))throw Error('INJECTED_AUDIT_FAILURE');return c.query(sql,args);},release:()=>c.release()};}};
  const rf=await read(ids[3]),fi=input(ids[3],rf.version,{...delivery,discountCode:'',deliveryFee:'0.00'}),fp=await writer(fi);
  assert(!(await createAmendmentWriter({...options,pool:failPool})(save(fi,fp))).success,'late_audit_failure_refused');
  const fs=(await pool.query(`SELECT total,(SELECT count(*) FROM ${schema}.order_amendments WHERE order_id=$1)::int AS audits FROM ${schema}.orders WHERE id=$1`,[ids[3]])).rows[0];assert(Number(fs.total)===25.5&&fs.audits===0,'late_failure_rolls_back_financials');
  const ro=await read(ids[1]),oi=input(ids[1],ro.version,{orderType:'collection',deliveryAddress:'',deliveryFee:'',discountCode:''}),op=await writer(oi);
  assert(op.success,'real_scheduler_collection_preview');assert((await writer(save(oi,op))).success,'real_scheduler_collection_commit');
  const rb=await read(ids[1]),bi=input(ids[1],rb.version,{...delivery,discountCode:'',deliveryFee:''}),bp=await writer(bi);
  assert(bp.success,'real_scheduler_delivery_preview');assert((await writer(save(bi,bp))).success,'real_scheduler_delivery_commit');
  const plan=(await pool.query(`SELECT plan FROM ${schema}.master_wok_service_plans WHERE service_date=$1`,[date])).rows[0]?.plan;
  assert(plan?.delivery?.trips?.some(t=>t.stops.some(s=>s.sourceId===ids[1])),'driver_reservation_saved');
  const rollbackRead=await read(ids[1]),rollbackInput=input(ids[1],rollbackRead.version,{orderType:'collection',deliveryAddress:'',deliveryFee:'',discountCode:''}),rollbackPreview=await writer(rollbackInput);
  const oldRevision=(await pool.query(`SELECT revision FROM ${schema}.master_wok_service_plans WHERE service_date=$1`,[date])).rows[0].revision;
  assert(!(await createAmendmentWriter({...options,pool:failPool})(save(rollbackInput,rollbackPreview))).success,'late_operational_audit_failure_refused');
  const preserved=(await pool.query(`SELECT order_type,(SELECT revision FROM ${schema}.master_wok_service_plans WHERE service_date=$2) AS revision FROM ${schema}.orders WHERE id=$1`,[ids[1],date])).rows[0];
  assert(preserved.order_type==='delivery'&&preserved.revision===oldRevision,'late_failure_preserves_order_and_driver_plan');
  const counts=(await pool.query(`SELECT (SELECT count(*)::int FROM ${schema}.order_amendments WHERE order_id=ANY($1::uuid[])) audits,(SELECT count(*)::int FROM ${schema}.order_payments WHERE order_id=ANY($1::uuid[])) payments`,[ids])).rows[0];assert(counts.audits===5&&counts.payments===0,'audit_count_and_payment_preservation');
  result={status:'PASS',checks,productionMutations:0,notifications:0,routeSource:'synthetic five minute journeys',scheduler:'real four-ring and driver replanning'};
 }catch(e){result={status:'FAIL',reason:e.message,checks};}
 finally{const c=await pool.connect();try{await beginBookingTransaction(c,{key:'amendment-fixture-cleanup'});
  await c.query(`DELETE FROM ${schema}.order_amendments WHERE order_id=ANY($1::uuid[])`,[ids]);await c.query(`DELETE FROM ${schema}.order_items WHERE order_id=ANY($1::uuid[])`,[ids]);await c.query(`DELETE FROM ${schema}.orders WHERE id=ANY($1::uuid[]) AND idempotency_key LIKE $2`,[ids,'amendment-certification-'+run+'-%']);await c.query(`DELETE FROM ${schema}.discount_codes WHERE code=$1`,[code]);
  // Only delete our plan, identified by its fixture stop; never another service.
  await c.query(`DELETE FROM ${schema}.master_wok_service_plans WHERE service_date=$1 AND plan::text LIKE $2`,[date,'%'+ids[1]+'%']);await c.query('COMMIT');}catch(_){await c.query('ROLLBACK');result.cleanup='FAILED';}finally{c.release();}}
 return Response.json(result,{status:result.status==='PASS'?200:500});
});
