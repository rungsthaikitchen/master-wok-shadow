'use strict';
const {beginBookingTransaction,lockServiceDates}=require('./master-wok-transaction-writer');
const {commitmentTimes}=require('./master-wok-commitment-reader');
const {localDate}=require('./master-wok-clock');
const {createServicePlanStore}=require('./master-wok-service-plan-store');
const {settleMasterWokLoyalty}=require('./master-wok-loyalty-settlement');
const {enqueueNotification,lifecycleNotification}=require('./master-wok-notification-events');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const mutableStatus=new Set(['pending','accepted','confirmed','cancelled','completed']);
function actionPatch(order,input,{actor,now,tokenFactory=()=>crypto.randomUUID().replaceAll('-','')}={}){
 const action=input.action;
 if(actor==='customer'){
  if(!['customer_accept','customer_decline'].includes(action)||order.status!=='proposed'||
    !order.confirm_token||input.token!==order.confirm_token||!order.proposed_time)
   throw Error('INVALID_OR_EXPIRED_TIME_RESPONSE');
  return action==='customer_accept'?{status:'customer_accepted_time',confirmed_time:order.proposed_time,confirm_token:null}:
   {status:'customer_declined_time',confirm_token:null};
 }
 if(actor!=='admin')throw Error('UNAUTHORIZED_ACTOR');
 switch(action){
  case 'accept':
   if(order.status==='proposed')throw Error('CUSTOMER_TIME_ACKNOWLEDGEMENT_REQUIRED');
   if(['cancelled','completed'].includes(order.status))throw Error('EXPLICIT_REOPEN_REQUIRED');
   if(!order.confirmed_time&&!order.preferred_time)throw Error('NO_BOOKED_TIME');
   return {status:'confirmed',confirmed_time:order.confirmed_time||order.preferred_time,confirm_token:null};
  case 'decline':return {status:'cancelled',confirm_token:null};
  case 'suggest_time':{
   if(['cancelled','completed'].includes(order.status))throw Error('EXPLICIT_REOPEN_REQUIRED');
   if(typeof input.proposedTime!=='string'||!/(Z|[+-]\d\d:\d\d)$/.test(input.proposedTime)||
     !Number.isFinite(Date.parse(input.proposedTime)))throw Error('INVALID_PROPOSED_TIME');
   // New scheduler never converts a suggestion into a customer acknowledgement,
   // including historical orders that once used the ASAP flow.
   const token=tokenFactory();if(!/^[a-f0-9]{32,64}$/.test(token))throw Error('INVALID_RESPONSE_TOKEN');
   return {status:'proposed',proposed_time:new Date(input.proposedTime).toISOString(),confirm_token:token};
  }
  case 'mark_paid':return {paid:true,payment_status:'paid',paid_at:new Date(now).toISOString()};
  case 'complete':return {status:'completed'};
  case 'set_status':
   if(!mutableStatus.has(input.status))throw Error('UNSUPPORTED_STATUS');
   if(order.status==='proposed'&&['confirmed','accepted'].includes(input.status))
    throw Error('CUSTOMER_TIME_ACKNOWLEDGEMENT_REQUIRED');
   return {status:input.status};
  case 'set_test':
   if(typeof input.isTest!=='boolean')throw Error('INVALID_TEST_FLAG');
   return {is_test:input.isTest};
  default:throw Error('UNKNOWN_ORDER_ACTION');
 }
}
function createLifecycleWriter({pool,assessMutation,mode='LEGACY',schema='public',assertWriteAllowed=async()=>{}}={}){
 if(!pool||typeof pool.connect!=='function'||typeof assessMutation!=='function'||
  !['public','master_wok_rehearsal'].includes(schema))throw Error('INVALID_LIFECYCLE_CONFIGURATION');
 const planStore=createServicePlanStore({schema});
 const orders='"'+schema+'".orders',receipts='"'+schema+'".master_wok_time_responses';
 async function mutate(input,actor){
  const fail=(reason,statusCode=409)=>({success:false,committed:false,reason,statusCode});
  if(mode==='LEGACY')return {success:false,committed:false,reason:'USE_EXISTING_LIFECYCLE',statusCode:409};
  if(mode!=='MASTER_WOK')return fail('INVALID_BOOKING_MODE',503);
  if(!input||!UUID.test(input.orderId||'')||
    (actor==='customer'&&!/^[a-f0-9]{32,64}$/.test(input.token||'')))return fail('INVALID_REQUEST',400);
  let connection;
  try{connection=await pool.connect();}catch(_){return fail('DATABASE_UNAVAILABLE',503);}
  try{
   await beginBookingTransaction(connection,{key:'order:'+input.orderId});
   await assertWriteAllowed(connection);
   if(actor==='customer'){
    const prior=(await connection.query(`SELECT order_id,decision,response FROM ${receipts} WHERE token=$1`,[input.token])).rows[0];
    if(prior){
     await connection.query('ROLLBACK');
     return String(prior.order_id)===input.orderId&&prior.decision===input.action?
      {...prior.response,replayed:true,committed:false}:fail('TIME_RESPONSE_CONFLICT');
    }
   }
   const order=(await connection.query(`SELECT * FROM ${orders} WHERE id=$1 FOR UPDATE`,[input.orderId])).rows[0];
   if(!order){await connection.query('ROLLBACK');return fail('ORDER_NOT_FOUND',404);}
   const now=(await connection.query('SELECT clock_timestamp() AS now')).rows[0]?.now;
   if(!now||!Number.isFinite(new Date(now).getTime()))throw Error('SERVER_CLOCK_REQUIRED');
   const patch={...actionPatch(order,input,{actor,now}),capacity_scheduler:'MASTER_WOK'};
   const after={...order,...patch};
   const dates=[...new Set([...commitmentTimes(order),...commitmentTimes(after)].map(localDate))].sort();
   await lockServiceDates(connection,dates);
   const fields=Object.keys(patch);
   await connection.query(`UPDATE ${orders} SET ${fields.map((k,i)=>'"'+k+'"=$'+(i+2)).join(',')} WHERE id=$1`,
    [input.orderId,...fields.map(k=>patch[k])]);
   // This runs after the tentative update but before COMMIT, so the existing
   // assessor sees the exact state that would become authoritative.
   const assessment=await assessMutation({connection,before:order,after,dates,now,action:input.action});
   if(assessment?.status!=='GREEN'||assessment.bookingApprovalAllowed!==true){
    await connection.query('ROLLBACK');return fail(assessment?.reason||'UNCERTIFIED_LIFECYCLE_ASSESSMENT');
   }
   if(dates.some(date=>!assessment.plansByDate?.[date]))throw Error('VALIDATED_SERVICE_PLANS_REQUIRED');
   for(const date of dates)await planStore.save(connection,date,assessment.plansByDate[date]);
   const loyalty=await settleMasterWokLoyalty(connection,after,{schema});
   const event=lifecycleNotification(order,after,input);
   if(event)await enqueueNotification(connection,{schema,order:after,...event});
   const response={success:true,notification_managed:true,status:after.status,orderId:input.orderId,
    ...(loyalty.handled?{loyalty_settled:loyalty.settled}:{}),
    ...(actor==='customer'?{title:'Thank you',message:input.action==='customer_accept'?
     'Your proposed collection/delivery time has been accepted.':'We have noted that this time does not work for you. Please contact the restaurant to arrange another time.'}:{})};
   if(actor==='customer')await connection.query(`INSERT INTO ${receipts}(token,order_id,decision,response) VALUES($1,$2,$3,$4::jsonb)`,
    [input.token,input.orderId,input.action,JSON.stringify(response)]);
   await connection.query('COMMIT');
   return {...response,committed:true};
  }catch(error){
   try{await connection.query('ROLLBACK');}catch(_){}
   const known=new Set(['INVALID_OR_EXPIRED_TIME_RESPONSE','CUSTOMER_TIME_ACKNOWLEDGEMENT_REQUIRED',
    'EXPLICIT_REOPEN_REQUIRED','NO_BOOKED_TIME','INVALID_PROPOSED_TIME','UNSUPPORTED_STATUS','INVALID_TEST_FLAG','UNKNOWN_ORDER_ACTION']);
   return fail(known.has(error.message)?error.message:'LIFECYCLE_TRANSACTION_FAILED');
  }finally{connection.release();}
 }
 return {adminAction:input=>mutate(input,'admin'),customerResponse:input=>mutate(input,'customer')};
}
module.exports={createLifecycleWriter,actionPatch};
