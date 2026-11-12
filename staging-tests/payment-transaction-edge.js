// Isolated staging certification; never deploy to production. No notifications.
import pg from 'npm:pg@8.23.1';
const {createPaymentWriter}=require('./master-wok-payments');
const {beginBookingTransaction}=require('./master-wok-transaction-writer');
const token='__TOKEN__',expires=__EXPIRES__;
const pool=new pg.Pool({connectionString:Deno.env.get('SUPABASE_DB_URL'),max:4});
Deno.serve(async req=>{
 if(Deno.env.get('SUPABASE_URL')!=='https://hvrqgufqjslvgiohgkvu.supabase.co'||Date.now()>expires||req.headers.get('x-payment-certification')!==token)return Response.json({error:'Unavailable'},{status:403});
 if(req.method!=='POST')return Response.json({error:'Method'}, {status:405});
 const schema='master_wok_rehearsal',ids=Array.from({length:5},()=>crypto.randomUUID()),checks=[];
 const assert=(condition,label)=>{if(!condition)throw Error(label);checks.push(label);};
 const gate=async c=>{const r=(await c.query('SELECT mode FROM master_wok_rehearsal.master_wok_launch_control WHERE id=1')).rows[0];if(r.mode!=='MASTER_WOK')throw Error('STAGING_NOT_READY');};
 const writer=createPaymentWriter({pool,schema,assertWriteAllowed:gate});
 const payload=(id,other={})=>({action:'record',orderId:id,staffActor:'payment-test@example.invalid',billAmount:'32.00',billMethod:'card',tipAmount:'3.00',tipMethod:'cash',idempotencyKey:crypto.randomUUID(),...other});
 try{
  const c=await pool.connect();try{await beginBookingTransaction(c,{key:'payment-fixture-setup'});for(const id of ids)await c.query("INSERT INTO master_wok_rehearsal.orders(id,status,total,subtotal,paid,is_test,idempotency_key,capacity_scheduler) VALUES($1,'confirmed',32,32,false,true,$2,'MASTER_WOK')",[id,'payment-certification-'+id]);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  const p=payload(ids[0]),first=await writer(p);assert(first.success&&first.committed&&first.status==='confirmed','card_bill_cash_tip_without_completion');
  const replay=await writer(p);assert(replay.success&&replay.replayed&&!replay.committed,'identical_retry');
  assert((await writer({...p,tipAmount:'4.00'})).reason==='PAYMENT_IDEMPOTENCY_CONFLICT','changed_retry_refused');
  assert((await writer(payload(ids[0]))).reason==='PAYMENT_ALREADY_RECORDED','second_capture_refused');
  const race=await Promise.all([writer(payload(ids[1])),writer(payload(ids[1],{billMethod:'cash'}))]);assert(race.filter(x=>x.success).length===1&&race.filter(x=>x.reason==='PAYMENT_ALREADY_RECORDED').length===1,'concurrent_capture_serialized');
  assert((await writer(payload(ids[2],{billAmount:'31.00'}))).reason==='INVALID_PAYMENT_DETAILS','stale_total_refused');
  assert((await writer(payload(ids[2],{tipMethod:null}))).reason==='INVALID_PAYMENT_DETAILS','missing_tip_method_refused');
  assert((await writer(payload(ids[2],{staffActor:''}))).reason==='PAYMENT_STAFF_REQUIRED','missing_actor_refused');
  const faultPool={connect:async()=>{const c=await pool.connect();return {query:(sql,args)=>{if(sql.startsWith('UPDATE'))throw Error('INJECTED_UPDATE_FAILURE');return c.query(sql,args);},release:()=>c.release()};}};
  const faulty=createPaymentWriter({pool:faultPool,schema,assertWriteAllowed:gate});assert((await faulty(payload(ids[2]))).reason==='PAYMENT_TRANSACTION_FAILED','injected_write_failure_refused');
  const rolled=(await pool.query('SELECT (SELECT count(*) FROM master_wok_rehearsal.order_payments WHERE order_id=$1)::int AS payments,(SELECT count(*) FROM master_wok_rehearsal.order_payment_events WHERE order_id=$1)::int AS events,(SELECT paid FROM master_wok_rehearsal.orders WHERE id=$1) AS paid',[ids[2]])).rows[0];assert(rolled.payments===0&&rolled.events===0&&!rolled.paid,'full_transaction_rollback');
  const c2=await pool.connect();try{await beginBookingTransaction(c2,{key:'payment-fixture-terminal'});await c2.query("UPDATE master_wok_rehearsal.orders SET status='completed',paid=true WHERE id=$1",[ids[3]]);await c2.query("UPDATE master_wok_rehearsal.orders SET status='cancelled' WHERE id=$1",[ids[4]]);await c2.query('COMMIT');}finally{c2.release();}
  const unknown=await writer({action:'read',orderId:ids[3],staffActor:'payment-test@example.invalid'});assert(unknown.methodUnknown&&unknown.payment===null,'legacy_method_not_invented');
  const completed=await writer(payload(ids[3],{tipAmount:'0.00',tipMethod:null}));assert(completed.success&&completed.status==='completed'&&completed.payment.previously_marked_paid,'completed_paid_order_can_add_details');
  assert((await writer(payload(ids[4]))).reason==='ORDER_NOT_PAYABLE','cancelled_order_refused');
  const audit=(await pool.query('SELECT (SELECT count(*) FROM master_wok_rehearsal.order_payments WHERE order_id=ANY($1::uuid[]))::int AS payments,(SELECT count(*) FROM master_wok_rehearsal.order_payment_events WHERE order_id=ANY($1::uuid[]))::int AS events',[ids])).rows[0];assert(audit.payments===3&&audit.events===3,'one_audit_event_per_capture');
  return Response.json({status:'PASS',checks,notifications:0,productionMutations:0});
 }catch(e){return Response.json({status:'FAIL',reason:e.message,checks},{status:500});}
 finally{
  const c=await pool.connect();try{await beginBookingTransaction(c,{key:'payment-fixture-cleanup'});await c.query('DELETE FROM master_wok_rehearsal.order_payment_events WHERE order_id=ANY($1::uuid[])',[ids]);await c.query('DELETE FROM master_wok_rehearsal.order_payments WHERE order_id=ANY($1::uuid[])',[ids]);await c.query("DELETE FROM master_wok_rehearsal.orders WHERE id=ANY($1::uuid[]) AND idempotency_key LIKE 'payment-certification-%'",[ids]);await c.query('COMMIT');}catch(_){await c.query('ROLLBACK');}finally{c.release();}
 }
});
