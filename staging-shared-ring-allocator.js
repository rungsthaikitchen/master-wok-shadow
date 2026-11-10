'use strict';
// Staging only. Four shared rings, two large woks, two small woks, five confirmed pans.
// Physical feasibility does not validate chef attention or approve bookings.
const CURRIES=new Set(['massaman-curry','panang-curry','rung-curry','green-curry','red-curry']);
const SMALL=new Set(['stir-basil','stir-ginger','stir-cashew','stir-sweetsour','stir-yellow','stir-chilli','stir-pepper']);
const PAN=new Set(['tom-yum','tom-kha','coconut-rice']);
const PANS=['pan-1','pan-2','pan-3','pan-4','pan-5'];
const SMALL_FINISH=new Set(['stir-crispy','salt-chicken','salt-chickenchips','salt-chips','egg-rice','coconut-rice']);
const NO_RING=new Set(['beef-salad','papaya-salad','pork-salad','laab']);
const LARGE=new Set(['pad-thai','chef-pad-thai','pad-kee-mao','pad-see-ew','fried-rice']);
function eligible(itemId){
 if(NO_RING.has(itemId))return ['cold-prep-1'];
 if(PAN.has(itemId))return PANS;
 if(SMALL_FINISH.has(itemId))return ['small-1','small-2','large-1','large-2'];
 if(CURRIES.has(itemId))return PANS;
 if(SMALL.has(itemId))return ['small-1','small-2','large-1','large-2'];
 if(LARGE.has(itemId))return ['large-1','large-2'];
 return null;
}
function allocateSharedRings(jobs,options={}){
 const fail=(reason)=>({status:'UNVERIFIED',reason,bookingApprovalAllowed:false});
 const maxNodes=options.maxSearchNodes??100000,maxChecks=options.maxCompleteChecks??128;
 if(!Number.isInteger(maxNodes)||maxNodes<1||maxNodes>100000||
  !Number.isInteger(maxChecks)||maxChecks<1||maxChecks>128)return fail('INVALID_SEARCH_BUDGET');
 if(!Array.isArray(jobs)||jobs.length>64)return fail('SIZE_LIMIT');
 const blackouts=options.blackouts??[];
 if(!Array.isArray(blackouts)||blackouts.some(b=>!b||!Number.isFinite(b.start)||
  !Number.isFinite(b.finish)||b.finish<=b.start))return fail('INVALID_BLACKOUT');
 const fixed=options.fixedWok??[];
 if(!Array.isArray(fixed)||fixed.some(j=>!j||!eligible(j.itemId)?.includes(j.vessel)||
  !Number.isInteger(j.start)||!Number.isInteger(j.finish)||j.start<990||j.finish>1320||j.finish<=j.start))
  return fail('INVALID_FIXED_WORK');
 const pending=[];
 for(const job of jobs){
  const vessels=eligible(job.itemId);
  if(!vessels)return fail('VESSEL_ELIGIBILITY_UNVERIFIED');
  if(!vessels.includes('cold-prep-1')&&job.portions!==undefined&&job.portions!==1)
   return fail('VESSEL_PORTION_CAPACITY_EXCEEDED');
    if(!Number.isInteger(job.duration)||job.duration<1||!Number.isInteger(job.earliest)||
    !Number.isInteger(job.latest)||job.earliest<990||job.latest+job.duration>1320||
    job.earliest>job.latest)return fail('INVALID_WINDOW');
  pending.push({...job,vessels});
 }
 pending.sort((a,b)=>(a.latest-a.earliest)-(b.latest-b.earliest)||
  a.readyMinute-b.readyMinute||(options.originalJobOrder===true?0:a.vessels.length-b.vessels.length));
 // Necessary workload bounds for this fixed batch partition. Reject an
 // overloaded interval before enumerating equivalent vessel permutations.
 for(const [capacity,group] of [[4,pending.filter(j=>!j.vessels.includes('cold-prep-1'))],
  [2,pending.filter(j=>j.vessels.every(v=>v.startsWith('large-')))]]){
  if(group.length&&group.reduce((n,j)=>n+j.duration,0)>
   capacity*(Math.max(...group.map(j=>j.latest+j.duration))-Math.min(...group.map(j=>j.earliest))))
   return fail('FIXED_RING_WORKLOAD_EXCEEDS_WINDOW');
 }
 const placed=[];let nodes=0,completeChecks=0,exhausted=false;
 const ringOccupancy=Array(1321).fill(0);
 function reserveRing(job,delta){
  if(job.vessel!=='cold-prep-1')for(let t=job.start;t<job.finish;t++)ringOccupancy[t]+=delta;
 }
 for(const job of fixed)reserveRing(job,1);
 function fits(vessel,start,finish){
  if(blackouts.some(b=>start<b.finish&&finish>b.start))return false;
  if([...fixed,...placed].some(j=>j.vessel===vessel&&start<j.finish+1&&finish+1>j.start))return false;
  if(vessel!=='cold-prep-1')for(let t=start;t<finish;t++)if(ringOccupancy[t]>=4)return false;
  return true;
 }
 function search(i){
  if(i===pending.length){
   if(typeof options.validateComplete!=='function')return true;
   if(++completeChecks>maxChecks){exhausted=true;return false;}
   return options.validateComplete(placed.map(j=>({...j})))===true;
  }
  if(++nodes>maxNodes){exhausted=true;return false;}
  const job=pending[i];
  const equivalent=new Set();
  const vessels=options.equivalentVessels===true?job.vessels.filter(vessel=>{
   const signature=JSON.stringify([vessel.replace(/-\d+$/,''),[...fixed,...placed]
    .filter(j=>j.vessel===vessel).map(j=>[j.start,j.finish]).sort((a,b)=>a[0]-b[0])]);
   if(equivalent.has(signature))return false;equivalent.add(signature);return true;
  }):job.vessels;
  for(let start=job.latest;start>=job.earliest;start--){
   const finish=start+job.duration;
   for(const vessel of vessels){
    if(!fits(vessel,start,finish))continue;
    placed.push({...job,start,finish,vessel,holdingMinutes:job.readyMinute-finish});
    reserveRing(placed[placed.length-1],1);
    // A necessary forward check avoids permuting unrelated pans while a
    // later constrained wok job already has no possible slot. It does not
    // claim that individually available slots can all be used together.
    const futureFits=pending.slice(i+1).every(next=>{
     for(let s=next.latest;s>=next.earliest;s--)
      if(next.vessels.some(v=>fits(v,s,s+next.duration)))return true;
     return false;
    });
    if(futureFits&&search(i+1))return true;
    reserveRing(placed.pop(),-1);
    if(exhausted)return false;
   }
  }
  return false;
 }
 if(!search(0)){
  // Fryer/microwave dependencies can favour the original ordering. Retain it
  // as a second bounded search rather than losing previously feasible baskets.
  if(exhausted&&options.originalJobOrder!==true)
   return allocateSharedRings(jobs,{...options,originalJobOrder:true});
  return fail(exhausted?'SEARCH_LIMIT':'NO_PHYSICAL_TIMELINE');
 }
 return {status:'PHYSICAL_FIT_PROTOTYPE',reason:'FOUR_SHARED_RINGS',
  jobs:placed.sort((a,b)=>a.start-b.start),ringCapacity:4,
  chefConcurrencyVerified:false,coldPrepCapacityAssumed:1,bookingApprovalAllowed:false};
}
module.exports={allocateSharedRings,eligible};

