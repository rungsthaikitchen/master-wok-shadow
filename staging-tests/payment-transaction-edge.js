// Isolated staging certification; never deploy to production. No notifications.
import pg from 'npm:pg@8.23.1';
const {createPaymentWriter}=require('./master-wok-payments');
const {createPaymentCompletion}=require('./master-wok-payment-completion');
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
  const completion=createPaymentCompletion({schema,assessMutation:async()=>({status:'GREEN',bookingApprovalAllowed:true,plansByDate:{}})});
  const combined=createPaymentWriter({pool,schema,assertWriteAllowed:gate,completeOrder:completion});
  const setup=await pool.connect();try{await beginBookingTransaction(setup,{key:'combined-payment-fixtures'});await setup.query("UPDATE master_wok_rehearsal.orders SET status='confirmed' WHERE id=$1",[ids[2]]);await setup.query('COMMIT');}finally{setup.release();}
  const cp=payload(ids[2],{action:'record_and_complete'}),done=await combined(cp);assert(done.success&&done.status==='completed','combined_payment_completes_in_same_transaction');
  assert((await combined(cp)).replayed===true,'combined_retry_replays_once');
  const after=(await pool.query('SELECT status,paid FROM master_wok_rehearsal.orders WHERE id=$1',[ids[2]])).rows[0];assert(after.status==='completed'&&after.paid,'combined_status_and_paid_persist');
  const legacy=await combined({...payload(ids[3]),action:'record_and_complete'});assert(legacy.reason==='PAYMENT_ALREADY_RECORDED','existing_payment_not_duplicated_by_combined_action');
  const failId=crypto.randomUUID();ids.push(failId);const fc=await pool.connect();try{await beginBookingTransaction(fc,{key:'combined-failure-fixture'});await fc.query("INSERT INTO master_wok_rehearsal.orders(id,status,total,subtotal,paid,is_test,idempotency_key,capacity_scheduler) VALUES($1,'confirmed',32,32,false,true,$2,'MASTER_WOK')",[failId,'payment-certification-'+failId]);await fc.query('COMMIT');}finally{fc.release();}
  const refused=createPaymentWriter({pool,schema,assertWriteAllowed:gate,completeOrder:createPaymentCompletion({schema,assessMutation:async()=>({status:'UNVERIFIED'})})});
  // Give the failure fixture a date so the certified-plan requirement is exercised.
  const dc=await pool.connect();try{await beginBookingTransaction(dc,{key:'combined-failure-date'});await dc.query("UPDATE master_wok_rehearsal.orders SET preferred_time='2026-12-09T18:00:00Z' WHERE id=$1",[failId]);await dc.query('COMMIT');}finally{dc.release();}
  assert((await refused(payload(failId,{action:'record_and_complete'}))).reason==='PAYMENT_COMPLETION_NOT_VERIFIED','completion_refusal_refuses_payment');
  const failed=(await pool.query('SELECT status,paid,(SELECT count(*) FROM master_wok_rehearsal.order_payments WHERE order_id=$1)::int AS payments FROM master_wok_rehearsal.orders WHERE id=$1',[failId])).rows[0];assert(failed.status==='confirmed'&&!failed.paid&&failed.payments===0,'completion_refusal_rolls_back_status_and_payment');
  const nc=await pool.connect();try{await beginBookingTransaction(nc,{key:'combined-late-failure-reset'});await nc.query('UPDATE master_wok_rehearsal.orders SET preferred_time=null WHERE id=$1',[failId]);await nc.query('COMMIT');}finally{nc.release();}
  const lateFaultPool={connect:async()=>{const c=await pool.connect();return {query:(sql,args)=>{if(sql.startsWith('INSERT INTO')&&sql.includes('.order_payments('))throw Error('INJECTED_PAYMENT_INSERT_FAILURE');return c.query(sql,args);},release:()=>c.release()};}};
  const late=createPaymentWriter({pool:lateFaultPool,schema,assertWriteAllowed:gate,completeOrder:completion});
  assert((await late(payload(failId,{action:'record_and_complete'}))).reason==='PAYMENT_TRANSACTION_FAILED','payment_insert_failure_after_completion_refused');
  const lateState=(await pool.query('SELECT status,paid FROM master_wok_rehearsal.orders WHERE id=$1',[failId])).rows[0];assert(lateState.status==='confirmed'&&!lateState.paid,'late_failure_rolls_completion_back');
  const extraIds=Array.from({length:3},()=>crypto.randomUUID());ids.push(...extraIds);
  const extra=await pool.connect();try{await beginBookingTransaction(extra,{key:'actual-payment-fixtures'});for(const id of extraIds)await extra.query("INSERT INTO master_wok_rehearsal.orders(id,status,total,subtotal,paid,is_test,idempotency_key,capacity_scheduler) VALUES($1,'confirmed',32,32,false,true,$2,'MASTER_WOK')",[id,'payment-certification-'+id]);await extra.query('COMMIT');}finally{extra.release();}
  const actual=payload(extraIds[0],{action:'record_and_complete',billAmount:'31.70',expectedTotal:'32.00',differenceReason:'Synthetic 30p underpayment',tipAmount:'2.00',tipMethod:'cash'});
  const under=await combined(actual);assert(under.success&&under.status==='completed'&&under.paid===false&&under.balance.underpayment==='0.30','actual_underpayment_completes_without_claiming_full_payment');
  const underDb=(await pool.query('SELECT status,paid,payment_status FROM master_wok_rehearsal.orders WHERE id=$1',[extraIds[0]])).rows[0];assert(underDb.status==='completed'&&!underDb.paid&&underDb.payment_status==='underpaid','underpaid_state_persisted');
  const auditActual=(await pool.query('SELECT new_details FROM master_wok_rehearsal.order_payment_events WHERE order_id=$1',[extraIds[0]])).rows[0].new_details;assert(auditActual.billAmount==='31.70'&&auditActual.differenceReason==='Synthetic 30p underpayment'&&auditActual.balance.underpayment==='0.30','actual_receipt_and_reason_audited');
  assert((await combined(actual)).replayed,'actual_payment_retry_replays');
  assert((await combined({...actual,differenceReason:'changed retry'})).reason==='PAYMENT_IDEMPOTENCY_CONFLICT','changed_difference_reason_conflicts');
  const stale=await combined({...payload(extraIds[1]),expectedTotal:'31.00',billAmount:'31.00',tipAmount:'0.00',tipMethod:null});assert(stale.reason==='PAYMENT_TOTAL_CHANGED_REFRESH','stale_displayed_total_refused');
  const over=await combined({...payload(extraIds[1]),action:'record_and_complete',expectedTotal:'32.00',billAmount:'33.00',differenceReason:'Synthetic extra receipt; not a tip',tipAmount:'0.00',tipMethod:null});assert(over.success&&over.paid&&over.balance.overpayment==='1.00'&&Number(over.payment.tip_amount)===0,'overpayment_is_not_invented_tip');
  const missingReason=await combined({...payload(extraIds[2]),expectedTotal:'32.00',billAmount:'31.00',tipAmount:'0.00',tipMethod:null});assert(missingReason.reason==='INVALID_PAYMENT_DETAILS','missing_difference_reason_refused');
  const actualList=await writer({action:'list',orderIds:extraIds.slice(0,2),staffActor:'payment-test@example.invalid'});assert(actualList.payments.find(p=>p.order_id===extraIds[0]).balance.underpayment==='0.30'&&actualList.payments.find(p=>p.order_id===extraIds[1]).balance.overpayment==='1.00','list_reports_actual_balances');
  const changed=await pool.connect();try{await beginBookingTransaction(changed,{key:'post-capture-total-fixture'});await changed.query('UPDATE master_wok_rehearsal.orders SET total=33 WHERE id=$1',[extraIds[0]]);await changed.query('COMMIT');}finally{changed.release();}
  assert((await combined(actual)).replayed,'same_key_replays_after_later_total_change');
  const historicalIds=[crypto.randomUUID(),crypto.randomUUID()];ids.push(...historicalIds);
  const hc=await pool.connect();try{await beginBookingTransaction(hc,{key:'historical-payment-fixtures'});
   if((await hc.query("SELECT service_date FROM master_wok_rehearsal.master_wok_service_plans WHERE service_date='2026-10-31'")).rows.length)throw Error('HISTORICAL_FIXTURE_DATE_NOT_EMPTY');
   for(const id of historicalIds)await hc.query("INSERT INTO master_wok_rehearsal.orders(id,status,total,subtotal,paid,is_test,loyalty_settled,idempotency_key,capacity_scheduler,preferred_time,confirmed_time) VALUES($1,'customer_accepted_time',51.5,51.5,false,true,true,$2,'LEGACY','2026-10-31T17:20:00Z','2026-10-31T17:30:00Z')",[id,'payment-certification-'+id]);await hc.query('COMMIT');}finally{hc.release();}
  const historicalPayload=payload(historicalIds[0],{action:'record_and_complete',billAmount:'51.50',expectedTotal:'51.50',tipAmount:'0.00',tipMethod:null});
  const historySaved=await combined(historicalPayload);assert(historySaved.success&&historySaved.historicalCompletion&&historySaved.status==='completed'&&historySaved.loyalty_settled,'historical_legacy_payment_completion_without_replanning');
  const historyState=(await pool.query("SELECT status,capacity_scheduler,loyalty_settled FROM master_wok_rehearsal.orders WHERE id=$1",[historicalIds[0]])).rows[0];assert(historyState.status==='completed'&&historyState.capacity_scheduler==='LEGACY'&&historyState.loyalty_settled,'historical_source_and_settled_loyalty_preserved');
  assert((await combined(historicalPayload)).replayed,'historical_payment_retry_once');
  const historyFailed=await late(payload(historicalIds[1],{action:'record_and_complete',billAmount:'51.50',expectedTotal:'51.50',tipAmount:'0.00',tipMethod:null}));assert(!historyFailed.success,'historical_late_capture_failure_refused');
  const historyRollback=(await pool.query("SELECT status,paid,(SELECT count(*)::int FROM master_wok_rehearsal.order_payments WHERE order_id=$1) payments FROM master_wok_rehearsal.orders WHERE id=$1",[historicalIds[1]])).rows[0];assert(historyRollback.status==='customer_accepted_time'&&!historyRollback.paid&&historyRollback.payments===0,'historical_failure_rolls_completion_back');
  return Response.json({status:'PASS',checks,notifications:0,productionMutations:0});
 }catch(e){return Response.json({status:'FAIL',reason:e.message,checks},{status:500});}
 finally{
  const c=await pool.connect();try{await beginBookingTransaction(c,{key:'payment-fixture-cleanup'});await c.query('DELETE FROM master_wok_rehearsal.order_payment_events WHERE order_id=ANY($1::uuid[])',[ids]);await c.query('DELETE FROM master_wok_rehearsal.order_payments WHERE order_id=ANY($1::uuid[])',[ids]);await c.query("DELETE FROM master_wok_rehearsal.orders WHERE id=ANY($1::uuid[]) AND idempotency_key LIKE 'payment-certification-%'",[ids]);await c.query('COMMIT');}catch(_){await c.query('ROLLBACK');}finally{c.release();}
 }
});

