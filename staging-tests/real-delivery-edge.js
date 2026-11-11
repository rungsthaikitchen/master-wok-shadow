// Joined real Google read-only lookup + private staging atomic booking rehearsal.
import pg from 'npm:pg@8.23.1';
const {createBookingRuntime}=require('./master-wok-runtime');
const {createMutationAssessment}=require('./master-wok-mutation-assessment');
const {createCommercialValidator}=require('./master-wok-commercial-validator');
const {calculateCommercialOrder}=require('./master-wok-commercial');
const {createDeliveryQuoter}=require('./master-wok-delivery-quote');
const {readCapacityCommitments}=require('./master-wok-commitment-reader');
const {readBookingAvailability}=require('./master-wok-availability-reader');
const {createServicePlanStore}=require('./master-wok-service-plan-store');
const {assessCombinedBooking}=require('./master-wok-combined-assessment');
const {beginBookingTransaction}=require('./master-wok-transaction-writer');
require('./master-wok-model-bundle');
const TOKEN='__CERTIFICATION_TOKEN__',RUN='__BROWSER_RUN__',EXPIRES='__BROWSER_EXPIRES__';
const schema='master_wok_rehearsal',date='2026-11-05',prefix='delivery-'+RUN+'-',email=prefix+'@example.invalid';
const releaseId='private-browser-26efcf42871d88c3';
const address='Morley Town Hall, Queen Street, Morley, Leeds LS27 9DY, UK';
const rewrite=c=>({query:(sql,args)=>c.query(sql.replaceAll('public.orders',schema+'.orders').replaceAll('public.order_items',schema+'.order_items')
 .replaceAll('public.customers',schema+'.customers').replaceAll('public.loyalty_accounts',schema+'.loyalty_accounts')
 .replaceAll('public.discount_codes',schema+'.discount_codes').replaceAll('public.service_state',schema+'.service_state')
 .replaceAll('public.booking_blackouts',schema+'.booking_blackouts')
 .replace('SELECT public.get_next_order_number() AS value',`WITH bump AS (UPDATE ${schema}.order_counters SET current_num=current_num+1 WHERE id=1 RETURNING current_num) SELECT json_build_object('assigned',current_num) AS value FROM bump`),args)});
