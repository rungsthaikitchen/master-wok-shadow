'use strict';
// Read-only cross-order scheduler prototype. Strictly identical Panang lines,
// same promised time and modifiers; all other workloads remain UNVERIFIED.
// No database writes and no booking approval.
const DURATIONS={1:5,2:6,3:8,4:10};
const HOLD_MINUTES=20;
function scheduleCrossOrderPanang(orders,rows) {
 const known=new Map(orders.map(o=>[String(o.orderId),o]));
 const groups=new Map(),unsupported=[];
 for(const row of rows) {
   const order=known.get(String(row.id));
   if(!order) continue;
   for(const line of row.items||[]) {
     if(line.item_id==='jasmine-rice') continue;
     if(line.item_id!=='panang-curry'||!Number.isInteger(line.qty)||line.qty<=0||
       !Array.isArray(line.modifiers)) {
       unsupported.push(String(row.id));continue;
     }
     const key=JSON.stringify([order.readyMinute,line.item_id,line.modifiers]);
     if(!groups.has(key))groups.set(key,{readyMinute:order.readyMinute,portions:[],key});
     const g=groups.get(key);
     for(let i=0;i<line.qty;i++)g.portions.push({orderId:String(row.id),placedAt:order.placedAt});
   }
 }
 if(unsupported.length)return {status:'UNVERIFIED',reason:'UNSUPPORTED_MIXED_PRODUCTION',unsupported};
 const jobs=[];
 for(const g of groups.values()) {
   const portions=[...g.portions].sort((a,b)=>a.placedAt-b.placedAt);
   // Conservative: only portions already placed by batch start can participate.
   // Start with maximal groups; do not claim optimality if they cannot fit.
   const batches=[];
   for(let i=0;i<portions.length;i+=4)batches.push(portions.slice(i,i+4));
   let cursor=g.readyMinute;
   const planned=[];
   for(let i=batches.length-1;i>=0;i--) {
     const batch=batches[i],duration=DURATIONS[batch.length];
     const finish=cursor,start=finish-duration;
     const latestPlacement=Math.max(...batch.map(p=>p.placedAt.getHours()*60+p.placedAt.getMinutes()));
     const holding=g.readyMinute-finish;
     planned.unshift({start,finish,readyMinute:g.readyMinute,portions:batch.length,
       orderIds:[...new Set(batch.map(p=>p.orderId))],holdingMinutes:holding,
       placementSatisfied:latestPlacement<=start,holdingSatisfied:holding<=HOLD_MINUTES});
     cursor=start-1;
   }
   jobs.push(...planned);
 }
 const chronological=[...jobs].sort((a,b)=>a.start-b.start);
 const noOverlap=chronological.every((j,i)=>i===0||j.start>=chronological[i-1].finish+1);
 const feasible=noOverlap&&chronological.every(j=>j.placementSatisfied&&j.holdingSatisfied);
 return {status:feasible?'FEASIBLE_PROTOTYPE':'UNVERIFIED',
   reason:feasible?'STRICT_PANANG_BATCH_PLAN':'BATCH_CONSTRAINT_FAILED',
   holdingLimitMinutes:HOLD_MINUTES,productionBatches:chronological.length,
   jobs:chronological,noOverlap,bookingApprovalAllowed:false};
}
module.exports={scheduleCrossOrderPanang};
