'use strict';
const {beginBookingTransaction}=require('./master-wok-transaction-writer');
const {validatePayment,paymentBalance}=require('./master-wok-payment-validation');
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
function createPaymentWriter({pool,schema='public',assertWriteAllowed,completeOrder}={}){
 if(!pool?.connect||!['public','master_wok_rehearsal'].includes(schema)||typeof assertWriteAllowed!=='function')throw Error('INVALID_PAYMENT_CONFIGURATION');
 const table=name=>'"'+schema+'".'+name;
 return async input=>{
  const fail=(reason,statusCode=409)=>({success:false,committed:false,reason,statusCode});
  if(!input||!['read','record','record_and_complete','list'].includes(input.action)||(input.action!=='list'&&!UUID.test(input.orderId||''))||(input.action==='list'&&(!Array.isArray(input.orderIds)||!input.orderIds.length||input.orderIds.length>60||input.orderIds.some(id=>!UUID.test(id)))))return fail('INVALID_PAYMENT_REQUEST',400);
  // Only the authenticated server transport supplies this signed staff identity.
  if(typeof input.staffActor!=='string'||!/^\S+@\S+\.\S+$/.test(input.staffActor)||input.staffActor.length>254)return fail('PAYMENT_STAFF_REQUIRED',403);
  let c;
  try{
   c=await pool.connect();await beginBookingTransaction(c,{key:'order:'+input.orderId});await assertWriteAllowed(c);
   if(input.action==='list'){
    const rows=(await c.query(`SELECT o.id AS order_id,o.total AS order_total,o.paid,to_jsonb(p) AS payment FROM ${table('orders')} o LEFT JOIN ${table('order_payments')} p ON p.order_id=o.id WHERE o.id=ANY($1::uuid[])`,[input.orderIds])).rows;
    await c.query('ROLLBACK');return {success:true,committed:false,payments:rows.map(row=>({...row,balance:row.payment?paymentBalance(String(row.order_total),String(row.payment.bill_amount)):null}))};
   }
   const order=(await c.query(`SELECT * FROM ${table('orders')} WHERE id=$1 FOR UPDATE`,[input.orderId])).rows[0];
   if(!order){await c.query('ROLLBACK');return fail('ORDER_NOT_FOUND',404);}
   const prior=(await c.query(`SELECT * FROM ${table('order_payments')} WHERE order_id=$1`,[input.orderId])).rows[0];
   if(input.action==='read'){
    await c.query('ROLLBACK');return {success:true,committed:false,orderId:input.orderId,total:String(order.total),status:order.status,paid:order.paid===true,payment:prior||null,balance:prior?paymentBalance(String(order.total),String(prior.bill_amount)):null,methodUnknown:order.paid===true&&!prior};
   }
   let payment;try{payment=validatePayment(input,input.expectedTotal??String(order.total));}catch(_){await c.query('ROLLBACK');return fail('INVALID_PAYMENT_DETAILS',400);}
   const details={billAmount:payment.billAmount,billMethod:payment.billMethod,tipAmount:payment.tipAmount,tipMethod:payment.tipMethod,...(payment.expectedTotal!==undefined?{expectedTotal:payment.expectedTotal,differenceReason:payment.differenceReason}:{})};
   const fingerprint=JSON.stringify({orderId:input.orderId,staffActor:input.staffActor.toLowerCase(),...details,...(input.action==='record_and_complete'?{complete:true}:{})});
   const event=(await c.query(`SELECT request_fingerprint,response FROM ${table('order_payment_events')} WHERE event_idempotency_key=$1`,[payment.idempotencyKey])).rows[0];
   if(event){await c.query('ROLLBACK');return event.request_fingerprint===fingerprint?{...event.response,replayed:true,committed:false}:fail('PAYMENT_IDEMPOTENCY_CONFLICT');}
   try{validatePayment(input,String(order.total));}catch(_){await c.query('ROLLBACK');return fail('PAYMENT_TOTAL_CHANGED_REFRESH',409);}
   if(prior){await c.query('ROLLBACK');return fail('PAYMENT_ALREADY_RECORDED');}
   if(!['pending','accepted','confirmed','proposed','customer_accepted_time','completed'].includes(order.status)){await c.query('ROLLBACK');return fail('ORDER_NOT_PAYABLE');}
   if(input.action==='record_and_complete'&&typeof completeOrder!=='function'){await c.query('ROLLBACK');return fail('COMBINED_PAYMENT_DISABLED',503);}
   const completion=input.action==='record_and_complete'?await completeOrder({connection:c,order}):{status:order.status};
   const saved=(await c.query(`INSERT INTO ${table('order_payments')}(order_id,capture_idempotency_key,bill_amount,bill_method,tip_amount,tip_method,recorded_by,previously_marked_paid)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[input.orderId,payment.idempotencyKey,details.billAmount,details.billMethod,details.tipAmount,details.tipMethod,input.staffActor.toLowerCase(),order.paid===true])).rows[0];
   const balance=paymentBalance(String(order.total),details.billAmount);
   const response={success:true,notification_managed:true,orderId:input.orderId,total:String(order.total),payment:saved,balance,...completion,paid:balance.paid};
   await c.query(`INSERT INTO ${table('order_payment_events')}(order_id,payment_id,event_idempotency_key,event_type,new_details,actor,request_fingerprint,response)
    VALUES($1,$2,$3,'recorded',$4::jsonb,$5,$6,$7::jsonb)`,[input.orderId,saved.id,payment.idempotencyKey,JSON.stringify({...details,orderTotal:String(order.total),balance}),input.staffActor.toLowerCase(),fingerprint,JSON.stringify(response)]);
   // Completion (when explicitly requested), payment and audit share this COMMIT.
   await c.query(`UPDATE ${table('orders')} SET paid=$2,payment_status=$3,paid_at=coalesce(paid_at,clock_timestamp()) WHERE id=$1`,[input.orderId,balance.paid,balance.paymentStatus]);
   await c.query('COMMIT');return {...response,committed:true};
  }catch(error){if(c)try{await c.query('ROLLBACK');}catch(_){}return ['PAYMENT_COMPLETION_NOT_VERIFIED','PAYMENT_COMPLETION_STATE_REFUSED'].includes(error.message)?fail(error.message,409):fail('PAYMENT_TRANSACTION_FAILED',503);}
  finally{c?.release();}
 };
}
module.exports={createPaymentWriter};

