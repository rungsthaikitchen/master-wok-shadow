'use strict';
// Staging-only prerequisite scheduler: reserve fryer cycles BEFORE a known wok start.
// This is a conservative diagnostic, not a joint optimiser or booking approval.
const {diagnoseFryer}=require('./staging-fryer-diagnostic');
const BASKETS=[{id:'large',capacity:3},{id:'small-1',capacity:2},{id:'small-2',capacity:2}];
const FRY_MINUTES=5,MAX_EARLY_MINUTES=10,PRODUCTION_START=990;
function planFryerBeforeWok(orders,rows,wokPlan){
 const inventory=diagnoseFryer(orders,rows);
 if(inventory.unmodelled.length)return {status:'UNVERIFIED',reason:'FRY_RECIPES_UNMODELLED',inventory,jobs:[],bookingApprovalAllowed:false};
 if(!wokPlan||wokPlan.status!=='FEASIBLE_PROTOTYPE')
  return {status:'UNVERIFIED',reason:'WOK_PLAN_UNVERIFIED',inventory,jobs:[],bookingApprovalAllowed:false};
 const placements=new Map(orders.map(o=>[String(o.orderId),o.placedAt instanceof Date\n  ?o.placedAt.getHours()*60+o.placedAt.getMinutes():NaN]));\n const portions=[];
 for(const dep of inventory.dependencies){
  const matches=(wokPlan.jobs||[]).filter(w=>w.itemId===dep.itemId&&(w.orderIds||[]).includes(dep.orderId));
  // We cannot safely map a portion to a particular wok batch if ambiguous.
  if(matches.length!==1)return {status:'UNVERIFIED',reason:'FRY_WOK_BATCH_MAPPING_UNVERIFIED',inventory,jobs:[],bookingApprovalAllowed:false};
  for(const [type,count] of Object.entries(dep.counts))
   for(let i=0;i<count;i++)portions.push({orderId:dep.orderId,itemId:dep.itemId,type,deadline:matches[0].start});
 }
 const groups=new Map();
 for(const p of portions){
  const key=JSON.stringify([p.type,p.deadline]);
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push(p);
 }
 const occupied=new Map(BASKETS.map(b=>[b.id,[]])),jobs=[];
 for(const group of [...groups.values()].sort((a,b)=>a[0].deadline-b[0].deadline)){
  const remaining=[...group];
  while(remaining.length){
   let chosen=null;
   for(let start=group[0].deadline-FRY_MINUTES;start>=Math.max(PRODUCTION_START,group[0].deadline-FRY_MINUTES-MAX_EARLY_MINUTES);start--){
    for(const basket of BASKETS){
     if(occupied.get(basket.id).some(j=>start<j.finish&&start+FRY_MINUTES>j.start))continue;
     const size=Math.min(basket.capacity,remaining.length);
     if(!chosen||size>chosen.size)chosen={basket,start,size};
    }
    if(chosen&&chosen.size===Math.min(3,remaining.length))break;
   }
   if(!chosen)return {status:'UNVERIFIED',reason:'FRY_BEFORE_WOK_CAPACITY_UNVERIFIED',inventory,jobs:[],bookingApprovalAllowed:false};
   const assigned=remaining.slice(0,chosen.size);\n   if(assigned.some(p=>!Number.isFinite(placements.get(String(p.orderId)))||chosen.start<placements.get(String(p.orderId))))\n    return {status:'UNVERIFIED',reason:'FRY_BEFORE_ORDER_PLACED',inventory,jobs:[],bookingApprovalAllowed:false};\n   remaining.splice(0,chosen.size);
   const job={type:assigned[0].type,basket:chosen.basket.id,portions:assigned.length,
    orderIds:[...new Set(assigned.map(p=>p.orderId))],itemIds:[...new Set(assigned.map(p=>p.itemId))],
    start:chosen.start,finish:chosen.start+FRY_MINUTES,wokStart:assigned[0].deadline};
   occupied.get(chosen.basket.id).push(job);jobs.push(job);
  }
 }
 return {status:'PREREQUISITES_PLACED_PROTOTYPE',reason:'NOT_JOINTLY_OPTIMISED',
  jobs:jobs.sort((a,b)=>a.start-b.start),inventory,bookingApprovalAllowed:false};
}
module.exports={planFryerBeforeWok};
