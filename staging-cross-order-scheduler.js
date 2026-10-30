'use strict';
// Read-only cross-order scheduler prototype. Strictly identical compatible dish lines,
// same promised time and modifiers; fryer-dependent dishes remain UNVERIFIED.
// No database writes and no booking approval.
const DURATIONS={1:5,2:6,3:8,4:10};
const HOLD_MINUTES=20;
const NO_WOK=new Set(['jasmine-rice','sticky-rice']);
const DURATION_BY_GROUP={fast:{1:5,2:6,3:8,4:10},noodle:{1:8,2:10},salad:{1:10,2:10,3:15,4:15}};
const MAX_BY_GROUP={fast:4,noodle:2,salad:4};
const CURRIES=new Set(['massaman-curry','panang-curry','rung-curry','green-curry','red-curry']);
function productionGroup(itemId){
 if(CURRIES.has(itemId)||['tom-yum','tom-kha','stir-basil','stir-ginger','stir-cashew','stir-sweetsour','stir-yellow','stir-chilli','stir-pepper','egg-rice','coconut-rice'].includes(itemId))return 'fast';
 if(['pad-thai','chef-pad-thai','pad-kee-mao','pad-see-ew','fried-rice'].includes(itemId))return 'noodle';
 if(['papaya-salad','beef-salad','pork-salad','laab'].includes(itemId))return 'salad';
 return null;
}
function scheduleCrossOrderPanang(orders,rows) {
 const known=new Map(orders.map(o=>[String(o.orderId),o]));
 const groups=new Map(),unsupported=[];
 for(const row of rows) {
   const order=known.get(String(row.id));
   if(!order) continue;
   for(const line of row.items||[]) {
     if(NO_WOK.has(line.item_id)) continue;
     const group=productionGroup(line.item_id);
     if(!group||!Number.isInteger(line.qty)||line.qty<=0||
       !Array.isArray(line.modifiers)) {
       unsupported.push(String(row.id));continue;
     }
     const key=JSON.stringify([order.readyMinute,line.item_id,line.modifiers]);
     if(!groups.has(key))groups.set(key,{readyMinute:order.readyMinute,portions:[],key,group,itemId:line.item_id});
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
   const max=MAX_BY_GROUP[g.group];
   for(let i=0;i<portions.length;i+=max)batches.push(portions.slice(i,i+max));
   let cursor=g.readyMinute;
   const planned=[];
   for(let i=batches.length-1;i>=0;i--) {
     const batch=batches[i],duration=DURATION_BY_GROUP[g.group][batch.length];
     const finish=cursor,start=finish-duration;
     const latestPlacement=Math.max(...batch.map(p=>p.placedAt.getHours()*60+p.placedAt.getMinutes()));
     const holding=g.readyMinute-finish;
     const limit=CURRIES.has(g.itemId)?HOLD_MINUTES:10;
     planned.unshift({start,finish,readyMinute:g.readyMinute,itemId:g.itemId,group:g.group,portions:batch.length,
       orderIds:[...new Set(batch.map(p=>p.orderId))],holdingMinutes:holding,
       placementSatisfied:latestPlacement<=start,holdingSatisfied:holding<=limit,holdingLimitMinutes:limit});
     cursor=start-1;
   }
   jobs.push(...planned);
 }
 const chronological=[...jobs].sort((a,b)=>a.start-b.start);
 const noOverlap=chronological.every((j,i)=>i===0||j.start>=chronological[i-1].finish+1);
 const feasible=noOverlap&&chronological.every(j=>j.placementSatisfied&&j.holdingSatisfied);
 return {status:feasible?'FEASIBLE_PROTOTYPE':'UNVERIFIED',
   reason:feasible?'STRICT_IDENTICAL_DISH_BATCH_PLAN':'BATCH_CONSTRAINT_FAILED',
   holdingLimitMinutes:HOLD_MINUTES,productionBatches:chronological.length,
   jobs:chronological,noOverlap,bookingApprovalAllowed:false};
}
module.exports={scheduleCrossOrderPanang};