Deno.serve(async req=>{
 if(Deno.env.get('SUPABASE_URL')!=='https://hvrqgufqjslvgiohgkvu.supabase.co'||
  !/^[a-f0-9]{64}$/.test(TOKEN)||!/^[a-f0-9]{16}$/.test(RUN)||
  req.headers.get('authorization')!=='Bearer '+TOKEN)return new Response('Forbidden',{status:403});
 if(Date.now()>Date.parse(EXPIRES)||!Number.isFinite(Date.parse(EXPIRES)))return new Response('Expired',{status:410});
 if(req.method!=='POST')return new Response('POST required',{status:405});
 const pool=new pg.Pool({connectionString:Deno.env.get('SUPABASE_DB_URL'),max:2,connectionTimeoutMillis:10000});
 const check=(yes,code)=>{if(!yes)throw Error(code);};
 let owns=false,result,phase='SETUP';const calls=[];
 try{
  const c=await pool.connect();
  try{
   await beginBookingTransaction(c,{serviceDates:[date]});
   const control=(await c.query(`SELECT * FROM ${schema}.master_wok_launch_control WHERE id=1`)).rows[0];
   check(control?.mode==='LEGACY'&&Number(control.revision)===8&&control.approved_release_id===releaseId,'CONTROL_CHANGED');
   check(!(await c.query(`SELECT id FROM ${schema}.orders WHERE (coalesce(confirmed_time,preferred_time) AT TIME ZONE 'Europe/London')::date=$1::date`,[date])).rows.length,'DATE_NOT_EMPTY');
   check(!(await c.query(`SELECT service_date FROM ${schema}.master_wok_service_plans WHERE service_date=$1`,[date])).rows.length,'PLAN_NOT_EMPTY');
   await c.query(`UPDATE ${schema}.master_wok_launch_control SET mode='MASTER_WOK',revision=revision+1 WHERE id=1`);
   await c.query('COMMIT');owns=true;
  }catch(e){try{await c.query('ROLLBACK');}catch(_){}throw e;}finally{c.release();}
  const quote=createDeliveryQuoter({supabaseUrl:'https://ubyjrrsvbbqomitpaidb.supabase.co',
   publicKey:'sb_publishable_wnLIasgPkPRUH3UnCpTMZw_hW6PHz2O',fetch:async(url,options)=>{
    const started=Date.now(),r=await fetch(url,options);calls.push({function:new URL(url).pathname.split('/').pop(),status:r.status,milliseconds:Date.now()-started});return r;
   }});
  const readOrders=(c,d)=>readCapacityCommitments(rewrite(c),d),readAvailability=(c,d)=>readBookingAvailability(rewrite(c),d);
  const planStore=createServicePlanStore({schema}),commercial=createCommercialValidator({quoteDelivery:quote});
  const mutation=createMutationAssessment({model:globalThis.MasterWokModelV1,readOrders,readAvailability,planStore});
  const handler=createBookingRuntime({pool,model:globalThis.MasterWokModelV1,secret:TOKEN,releaseId,schema,readOrders,readAvailability,
   validateCommercialOrder:(c,i,s)=>{check(i.customer?.email===email&&i.key.startsWith(prefix),'FIXTURE_ONLY');return commercial(rewrite(c),i,s);},
   assessBooking:context=>{const r=assessCombinedBooking(context);return r.status==='VALIDATED_COMBINED_ASSESSMENT'?{...r,status:'GREEN',bookingApprovalAllowed:true}:r;},
   assessMutation:async context=>{const r=await mutation(context);return r.status==='VALIDATED_LIFECYCLE_ASSESSMENT'?{...r,status:'GREEN',bookingApprovalAllowed:true}:r;}});
  const send=payload=>handler(new Request('https://private.invalid/',{method:'POST',headers:{'content-type':'application/json','x-master-wok-secret':TOKEN},body:JSON.stringify({operation:'checkout',payload})}));
  const line=(item_id,qty=1,mods=[])=>({item_id,qty,modifiers:mods.map(id=>({id})),spice:item_id==='green-curry'?1:0});
  const base={orderType:'delivery',preferredTime:date+'T18:30:00Z',customer:{name:'Private delivery fixture',phone:'07700900126',email,address},
   items:[line('green-curry',1,['chicken']),line('jasmine-rice'),line('veg-spring-rolls')]};
  phase='BROWSER_QUOTE';const browserQuote=await quote({address,subtotalCents:1500});
  const expected=calculateCommercialOrder(base,{now:new Date(),deliveryQuote:browserQuote}).header;
  const input={...base,key:prefix+'paid',expectedTotals:expected};
  phase='ATOMIC_PAID_DELIVERY';const response=await send(input),paid=await response.json();
  check(response.status===200&&paid.success&&paid.committed,'PAID_DELIVERY_FAILED');
  check(Number.isFinite(browserQuote.routeMiles),'REAL_ROUTE_REQUIRED');
  const callCount=calls.length;phase='REPLAY';const replayResponse=await send(input),replay=await replayResponse.json();
  check(replayResponse.status===200&&replay.replayed&&replay.orderId===paid.orderId&&calls.length===callCount,'REPLAY_FAILED');
  phase='CHANGED_TOTAL_ROLLBACK';const wrong=await send({...input,key:prefix+'wrong',expectedTotals:{...expected,total:expected.total+1}});
  check(wrong.status===409&&(await wrong.json()).error==='CHECKOUT_PRICE_CHANGED','PRICE_CHANGE_NOT_REFUSED');
  phase='FREE_DELIVERY';const freeBase={...base,preferredTime:date+'T20:30:00Z',items:[line('green-curry',4,['chicken'])]};
  const freeExpected=calculateCommercialOrder(freeBase,{now:new Date(),deliveryQuote:{straightLineMiles:1,routeMiles:null}}).header;
  const routesBefore=calls.filter(c=>c.function==='get-delivery-route-quote').length;
  const freeResponse=await send({...freeBase,key:prefix+'free',expectedTotals:freeExpected}),free=await freeResponse.json();
  check(freeResponse.status===200&&free.success&&free.committed,'FREE_DELIVERY_FAILED');
  check(calls.filter(c=>c.function==='get-delivery-route-quote').length===routesBefore,'FREE_ROUTE_LOOKUP');
  phase='FREE_OUTSIDE_RADIUS';const outside=await send({...freeBase,key:prefix+'outside',customer:{...base.customer,address:'York Railway Station, Station Road, York YO24 1AB, UK'},expectedTotals:freeExpected});
  check(outside.status===409&&(await outside.json()).error==='DELIVERY_ADDRESS_NOT_ELIGIBLE','OUTSIDE_RADIUS_NOT_REFUSED');
  const orders=(await pool.query(`SELECT id,total,delivery_fee,delivery_address,delivery_straight_line_miles,delivery_route_miles FROM ${schema}.orders WHERE idempotency_key LIKE $1 ORDER BY preferred_time`,[prefix+'%'])).rows;
  check(orders.length===2&&Number(orders[0].delivery_fee)===2&&Number(orders[1].delivery_fee)===0,'ATOMIC_HEADER_MISMATCH');
  const receipts=(await pool.query(`SELECT count(*)::integer AS count FROM ${schema}.master_wok_booking_receipts WHERE key LIKE $1`,[prefix+'%'])).rows[0].count;
  check(receipts===2,'RECEIPT_COUNT_MISMATCH');
  result={status:'PASS',scope:'JOINED_PRIVATE_ATOMIC_DELIVERY_WITH_REAL_GOOGLE',ordersCommitted:2,receipts:2,paidDeliveryFee:2,freeDeliveryFee:0,replayNoExtraProviderCalls:true,changedTotalRolledBack:true,outsideRadiusFreeOrderRefused:true,calls,productionMutations:0,notificationsSent:0};
 }catch(_){result={status:'FAIL',phase,calls,productionMutations:0};}
 finally{
  if(owns){const c=await pool.connect();try{
   await beginBookingTransaction(c,{serviceDates:[date]});
   const control=(await c.query(`SELECT * FROM ${schema}.master_wok_launch_control WHERE id=1`)).rows[0];
   check(control?.mode==='MASTER_WOK'&&Number(control.revision)===9&&control.approved_release_id===releaseId,'CONTROL_CHANGED_CLEANUP');
   check(!(await c.query(`SELECT id FROM ${schema}.orders WHERE (coalesce(confirmed_time,preferred_time) AT TIME ZONE 'Europe/London')::date=$1::date AND coalesce(idempotency_key,'') NOT LIKE $2`,[date,prefix+'%'])).rows.length,'FOREIGN_ORDER_CLEANUP_REFUSED');
   await c.query(`DELETE FROM ${schema}.master_wok_booking_receipts WHERE key LIKE $1`,[prefix+'%']);
   await c.query(`DELETE FROM ${schema}.orders WHERE idempotency_key LIKE $1`,[prefix+'%']);
   await c.query(`DELETE FROM ${schema}.customers WHERE email=$1 AND NOT EXISTS(SELECT 1 FROM ${schema}.orders WHERE customer_id=${schema}.customers.id)`,[email]);
   await c.query(`DELETE FROM ${schema}.master_wok_service_plans WHERE service_date=$1`,[date]);
   await c.query(`UPDATE ${schema}.master_wok_launch_control SET mode='LEGACY',revision=revision+1 WHERE id=1`);
   await c.query('COMMIT');result.fixtureCleanup=true;result.restoredMode='LEGACY';
  }catch(_){try{await c.query('ROLLBACK');}catch(_){}result.fixtureCleanup=false;result.status='FAIL';}finally{c.release();}}
  await pool.end();
 }
 return Response.json(result,{status:result.status==='PASS'?200:409});
});
