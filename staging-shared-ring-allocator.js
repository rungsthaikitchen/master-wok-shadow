'use strict';
// Staging only. Four shared rings, two large woks, two small woks, three confirmed pans.
// Physical feasibility does not validate chef attention or approve bookings.
const CURRIES=new Set(['massaman-curry','panang-curry','rung-curry','green-curry','red-curry']);
const SMALL=new Set(['stir-basil','stir-ginger','stir-cashew','stir-sweetsour','stir-yellow','stir-chilli','stir-pepper']);
const PAN=new Set(['tom-yum','tom-kha']);
const SMALL_FINISH=new Set(['stir-crispy','salt-chicken','salt-chickenchips','salt-chips','egg-rice','coconut-rice']);
const NO_RING=new Set(['beef-salad','papaya-salad','pork-salad','laab']);
const LARGE=new Set(['pad-thai','chef-pad-thai','pad-kee-mao','pad-see-ew','fried-rice']);
function eligible(itemId){
 if(NO_RING.has(itemId))return [];
 if(PAN.has(itemId))return ['pan-1','pan-2','pan-3'];
 if(SMALL_FINISH.has(itemId))return ['small-1','small-2','large-1','large-2'];
 if(CURRIES.has(itemId))return ['pan-1','pan-2','pan-3'];
 if(SMALL.has(itemId))return ['small-1','small-2','large-1','large-2'];
 if(LARGE.has(itemId))return ['large-1','large-2'];
 return null;
}
function allocateSharedRings(jobs){
 const fail=(reason)=>({status:'UNVERIFIED',reason,bookingApprovalAllowed:false});
 if(!Array.isArray(jobs)||jobs.length>32)return fail('SIZE_LIMIT');
 const pending=[];
 for(const job of jobs){
  const vessels=eligible(job.itemId);
  if(!vessels)return fail('VESSEL_ELIGIBILITY_UNVERIFIED');
  if(vessels.length===0)return fail('NON_RING_WORK_REQUIRES_SEPARATE_CAPACITY_MODEL');
  if(!Number.isInteger(job.duration)||job.duration<1||!Number.isInteger(job.earliest)||
    !Number.isInteger(job.latest)||job.earliest<990||job.latest+job.duration>1320||
    job.earliest>job.latest)return fail('INVALID_WINDOW');
  pending.push({...job,vessels});
 }
 pending.sort((a,b)=>(a.latest-a.earliest)-(b.latest-b.earliest)||a.readyMinute-b.readyMinute);
 const placed=[];let nodes=0,exhausted=false;
 function fits(vessel,start,finish){
  if(placed.some(j=>j.vessel===vessel&&start<j.finish+1&&finish+1>j.start))return false;
  for(let t=start;t<finish;t++)if(placed.filter(j=>j.start<=t&&t<j.finish).length>=4)return false;
  return true;
 }
 function search(i){
  if(i===pending.length)return true;
  if(++nodes>100000){exhausted=true;return false;}
  const job=pending[i];
  for(let start=job.latest;start>=job.earliest;start--){
   const finish=start+job.duration;
   for(const vessel of job.vessels){
    if(!fits(vessel,start,finish))continue;
    placed.push({...job,start,finish,vessel,holdingMinutes:job.readyMinute-finish});
    if(search(i+1))return true;
    placed.pop();
    if(exhausted)return false;
   }
  }
  return false;
 }
 if(!search(0))return fail(exhausted?'SEARCH_LIMIT':'NO_PHYSICAL_TIMELINE');
 return {status:'PHYSICAL_FIT_PROTOTYPE',reason:'FOUR_SHARED_RINGS',
  jobs:placed.sort((a,b)=>a.start-b.start),ringCapacity:4,
  chefConcurrencyVerified:false,bookingApprovalAllowed:false};
}
module.exports={allocateSharedRings,eligible};
