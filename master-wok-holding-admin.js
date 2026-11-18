'use strict';
const {warnings,token,acknowledgementCovers}=require('./master-wok-holding-advisory');
const {commitmentTimes}=require('./master-wok-commitment-reader');
const {localDate}=require('./master-wok-clock');
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
function createHoldingAdmin({pool,schema='public',assertWriteAllowed}={}){
 if(!['public','master_wok_rehearsal'].includes(schema))throw Error('INVALID_SCHEMA');
 return async input=>{
  const fail=(reason,statusCode=409)=>({success:false,committed:false,reason,statusCode});
  if(!Array.isArray(input?.orderIds)||!input.orderIds.length||input.orderIds.length>60||input.orderIds.some(id=>!UUID.test(id)))return fail('INVALID_HOLDING_REQUEST',400);
  if(typeof input.staffActor!=='string'||!/^\S+@\S+\.\S+$/.test(input.staffActor))return fail('HOLDING_STAFF_REQUIRED',403);
  let c;
  try{
   c=await pool.connect();await c.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');await assertWriteAllowed(c);
   const orders=(await c.query(`SELECT id,status,preferred_time,confirmed_time,proposed_time,
    (SELECT jsonb_object_agg(i.item_id,i.name) FROM "${schema}".order_items i WHERE i.order_id=orders.id) AS dish_names FROM "${schema}".orders WHERE id=ANY($1::uuid[])`,[input.orderIds])).rows;
   const dates=[...new Set(orders.flatMap(o=>commitmentTimes(o).map(localDate)))];
   const plans=dates.length?(await c.query(`SELECT service_date::text AS service_date,plan FROM "${schema}".master_wok_service_plans WHERE service_date=ANY($1::date[]) ORDER BY service_date`,[dates])).rows:[];
   const rows=orders.map(order=>{
    const found=['cancelled','declined','rejected'].includes(order.status)?[]:plans.flatMap(p=>warnings(p.plan).filter(w=>w.orderId===String(order.id)).map(w=>({serviceDate:p.service_date,...w,dishes:w.dishes.map(d=>({...d,name:order.dish_names?.[d.itemId]||d.itemId.replaceAll('-',' ')})),warningToken:token(w),acknowledgement:acknowledgementCovers(p.plan.holdingAcknowledgements?.[w.id],w)?p.plan.holdingAcknowledgements[w.id]:null})));
    return {orderId:order.id,warnings:found,warningToken:JSON.stringify(found.filter(w=>!w.acknowledgement).map(w=>[w.serviceDate,w.warningToken]))};
   });
   await c.query('ROLLBACK');return {success:true,committed:false,holding:rows};
  }catch(_){if(c)try{await c.query('ROLLBACK');}catch(_){}return fail('HOLDING_CHECK_UNAVAILABLE',503);}finally{c?.release();}
 };
}
module.exports={createHoldingAdmin};
