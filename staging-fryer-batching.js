'use strict';
// Staging-only fryer batch prototype. One large basket (3), two small (2 each).
// Durations are provisional and MUST be confirmed with the kitchen.
// Does not coordinate with the wok or approve bookings.
const {diagnoseFryer}=require('./staging-fryer-diagnostic');
const BASKETS=[{id:'large',capacity:3},{id:'small-1',capacity:2},{id:'small-2',capacity:2}];
const FRY_MINUTES=5, HOLD_MINUTES=10, OPEN_MINUTE=990;
function batchFryer(orders,rows){
 const inventory=diagnoseFryer(orders,rows);
 if(inventory.unmodelled.length)
  return {status:'UNVERIFIED',reason:'FRY_RECIPES_UNMODELLED',inventory,jobs:[],bookingApprovalAllowed:false};
 const portions=[];
 for(const d of inventory.dependencies)
  for(const [type,count] of Object.entries(d.counts))
   for(let i=0;i<count;i++)
    portions.push({type,orderId:d.orderId,itemId:d.itemId,readyMinute:d.readyMinute});
 const buckets=new Map();
 for(const p of portions){
  const key=JSON.stringify([p.type,p.readyMinute]);
  if(!buckets.has(key))buckets.set(key,[]);
  buckets.get(key).push(p);
 }
 const busy=new Map(BASKETS.map(b=>[b.id,[]]));
 const jobs=[];
 for(const group of [...buckets.values()].sort((a,b)=>a[0].readyMinute-b[0].readyMinute)){
  let remaining=[...group];
  while(remaining.length){
   let chosen=null;
   for(let t=group[0].readyMinute-FRY_MINUTES;t>=Math.max(OPEN_MINUTE,group[0].readyMinute-FRY_MINUTES-HOLD_MINUTES);t--){
    for(const basket of BASKETS){
     if(busy.get(basket.id).some(j=>t<j.finish&&t+FRY_MINUTES>j.start))continue;
     const size=Math.min(basket.capacity,remaining.length);
     if(!chosen||size>chosen.size)chosen={basket,t,size};
    }
    if(chosen&&chosen.size===Math.min(3,remaining.length))break;
   }
   if(!chosen)return {status:'UNVERIFIED',reason:'FRY_CAPACITY_UNVERIFIED',inventory,jobs:[],bookingApprovalAllowed:false};
   const allocated=remaining.splice(0,chosen.size);
   const job={type:allocated[0].type,basket:chosen.basket.id,portions:allocated.length,
    orderIds:[...new Set(allocated.map(p=>p.orderId))],
    itemIds:[...new Set(allocated.map(p=>p.itemId))],
    readyMinute:allocated[0].readyMinute,start:chosen.t,finish:chosen.t+FRY_MINUTES};
   busy.get(chosen.basket.id).push(job);jobs.push(job);
  }
 }
 return {status:'FRY_BATCH_PROTOTYPE',reason:'WOK_DEPENDENCIES_NOT_LINKED',
  jobs:jobs.sort((a,b)=>a.start-b.start),inventory,bookingApprovalAllowed:false};
}
module.exports={batchFryer};
