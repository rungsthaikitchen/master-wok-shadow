'use strict';
// Offline observations only: overlapping cooking is not exclusive labour time.
const CURRIES=new Set(['massaman-curry','panang-curry','rung-curry','green-curry','red-curry']);
function curryRecipe(job){
 try{
  const key=JSON.parse(job.recipeKey);
  if(!Array.isArray(key)||key.length!==5||key[1]!==job.itemId||!Array.isArray(key[2]))return null;
  // Keep the complete canonical recipe, including protein, extras, spice and
  // notes. Customer handover time is not part of the recipe identity.
  return {identity:JSON.stringify(key.slice(1)),modifiers:key[2],spice:key[3],note:key[4]};
 }catch(_){return null;}
}
function curryGroups(jobs){
 const groups=new Map();
 jobs.forEach((job,index)=>{
  const recipe=curryRecipe(job),key=recipe?.identity??`unknown:${index}`;
  if(!groups.has(key))groups.set(key,{itemId:job.itemId,recipe,panCount:0,cooks:[]});
  const group=groups.get(key);group.panCount++;group.cooks.push({start:job.start,finish:job.finish});
 });
 return [...groups.values()].map(group=>({...group,potentialSharedWork:group.recipe!==null&&group.panCount>1,sharedMinutes:null,distinctPanReservationsRetained:true}));
}
function reviewWorkload(plan){
 if(!Array.isArray(plan?.wok?.jobs))throw Error('MISSING_COOKING_PLAN');
 const jobs=plan.wok.jobs;
 if(jobs.some(j=>!Number.isFinite(j.start)||!Number.isFinite(j.finish)||j.finish<=j.start))throw Error('INVALID_COOKING_INTERVAL');
 const boundaries=[...new Set(jobs.flatMap(j=>[j.start,j.finish]))].sort((a,b)=>a-b),intervals=[];
 for(let i=0;i<boundaries.length-1;i++){
  const start=boundaries[i],finish=boundaries[i+1],active=jobs.filter(j=>j.start<finish&&j.finish>start);
  const curries=active.filter(j=>CURRIES.has(j.itemId)),salads=active.filter(j=>j.vessel==='cold-prep-1');
  const woks=active.filter(j=>/^(small|large)-/.test(j.vessel));
  if(!salads.length&&!curries.length)continue;
  intervals.push({start,finish,chef:'Rung',curries:curries.length,salads:salads.length,woks:woks.length,
   curryGroups:curryGroups(curries),
   reviewReasons:[...(salads.length&&(curries.length||woks.length)?['SALAD_AND_HOT_WORK_SHARE_CHEF']:[]),...(curries.length>1?['CONCURRENT_CURRY_ATTENTION_UNCALIBRATED']:[])],
   // This is the estimate over each complete five-minute cook, not the
   // attention required within this smaller overlap interval. Do not add
   // simultaneous estimates as if their effort were necessarily independent.
   curryEstimates:curries.map(j=>({itemId:j.itemId,cookStart:j.start,cookFinish:j.finish,handsOnMinutes:j.finish-j.start===5?{minimum:3,maximum:4}:null,estimateScope:'WHOLE_COOK',sharedEffortUnknown:true})),
   dishes:active.map(j=>({itemId:j.itemId,vessel:j.vessel,start:j.start,finish:j.finish}))});
 }
 return {status:'KITCHEN_CALIBRATION_REQUIRED',bookingApprovalAllowed:false,chefAttentionModelValidated:false,
  exclusiveLabourCapacityAssumed:false,intervals};
}
module.exports={reviewWorkload,curryGroups};
