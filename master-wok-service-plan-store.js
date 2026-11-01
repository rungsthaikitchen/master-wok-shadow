'use strict';
const {protectStartedWork}=require('./master-wok-protected-plan');
function createServicePlanStore({schema='public'}={}){
 if(!['public','master_wok_rehearsal'].includes(schema))throw Error('INVALID_PLAN_SCHEMA');
 const table='"'+schema+'".master_wok_service_plans';
 return {
  async read(connection,date){
   const row=(await connection.query(`SELECT plan FROM ${table} WHERE service_date=$1 FOR UPDATE`,[date])).rows[0];
   return row?.plan||null;
  },
  async save(connection,date,plan){
   protectStartedWork(plan,0); // Reject corrupt plan structure before persistence.
   await connection.query(`INSERT INTO ${table} AS current_plan(service_date,plan,revision) VALUES($1,$2::jsonb,1)
    ON CONFLICT(service_date) DO UPDATE SET plan=excluded.plan,
     revision=current_plan.revision+1,updated_at=clock_timestamp()`,[date,JSON.stringify(plan)]);
  }
 };
}
function remapPlanOrder(plan,oldId,newId){
 if(!plan||oldId===newId)return plan;
 const copy=structuredClone(plan);
 for(const job of [...copy.wok.jobs,...copy.fryer.jobs]){
  job.orderIds=job.orderIds.map(id=>id===oldId?newId:id);
  for(const a of [...job.portionAllocations||[],...job.allocations||[]])
   if(a.orderId===oldId)a.orderId=newId;
 }
 return copy;
}
module.exports={createServicePlanStore,remapPlanOrder};
