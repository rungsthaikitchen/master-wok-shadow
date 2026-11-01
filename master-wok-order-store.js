'use strict';
// Server-only persistence for the existing RTK order tables. The caller must
// own the locked transaction and supply a server-validated commercial payload.
// No browser-provided price, loyalty entitlement or status is trusted here.
const HEADER_FIELDS=new Set([
 'customer_id','subtotal','discount','discount_label','discount_code','discount_amount',
 'delivery_fee','delivery_straight_line_miles','delivery_route_miles','delivery_distance_source',
 'total','loyalty_discount','loyalty_points_redeem_pending','loyalty_points_earned_pending',
 'loyalty_reward_applied','loyalty_expected_balance','order_type','notes','order_ref',
 'payment_preference','preferred_time','asap_requested','communication_preference',
 'delivery_address','customer_lat','customer_lng','device_os','user_agent','device_platform'
]);
const ITEM_FIELDS=['item_id','name','unit_price','qty','modifiers','spice','img','item_note','kitchen_load'];
function checkedTable(schema,table){
 if(!['public','master_wok_rehearsal'].includes(schema))throw Error('INVALID_SCHEMA');
 return '"'+schema+'"."'+table+'"';
}
function createOrderStore({schema='public'}={}){
 const orders=checkedTable(schema,'orders'),items=checkedTable(schema,'order_items');
 const receipts=checkedTable(schema,'master_wok_booking_receipts');
 return {
  async lookupKey(connection,key){
   const r=await connection.query(`SELECT fingerprint, response FROM ${receipts} WHERE key=$1`,[key]);
   return r.rows[0]||null;
  },
  async persist(connection,{key,serviceDate,candidate,fingerprint}){
   const header=candidate.validatedHeader,lines=candidate.validatedItems;
   if(!header||!Array.isArray(lines)||!lines.length||lines.length>100||
      Object.keys(header).some(k=>!HEADER_FIELDS.has(k))||
      !['collection','delivery'].includes(header.order_type)||
      !Number.isFinite(Date.parse(header.preferred_time)))throw Error('INVALID_VALIDATED_ORDER');
   for(const field of ['subtotal','total'])if(!Number.isFinite(header[field])||header[field]<0)
    throw Error('INVALID_VALIDATED_TOTAL');
   if(lines.some(l=>!l||typeof l.item_id!=='string'||typeof l.name!=='string'||
       !Number.isFinite(l.unit_price)||l.unit_price<0||!Number.isInteger(l.qty)||l.qty<=0||
       !Array.isArray(l.modifiers)||Object.keys(l).some(k=>!ITEM_FIELDS.includes(k))))
    throw Error('INVALID_VALIDATED_ITEMS');
   const fields=Object.keys(header);
   const result=await connection.query(`INSERT INTO ${orders}
    (${fields.map(k=>'"'+k+'"').join(',')},idempotency_key,status,loyalty_settled,capacity_scheduler)
    VALUES (${fields.map((_,i)=>'$'+(i+1)).join(',')},$${fields.length+1},'pending',false,'MASTER_WOK')
    RETURNING id`,[...fields.map(k=>header[k]),key]);
   const id=result.rows[0]?.id;if(!id)throw Error('ORDER_INSERT_FAILED');
   for(const line of lines){
    const fields=ITEM_FIELDS.filter(k=>Object.hasOwn(line,k));
    await connection.query(`INSERT INTO ${items} (order_id,${fields.map(k=>'"'+k+'"').join(',')})
     VALUES ($1,${fields.map((_,i)=>'$'+(i+2)).join(',')})`,
     [id,...fields.map(k=>k==='modifiers'?JSON.stringify(line[k]):line[k])]);
   }
   await connection.query(`INSERT INTO ${checkedTable(schema,'master_wok_notification_outbox')} (order_id,event_type)
    VALUES($1,'order_created') ON CONFLICT(order_id,event_type) DO NOTHING`,[id]);
   const response={orderId:id,serviceDate,status:'pending',orderRef:header.order_ref,customerId:header.customer_id,
    totals:Object.fromEntries(['subtotal','discount','discount_amount','delivery_fee','total','loyalty_discount',
     'loyalty_points_redeem_pending','loyalty_points_earned_pending','loyalty_reward_applied','loyalty_expected_balance']
     .filter(k=>header[k]!==undefined).map(k=>[k,header[k]])),notification_status:'queued'};
   await connection.query(`INSERT INTO ${receipts} (key,service_date,order_id,fingerprint,response)
    VALUES ($1,$2,$3,$4,$5::jsonb)`,[key,serviceDate,id,fingerprint,JSON.stringify(response)]);
   return response;
  }
 };
}
module.exports={createOrderStore};
