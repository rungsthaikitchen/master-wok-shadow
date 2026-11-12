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
  await connection.query(`UPDATE "${schema}".orders SET status='completed',capacity_scheduler='MASTER_WOK' WHERE id=$1`,[order.id]);
  const assessment=await assessMutation({connection,before:order,after,dates,now,action:'complete'});
  if(assessment?.status!=='GREEN'||assessment.bookingApprovalAllowed!==true||dates.some(date=>!assessment.plansByDate?.[date]))throw Error('PAYMENT_COMPLETION_NOT_VERIFIED');
  for(const date of dates)await planStore.save(connection,date,assessment.plansByDate[date]);
  const loyalty=await settleLoyalty(connection,after,{schema,allowLegacy:true});
  return {status:'completed',...(loyalty.handled?{loyalty_settled:loyalty.settled}:{})};
 };
}
module.exports={createPaymentCompletion};
