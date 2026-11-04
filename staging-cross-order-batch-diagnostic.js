'use strict';
// Diagnostic only. Strict same-ready-time, same-item, same-modifier fast batches.
// Does not approve bookings or imply cross-order batching is production-ready.
const FAST_MINUTES={1:5,2:6,3:8,4:10};
function diagnostic(orders,rows){
 const byId=new Map(orders.map(o=>[String(o.orderId),o]));
 const groups=new Map();
 for(const row of rows){
   if(!byId.has(String(row.id))) continue;
   const order=byId.get(String(row.id));
   for(const line of row.items){
     if(line.item_id!=='panang-curry') continue; // intentionally narrow proof
     const mods=JSON.stringify(line.modifiers??[]);
     const key=JSON.stringify([order.readyMinute,line.item_id,mods]);
     if(!groups.has(key)) groups.set(key,{readyMinute:order.readyMinute,itemId:line.item_id,modifiers:mods,portions:0});
     groups.get(key).portions+=line.qty;
   }
 }
 const buckets=[];
 for(const g of groups.values()){
   const batches=[];let remaining=g.portions;
   while(remaining){const n=Math.min(4,remaining);batches.push({portions:n,minutes:FAST_MINUTES[n]});remaining-=n;}
   const totalMinutes=batches.reduce((n,b)=>n+b.minutes,0)+Math.max(0,batches.length-1);
   // Back-plan contiguous batches so the last one finishes exactly at ready time.
   // Each batch's finish is the holding clock start for its portions.
   let cursor=g.readyMinute;
   const backplanned=[...batches].reverse().map((batch,index)=>{
     const finish=cursor;
     const start=finish-batch.minutes;
     cursor=start-(index<batches.length-1?1:0);
     return {...batch,startMinute:start,finishMinute:finish,holdingMinutes:g.readyMinute-finish};
   }).reverse();
   const maximumHoldingMinutes=Math.max(...backplanned.map(b=>b.holdingMinutes));
   buckets.push({readyMinute:g.readyMinute,itemId:g.itemId,portions:g.portions,batches,backplanned,
     maximumHoldingMinutes,holdingLimitMinutes:10,withinHoldingLimit:maximumHoldingMinutes<=10,
     productionMinutesIncludingResets:totalMinutes,
     earliestFinishIfStartedAtReadyMinus10:g.readyMinute-10+totalMinutes,
     fitsTenMinuteHoldingWindow:totalMinutes<=10});
 }
 return {mode:'STRICT_PANANG_DIAGNOSTIC_ONLY',buckets};
}
module.exports={diagnostic};
