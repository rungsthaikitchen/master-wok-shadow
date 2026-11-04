'use strict';
async function enqueueNotification(connection,{schema='public',order,mode,key}={}){
 if(!['public','master_wok_rehearsal'].includes(schema)||!order?.id||
  !['order_created','time_suggested','time_confirmed','time_declined'].includes(mode)||!key)
  throw Error('INVALID_NOTIFICATION_EVENT');
 if(order.is_test)return false;
 const customer=order.customer_id?(await connection.query(`SELECT full_name,email,phone FROM "${schema}".customers WHERE id=$1`,[order.customer_id])).rows[0]:null;
 const payload={notification_mode:mode,order_id:order.id,order_ref:order.order_ref,
  name:customer?.full_name,email:customer?.email,phone:customer?.phone,
  order_type:order.order_type,communication_preference:order.communication_preference,
  preferred_time:mode==='time_suggested'?order.proposed_time:order.confirmed_time||order.preferred_time,
  proposed_time:order.proposed_time,confirm_token:mode==='time_suggested'?order.confirm_token:null,
  subtotal:order.subtotal,discount:order.discount,discount_label:order.discount_label,
  delivery_fee:order.delivery_fee,total:order.total,asap_requested:false};
 if(mode==='time_suggested'&&!/^[a-f0-9]{32,64}$/.test(payload.confirm_token||''))throw Error('NOTIFICATION_TOKEN_REQUIRED');
 await connection.query(`INSERT INTO "${schema}".master_wok_notification_outbox(order_id,event_type,payload)
  VALUES($1,$2,$3::jsonb) ON CONFLICT(order_id,event_type) DO NOTHING`,
  [order.id,key,JSON.stringify(payload)]);
 return true;
}
function lifecycleNotification(before,after,input){
 if(after.is_test)return null;
 if(after.status==='proposed'&&after.confirm_token!==before.confirm_token)
  return {mode:'time_suggested',key:'time_suggested:'+after.confirm_token};
 if(input.action==='customer_accept')return {mode:'time_confirmed',key:'customer_accept:'+input.token};
 if(after.status==='confirmed'&&(before.status!=='confirmed'||before.confirmed_time!==after.confirmed_time))
  return {mode:'time_confirmed',key:'time_confirmed:'+after.confirmed_time};
 if(after.status==='cancelled'&&before.status!=='cancelled')return {mode:'time_declined',key:'time_declined:'+crypto.randomUUID()};
 return null;
}
module.exports={enqueueNotification,lifecycleNotification};
