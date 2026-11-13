'use strict';
const {lockServiceDates}=require('./master-wok-transaction-writer');
const {commitmentTimes}=require('./master-wok-commitment-reader');
const {localDate}=require('./master-wok-clock');
const {createServicePlanStore}=require('./master-wok-service-plan-store');
const {settleMasterWokLoyalty}=require('./master-wok-loyalty-settlement');
// Uses the caller's locked order and dedicated payment transaction. Never opens
// a second connection or commits: any later payment/audit failure rolls back all.
function createPaymentCompletion({schema='public',assessMutation,planStore=createServicePlanStore({schema}),settleLoyalty=settleMasterWokLoyalty}={}){
 if(!['public','master_wok_rehearsal'].includes(schema)||typeof assessMutation!=='function')throw Error('INVALID_PAYMENT_COMPLETION_CONFIGURATION');
 return async({connection,order})=>{
  if(order.status==='completed')return {status:'completed',alreadyCompleted:true};
  if(!['pending','accepted','confirmed','customer_accepted_time'].includes(order.status))throw Error('PAYMENT_COMPLETION_STATE_REFUSED');
  const now=(await connection.query('SELECT clock_timestamp() AS now')).rows[0]?.now;
  if(!now||!Number.isFinite(new Date(now).getTime()))throw Error('SERVER_CLOCK_REQUIRED');
  const after={...order,status:'completed',capacity_scheduler:'MASTER_WOK'};
  const dates=[...new Set([...commitmentTimes(order),...commitmentTimes(after)].map(localDate))].sort();
  await lockServiceDates(connection,dates);
  // An imported legacy service from a previous day cannot be reconstructed
  // by today's kitchen model. Finalise its bookkeeping only when no Master
  // Wok booking/plan owns that service. Pending loyalty settles atomically.
  const historicalLegacy=order.capacity_scheduler==='LEGACY'&&dates.length>0&&dates.every(date=>date<localDate(now))&&
   (!order.proposed_time||localDate(order.proposed_time)<localDate(now));
  if(historicalLegacy){
   const receipt=(await connection.query(`SELECT order_id FROM "${schema}".master_wok_booking_receipts WHERE order_id=$1`,[order.id])).rows[0];
   let hasPlan=false;for(const date of dates)if(await planStore.read(connection,date))hasPlan=true;
   if(!receipt&&!hasPlan){
    await connection.query(`UPDATE "${schema}".orders SET status='completed' WHERE id=$1`,[order.id]);
    const loyalty=order.loyalty_settled===true?{handled:true,settled:true}:await settleLoyalty(connection,{...order,status:'completed'},{schema,allowLegacy:true});
    if(!order.is_test&&(!loyalty.handled||!loyalty.settled))throw Error('HISTORICAL_PAYMENT_LOYALTY_REVIEW_REQUIRED');
    return {status:'completed',...(loyalty.handled?{loyalty_settled:loyalty.settled}:{}),historicalCompletion:true,previousStatus:order.status,capacityScheduler:'LEGACY'};
   }
  }
  await connection.query(`UPDATE "${schema}".orders SET status='completed',capacity_scheduler='MASTER_WOK' WHERE id=$1`,[order.id]);
  const assessment=await assessMutation({connection,before:order,after,dates,now,action:'complete'});
  if(assessment?.status!=='GREEN'||assessment.bookingApprovalAllowed!==true||dates.some(date=>!assessment.plansByDate?.[date]))throw Error('PAYMENT_COMPLETION_NOT_VERIFIED');
  for(const date of dates)await planStore.save(connection,date,assessment.plansByDate[date]);
  const loyalty=await settleLoyalty(connection,after,{schema,allowLegacy:true});
  return {status:'completed',...(loyalty.handled?{loyalty_settled:loyalty.settled}:{})};
 };
}
module.exports={createPaymentCompletion};
