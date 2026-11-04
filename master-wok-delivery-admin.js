'use strict';
const {beginBookingTransaction}=require('./master-wok-transaction-writer');
const {normalizeStagingOrders}=require('./staging-order-snapshot');
const {localDate,relativePlacement}=require('./master-wok-clock');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
// Shares the checkout writer lock and plan revision. Recommendations never write;
// explicit confirmations re-read every commitment and assess kitchen + driver.
function createDeliveryAdmin({pool,model,readOrders,readAvailability,planStore,deliveryCapacity,assertWriteAllowed,schema='public'}={}){
 if(!['public','master_wok_rehearsal'].includes(schema))throw Error('INVALID_DELIVERY_SCHEMA');
 const table='"'+schema+'".master_wok_service_plans';
 return async input=>{
  let c;
  const fail=(reason,statusCode=409)=>({success:false,committed:false,reason,statusCode});
  if(!input||!['delivery_trip_options','preview_delivery_combination','combine_deliveries','split_delivery_trip'].includes(input.action)||
   !UUID.test(input.orderId||''))return fail('INVALID_DELIVERY_ACTION',400);
  try{
   c=await pool.connect();await beginBookingTransaction(c,{key:'delivery:'+input.orderId});await assertWriteAllowed(c);
   const order=(await c.query(`SELECT * FROM "${schema}".orders WHERE id=$1 FOR UPDATE`,[input.orderId])).rows[0];
   if(!order||order.order_type!=='delivery'||order.is_test||['cancelled','declined','rejected'].includes(order.status))return await rollback(fail('CURRENT_DELIVERY_REQUIRED'));
   if(order.status==='proposed')return await rollback(fail('RESOLVE_PROPOSED_TIMES_FIRST'));
   const serviceDate=localDate(order.confirmed_time||order.proposed_time||order.preferred_time);
   const raw=await readOrders(c,serviceDate),previousPlan=await planStore.read(c,serviceDate);
   const revision=Number((await c.query(`SELECT revision FROM ${table} WHERE service_date=$1`,[serviceDate])).rows[0]?.revision);
   if(!Number.isSafeInteger(revision)||!previousPlan?.delivery)return await rollback(fail('DELIVERY_PLAN_REQUIRED'));
   const now=(await c.query('SELECT clock_timestamp() AS now')).rows[0]?.now;
   const availability=await readAvailability(c,serviceDate);
   const orders=normalizeStagingOrders({rows:raw,model,serviceDate}).map(o=>({...o,placedAt:relativePlacement(o.placedAt,serviceDate)}));
   const context={orders,rows:raw,previousPlan,now,serviceDate,availability};
   const focus=raw.filter(r=>r.source_order_id===input.orderId);
   if(focus.length!==1)return await rollback(fail('RESOLVE_PROPOSED_TIMES_FIRST'));
   const focusId=String(focus[0].id),trip=previousPlan.delivery.trips.find(t=>t.stops.some(s=>s.id===focusId));
   if(!trip)return await rollback(fail('DELIVERY_TRIP_NOT_FOUND'));
   if(input.action==='delivery_trip_options'){
    // Release the writer lock before optional route comparisons; confirming an
    // option later requires this revision and runs a fresh locked assessment.
    await c.query('ROLLBACK');c.release();c=null;
    const singles=previousPlan.delivery.trips.filter(t=>t.stops.length===1&&t.id!==trip.id&&
     raw.some(r=>String(r.id)===t.stops[0].id&&r.status!=='proposed')&&
     Math.abs(t.stops[0].target-focus[0].local_ready_minute)<=20)
     .sort((a,b)=>Math.abs(a.stops[0].target-focus[0].local_ready_minute)-Math.abs(b.stops[0].target-focus[0].local_ready_minute)).slice(0,5);
    const options=trip.stops.length===1?(await Promise.all(singles.map(async other=>{
     const ids=[focusId,other.stops[0].id],candidates=[];
     for(const combine of [ids,[...ids].reverse()]){
      const r=await deliveryCapacity.replan({...context,combine});
      if(r.status!=='VALIDATED_PROTECTED_PLAN')continue;
      const proposed=r.plan.delivery.trips.find(t=>t.stops.length===2&&t.stops.some(s=>s.id===focusId));
      const savedMinutes=(trip.finish-trip.start)+(other.finish-other.start)-(proposed.finish-proposed.start);
      if(savedMinutes>0)candidates.push({orderIds:proposed.stops.map(s=>s.sourceId),trip:proposed,savedMinutes});
     }
     return candidates.sort((a,b)=>b.savedMinutes-a.savedMinutes)[0]||null;
    }))).filter(Boolean).sort((a,b)=>b.savedMinutes-a.savedMinutes):[];
    return {success:true,committed:false,notification_managed:true,revision,serviceDate,trip,recommendations:options,candidates:raw.filter(r=>r.order_type==='delivery'&&r.status!=='proposed'&&r.source_order_id!==input.orderId).map(r=>({orderId:r.source_order_id,reference:r.order_ref,time:r.confirmed_time}))};
   }
   if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision!==revision)return await rollback(fail('DELIVERY_PLAN_CHANGED_REFRESH'));
   let change;
   if(['combine_deliveries','preview_delivery_combination'].includes(input.action)){
    if(!Array.isArray(input.orderIds)||input.orderIds.length!==2||new Set(input.orderIds).size!==2||
     !input.orderIds.includes(input.orderId)||input.orderIds.some(id=>!UUID.test(id)))return await rollback(fail('TWO_CURRENT_DELIVERIES_REQUIRED',400));
    const combine=input.orderIds.map(id=>{
     const matches=raw.filter(r=>r.source_order_id===id&&r.order_type==='delivery'&&r.status!=='proposed');
     if(matches.length!==1)throw Error('RESOLVE_PROPOSED_TIMES_FIRST');return String(matches[0].id);
    });change={combine};
   }else change={splitTripId:trip.id};
   const result=await deliveryCapacity.replan({...context,...change});
   if(result.status!=='VALIDATED_PROTECTED_PLAN')return await rollback(fail(result.reason||'DELIVERY_TRIP_NOT_FEASIBLE'));
   if(input.action==='preview_delivery_combination')return await rollback({success:true,committed:false,
    notification_managed:true,revision,trip:result.plan.delivery.trips.find(t=>t.stops.length===2&&t.stops.some(s=>s.id===focusId))});
   // Metadata lives with the atomic service plan, including who requested the
   // change and the prior revision; it does not alter customer promises.
   result.plan.delivery.decisions=[...(result.plan.delivery.decisions||[]),{source:'admin',action:input.action,orderIds:input.orderIds||[input.orderId],
    priorRevision:revision,at:new Date(now).toISOString()}];
   await planStore.save(c,serviceDate,result.plan);await c.query('COMMIT');
   return {success:true,committed:true,notification_managed:true,revision:revision+1};
  }catch(error){if(c)try{await c.query('ROLLBACK');}catch(_){}
   const safe=new Set(['DRIVER_UNAVAILABLE','DELIVERY_TRIP_ALREADY_STARTED','COMBINED_DELIVERY_NOT_FEASIBLE',
    'DELIVERY_TRAVEL_TIME_UNAVAILABLE','RESOLVE_PROPOSED_TIMES_FIRST','SPLIT_EXISTING_TRIP_FIRST']);
   return fail(safe.has(error.message)?error.message:'DELIVERY_TRIP_TRANSACTION_FAILED');
  }finally{c?.release();}
  async function rollback(result){await c.query('ROLLBACK');return result;}
 };
}
module.exports={createDeliveryAdmin};
