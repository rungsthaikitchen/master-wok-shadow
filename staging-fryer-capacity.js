'use strict';
// Staging-only conservative fryer feasibility prototype.
// One large basket (3 portions) and two small baskets (2 each).
// A four-minute fry cycle is a TEST ASSUMPTION, not an approved kitchen rule.
// No booking approval or production writes.
const {diagnoseFryer}=require('./staging-fryer-diagnostic');
const FRY_MINUTES=5;
const HOLD_MINUTES=10;
const BASKETS=[{id:'large',capacity:3},{id:'small-1',capacity:2},{id:'small-2',capacity:2}];
function assessFryer(orders,rows){
 const inventory=diagnoseFryer(orders,rows);
 if(inventory.unmodelled.length)
  return {status:'UNVERIFIED',reason:'FRY_ONLY_TIMING_UNKNOWN',inventory,bookingApprovalAllowed:false};
 const jobs=[];
 for(const d of inventory.dependencies)
  for(const [type,count] of Object.entries(d.counts))
   for(let i=0;i<count;i++)
    jobs.push({orderId:d.orderId,itemId:d.itemId,type,readyMinute:d.readyMinute});
 if(!jobs.length)
  return {status:'NO_RECOGNISED_FRY_DEPENDENCIES',jobs:[],bookingApprovalAllowed:false};
 // Conservatively reserve a separate cycle per portion. Never claim this
 // schedule coordinates with the wok: dependencies remain unverified.
 const busy=new Map(BASKETS.map(b=>[b.id,[]]));
 const planned=[];
 for(const job of jobs.sort((a,b)=>a.readyMinute-b.readyMinute)){
  let assigned=null;
  for(let start=job.readyMinute-FRY_MINUTES;start>=Math.max(990,job.readyMinute-HOLD_MINUTES-FRY_MINUTES);start--){
   for(const basket of BASKETS){
    if(busy.get(basket.id).some(x=>start<x.finish&&start+FRY_MINUTES>x.start))continue;
    assigned={...job,basket:basket.id,start,finish:start+FRY_MINUTES};
    break;
   }
   if(assigned)break;
  }
  if(!assigned)
   return {status:'UNVERIFIED',reason:'FRY_CAPACITY_UNVERIFIED',inventory,bookingApprovalAllowed:false};
  busy.get(assigned.basket).push(assigned);
  planned.push(assigned);
 }
 return {status:'FRY_ONLY_PROTOTYPE',reason:'WOK_DEPENDENCIES_NOT_LINKED',
  fryMinutesAssumption:FRY_MINUTES,holdingMinutesAssumption:HOLD_MINUTES,
  jobs:planned,inventory,bookingApprovalAllowed:false};
}
module.exports={assessFryer};
