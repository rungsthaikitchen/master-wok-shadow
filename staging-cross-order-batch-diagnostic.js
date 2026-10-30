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
   buckets.push({readyMinute:g.readyMinute,itemId:g.itemId,portions:g.portions,batches,
     productionMinutesIncludingResets:totalMinutes,
     earliestFinishIfStartedAtReadyMinus10:g.readyMinute-10+totalMinutes,
     fitsTenMinuteHoldingWindow:totalMinutes<=10});
 }
 return {mode:'STRICT_PANANG_DIAGNOSTIC_ONLY',buckets};
}
module.exports={diagnostic};
