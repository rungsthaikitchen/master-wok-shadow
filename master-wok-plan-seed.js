'use strict';
// Operator-only pre-service migration of existing commitments. No HTTP route,
// customer booking, or booking authority is created by seeding a service plan.
const {beginBookingTransaction}=require('./master-wok-transaction-writer');
const {createLaunchControl}=require('./master-wok-launch-control');
const {createServicePlanStore}=require('./master-wok-service-plan-store');
const {readCapacityCommitments}=require('./master-wok-commitment-reader');
const {normalizeStagingOrders}=require('./staging-order-snapshot');
const {planWithProtectedWork,serviceMinute}=require('./master-wok-protected-plan');
const {relativePlacement,localDate}=require('./master-wok-clock');
const {readBookingAvailability}=require('./master-wok-availability-reader');

function createPlanSeeder({pool,model,releaseId,schema='public',readOrders=readCapacityCommitments,
 readAvailability=readBookingAvailability,planStore=createServicePlanStore({schema})}={}){
 if(!pool||typeof pool.connect!=='function'||!model||typeof readOrders!=='function')
  throw Error('INVALID_SEED_CONFIGURATION');
 const gate=createLaunchControl({schema,releaseId});
 return async function seed({serviceDate,expectedRevision,commit=false}={}){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate||'')||
   !Number.isFinite(new Date(serviceDate+'T12:00:00Z').getTime())||
   new Date(serviceDate+'T12:00:00Z').toISOString().slice(0,10)!==serviceDate||
   !Number.isSafeInteger(expectedRevision)||expectedRevision<0||typeof commit!=='boolean')
   return {ok:false,committed:false,reason:'INVALID_SEED_REQUEST'};
  let c;
  try{
   c=await pool.connect();
   await beginBookingTransaction(c,{serviceDates:[serviceDate]});
   const control=await gate.read(c);
   if(control.mode!=='LEGACY'||Number(control.revision)!==expectedRevision)
    throw Error('SEED_REQUIRES_EXPECTED_LEGACY_REVISION');
   const now=(await c.query('SELECT clock_timestamp() AS now')).rows[0]?.now;
   if(!now||!Number.isFinite(new Date(now).getTime()))throw Error('SEED_CLOCK_UNAVAILABLE');
   if(serviceMinute(now,serviceDate)>=990)throw Error('SEED_REQUIRES_PRE_SERVICE_WINDOW');
   if(await planStore.read(c,serviceDate))throw Error('SERVICE_PLAN_ALREADY_EXISTS');
   const rows=await readOrders(c,serviceDate);
   const orders=normalizeStagingOrders({rows,model,serviceDate})
    .map(o=>({...o,placedAt:relativePlacement(o.placedAt,serviceDate)}));
   const availability=await readAvailability(c,serviceDate),blackouts=[];
   if(!Array.isArray(availability?.blackouts))throw Error('SEED_AVAILABILITY_UNAVAILABLE');
   for(const b of availability.blackouts){
    if(b.active===false)continue;
    const start=new Date(b.start_at),end=new Date(b.end_at);
    if(!['closed','fully_booked'].includes(b.kind)||!Number.isFinite(start.getTime())||
     !Number.isFinite(end.getTime())||end<=start)throw Error('SEED_AVAILABILITY_UNAVAILABLE');
    if(b.kind!=='closed'||localDate(start)>serviceDate||localDate(end)<serviceDate)continue;
    const minute=t=>{const p=relativePlacement(t,serviceDate);return p.getHours()*60+p.getMinutes()+p.getSeconds()/60;};
    blackouts.push({start:localDate(start)<serviceDate?0:Math.floor(minute(start)),
     finish:localDate(end)>serviceDate?1440:Math.ceil(minute(end))});
   }
   const assessed=planWithProtectedWork({orders,rows,serviceDate,now,
    blackouts,standaloneSpringRolls:true,confirmedStarterRecipes:true,fryerWarmupMinutes:5});
   if(assessed.status!=='VALIDATED_PROTECTED_PLAN')throw Error('SEED_PLAN_NOT_VALIDATED');
   const plan=assessed.plan;
   if(commit)await planStore.save(c,serviceDate,plan);
   await c.query(commit?'COMMIT':'ROLLBACK');
   return {ok:true,committed:commit,serviceDate,releaseId,revision:expectedRevision,
    commitments:orders.length,modelVersion:plan.modelVersion,
    jobs:{wok:plan.wok.jobs.length,fryer:plan.fryer.jobs.length,auxiliary:plan.auxiliary.jobs.length},
    bookingApprovalAllowed:false};
  }catch(error){
   if(c)try{await c.query('ROLLBACK');}catch(_){}
   const known=new Set(['SEED_REQUIRES_EXPECTED_LEGACY_REVISION','SEED_CLOCK_UNAVAILABLE',
    'SEED_REQUIRES_PRE_SERVICE_WINDOW','SERVICE_PLAN_ALREADY_EXISTS','SEED_PLAN_NOT_VALIDATED','SEED_AVAILABILITY_UNAVAILABLE']);
   return {ok:false,committed:false,reason:known.has(error.message)?error.message:'SEED_UNAVAILABLE'};
  }finally{if(c)c.release();}
 };
}
module.exports={createPlanSeeder};
