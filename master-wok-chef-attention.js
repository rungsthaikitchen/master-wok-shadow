'use strict';
// Offline diagnostic only. Equipment occupancy is not a measured staffing model.
// Profiles are explicitly supplied by the kitchen; no recipe timings are invented.
function assessChefAttention(plan,{profiles={},capacities={}}={}){
 const tasks=[],unprofiled=[];
 for(const resource of ['wok','fryer','auxiliary']){
  if(!Array.isArray(plan?.[resource]?.jobs))throw Error('INCOMPLETE_KITCHEN_PLAN');
  plan[resource].jobs.forEach((job,index)=>{
   if(!Number.isFinite(job.start)||!Number.isFinite(job.finish)||job.finish<=job.start)throw Error('INVALID_JOB_INTERVAL');
   const operation=job.itemId||job.type;
   if(!operation)throw Error('MISSING_OPERATION_ID');
   const task={id:`${resource}:${index}`,resource,itemId:operation,itemIds:job.itemIds||[operation],start:job.start,finish:job.finish,orderIds:job.orderIds||[]};
   const profile=Object.hasOwn(profiles,`${resource}:${operation}`)?profiles[`${resource}:${operation}`]:null;
   if(!profile){unprofiled.push(task);return;}
   if(!Array.isArray(profile.phases))throw Error('INVALID_ATTENTION_PROFILE');
   // An empty list is an explicit claim that the job needs no attention.
   for(const phase of profile.phases){
    const end=phase.finishOffset==='finish'?job.finish-job.start:phase.finishOffset;
    if(!phase.role||!Number.isFinite(phase.startOffset)||!Number.isFinite(end)||phase.startOffset<0||end<=phase.startOffset||end>job.finish-job.start)throw Error('INVALID_ATTENTION_PHASE');
    tasks.push({...task,start:job.start+phase.startOffset,finish:job.start+end,role:phase.role});
   }
  });
 }
 for(const capacity of Object.values(capacities))if(!Number.isFinite(capacity)||capacity<=0)throw Error('INVALID_CHEF_CAPACITY');
 const bounds=[...new Set(tasks.flatMap(t=>[t.start,t.finish]))].sort((a,b)=>a-b),intervals=[];
 for(let i=0;i<bounds.length-1;i++){
  const start=bounds[i],finish=bounds[i+1];
  for(const role of new Set(tasks.map(t=>t.role))){
   // Union phases belonging to one job, so overlapping annotations cannot count twice.
   const jobs=[...new Map(tasks.filter(t=>t.role===role&&t.start<finish&&t.finish>start).map(t=>[t.id,t])).values()];
   if(jobs.length)intervals.push({start,finish,role,demand:jobs.length,capacity:capacities[role]??null,overCapacity:capacities[role]===undefined?null:jobs.length>capacities[role],jobs:jobs.map(({id,itemId,orderIds,resource})=>({id,itemId,orderIds,resource}))});
  }
 }
 const missingRoles=[...new Set(tasks.map(t=>t.role))].filter(role=>capacities[role]===undefined);
 return {status:unprofiled.length||missingRoles.length?'INCOMPLETE_ATTENTION_MODEL':intervals.some(i=>i.overCapacity)?'REQUIRES_KITCHEN_REVIEW':'WITHIN_SUPPLIED_ASSUMPTIONS',unprofiled,missingRoles,intervals,bookingApprovalAllowed:false,chefAttentionModelValidated:false};
}
module.exports={assessChefAttention};
