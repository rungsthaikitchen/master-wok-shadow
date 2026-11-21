'use strict';

const {validateHistoricalCorrection}=require('./historical_order_reconciliation_policy.cjs');
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const fingerprint=async x=>Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(x)))),b=>b.toString(16).padStart(2,'0')).join('');

/**
 * This writer must be wired ONLY into the existing authenticated Master Wok
 * Edge Function operation dispatcher. Never expose directly to the browser.
 * beginBookingTransaction and assertWriteAllowed are the production writer's
 * existing functions; they MUST be injected, not replaced with SQL bypasses.
 */
function createHistoricalReconciliationWriter({pool,schema='master_wok_rehearsal',beginBookingTransaction,assertWriteAllowed,settleLoyalty}={}){
 if(!pool?.connect||!['public','master_wok_rehearsal'].includes(schema)||
 typeof beginBookingTransaction!=='function'||typeof assertWriteAllowed!=='function'||typeof settleLoyalty!=='function')
  throw Error('INVALID_RECONCILIATION_CONFIGURATION');
 const t=name=>'"'+schema+'".'+name;
 return async input=>{
  const fail=(reason,statusCode=409)=>({success:false,committed:false,reason,statusCode});
  if(!input||!UUID.test(input.orderId||'')||!UUID.test(input.idempotencyKey||''))
   return fail('INVALID_RECONCILIATION_REQUEST',400);
  let c,closed=false;
  try{
   c=await pool.connect();
   await beginBookingTransaction(c,{key:'order:'+input.orderId});
   await assertWriteAllowed(c);
   const order=(await c.query(`SELECT * FROM ${t('orders')} WHERE id=$1 FOR UPDATE`,[input.orderId])).rows[0];
   if(!order){await c.query('ROLLBACK');closed=true;return fail('ORDER_NOT_FOUND',404);}
   const prior=(await c.query(`SELECT * FROM ${t('order_payments')} WHERE order_id=$1`,[input.orderId])).rows[0];
   const previous=(await c.query(`SELECT response,request_fingerprint FROM ${t('order_amendments')} WHERE idempotency_key=$1`,[input.idempotencyKey])).rows[0];
   const fp=await fingerprint([input.orderId,input.idempotencyKey,input.staffActor,input.reason,input.agreedTime,input.amountPence,input.method,input.fulfilled]);
   if(previous){await c.query('ROLLBACK');closed=true;return previous.request_fingerprint===fp?{...previous.response,replayed:true,committed:false}:fail('RECONCILIATION_IDEMPOTENCY_CONFLICT');}
   const now=(await c.query('SELECT clock_timestamp() AS now')).rows[0].now;
   const eligible=validateHistoricalCorrection({order,existingPayment:prior,now,agreedTime:input.agreedTime,
    amount:input.amountPence,method:input.method,reason:input.reason,actor:input.staffActor,
    fulfilled:input.fulfilled,idempotencyKey:input.idempotencyKey});
   if(!eligible.ok){await c.query('ROLLBACK');closed=true;return fail(eligible.code);}
   // One atomic correction: no kitchen plan mutation, external payment capture,
   // customer notification. Loyalty settles within this transaction.
   const before={status:order.status,confirmed_time:order.confirmed_time,paid:order.paid,payment_status:order.payment_status};
   const after={status:'completed',confirmed_time:order.proposed_time,paid:true,payment_status:'paid'};
   const payment=(await c.query(`INSERT INTO ${t('order_payments')}
    (order_id,capture_idempotency_key,bill_amount,bill_method,tip_amount,tip_method,recorded_by,previously_marked_paid)
    VALUES($1,$2,$3,'card',0,NULL,$4,false) RETURNING id`,
    [input.orderId,input.idempotencyKey,input.amountPence/100,input.staffActor.toLowerCase()])).rows[0];
   await c.query(`UPDATE ${t('orders')} SET status='completed',confirmed_time=proposed_time,
    confirm_token=NULL,paid=true,payment_status='paid',paid_at=COALESCE(paid_at,clock_timestamp()) WHERE id=$1`,[input.orderId]);
   const loyalty=order.loyalty_settled===true?{handled:true,settled:true}:await settleLoyalty(c,{...order,...after},{schema,allowLegacy:true});
   if(!loyalty?.handled||!loyalty?.settled)throw Error('HISTORICAL_LOYALTY_REVIEW_REQUIRED');
   after.loyalty_settled=true;
   const audit={source:'STAFF_HISTORICAL_FULFILMENT',actor:input.staffActor.toLowerCase(),reason:input.reason,
    agreedTime:input.agreedTime,fulfilmentAttested:true,paymentMethod:'card',paymentAmount:input.amountPence/100,
    customerNotificationSent:false,kitchenRescheduled:false};
   const response={success:true,committed:true,orderId:input.orderId,before,after,audit};
   await c.query(`INSERT INTO ${t('order_amendments')}
    (order_id,idempotency_key,request_fingerprint,actor,reason,before_details,after_details,response)
    VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb)`,
    [input.orderId,input.idempotencyKey,fp,input.staffActor.toLowerCase(),input.reason,
     JSON.stringify(before),JSON.stringify({...after,...audit}),JSON.stringify(response)]);
   await c.query(`INSERT INTO ${t('order_payment_events')}
    (order_id,payment_id,event_idempotency_key,event_type,new_details,actor,request_fingerprint,response)
    VALUES($1,$2,$3,'recorded',$4::jsonb,$5,$6,$7::jsonb)`,
    [input.orderId,payment.id,input.idempotencyKey,JSON.stringify({billAmount:input.amountPence/100,billMethod:'card',tipAmount:0,source:'STAFF_HISTORICAL_FULFILMENT'}),
     input.staffActor.toLowerCase(),fp,JSON.stringify(response)]);
   await c.query('COMMIT');closed=true;return response;
  }catch(error){
   if(c&&!closed)try{await c.query('ROLLBACK')}catch(_){}
   return fail('RECONCILIATION_FAILED',503);
  }finally{if(c)c.release();}
 };
}
module.exports={createHistoricalReconciliationWriter};
