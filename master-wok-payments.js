'use strict';
const {beginBookingTransaction}=require('./master-wok-transaction-writer');
const {validatePayment}=require('./master-wok-payment-validation');
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
function createPaymentWriter({pool,schema='public',assertWriteAllowed}={}){
 if(!pool?.connect||!['public','master_wok_rehearsal'].includes(schema)||typeof assertWriteAllowed!=='function')throw Error('INVALID_PAYMENT_CONFIGURATION');
 const table=name=>'"'+schema+'".'+name;
 return async input=>{
  const fail=(reason,statusCode=409)=>({success:false,committed:false,reason,statusCode});
  if(!input||!UUID.test(input.orderId||'')||!['read','record'].includes(input.action))return fail('INVALID_PAYMENT_REQUEST',400);
  // Only the authenticated server transport supplies this signed staff identity.
  if(typeof input.staffActor!=='string'||!/^\S+@\S+\.\S+$/.test(input.staffActor)||input.staffActor.length>254)return fail('PAYMENT_STAFF_REQUIRED',403);
  let c;
  try{
   c=await pool.connect();await beginBookingTransaction(c,{key:'order:'+input.orderId});await assertWriteAllowed(c);
   const order=(await c.query(`SELECT id,total,status,paid,paid_at,payment_status,is_test FROM ${table('orders')} WHERE id=$1 FOR UPDATE`,[input.orderId])).rows[0];
   if(!order){await c.query('ROLLBACK');return fail('ORDER_NOT_FOUND',404);}
   const prior=(await c.query(`SELECT * FROM ${table('order_payments')} WHERE order_id=$1`,[input.orderId])).rows[0];
   if(input.action==='read'){
    await c.query('ROLLBACK');return {success:true,committed:false,orderId:input.orderId,total:String(order.total),paid:order.paid===true,payment:prior||null,methodUnknown:order.paid===true&&!prior};
   }
   let payment;try{payment=validatePayment(input,String(order.total));}catch(_){await c.query('ROLLBACK');return fail('INVALID_PAYMENT_DETAILS',400);}
   const details={billAmount:payment.billAmount,billMethod:payment.billMethod,tipAmount:payment.tipAmount,tipMethod:payment.tipMethod};
   const fingerprint=JSON.stringify({orderId:input.orderId,staffActor:input.staffActor.toLowerCase(),...details});
   const event=(await c.query(`SELECT request_fingerprint,response FROM ${table('order_payment_events')} WHERE event_idempotency_key=$1`,[payment.idempotencyKey])).rows[0];
   if(event){await c.query('ROLLBACK');return event.request_fingerprint===fingerprint?{...event.response,replayed:true,committed:false}:fail('PAYMENT_IDEMPOTENCY_CONFLICT');}
   if(prior){await c.query('ROLLBACK');return fail('PAYMENT_ALREADY_RECORDED');}
   if(!['pending','accepted','confirmed','proposed','customer_accepted_time','completed'].includes(order.status)){await c.query('ROLLBACK');return fail('ORDER_NOT_PAYABLE');}
   const saved=(await c.query(`INSERT INTO ${table('order_payments')}(order_id,capture_idempotency_key,bill_amount,bill_method,tip_amount,tip_method,recorded_by,previously_marked_paid)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[input.orderId,payment.idempotencyKey,details.billAmount,details.billMethod,details.tipAmount,details.tipMethod,input.staffActor.toLowerCase(),order.paid===true])).rows[0];
   const response={success:true,notification_managed:true,orderId:input.orderId,payment:saved,status:order.status,paid:true};
   await c.query(`INSERT INTO ${table('order_payment_events')}(order_id,payment_id,event_idempotency_key,event_type,new_details,actor,request_fingerprint,response)
    VALUES($1,$2,$3,'recorded',$4::jsonb,$5,$6,$7::jsonb)`,[input.orderId,saved.id,payment.idempotencyKey,JSON.stringify(details),input.staffActor.toLowerCase(),fingerprint,JSON.stringify(response)]);
   // No completion, loyalty settlement, capacity replan or customer notification.
   await c.query(`UPDATE ${table('orders')} SET paid=true,payment_status='paid',paid_at=coalesce(paid_at,clock_timestamp()) WHERE id=$1`,[input.orderId]);
   await c.query('COMMIT');return {...response,committed:true};
  }catch(_){if(c)try{await c.query('ROLLBACK');}catch(_){}return fail('PAYMENT_TRANSACTION_FAILED',503);}
  finally{c?.release();}
 };
}
module.exports={createPaymentWriter};
