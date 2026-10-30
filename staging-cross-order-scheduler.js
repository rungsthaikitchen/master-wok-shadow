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
   const max=MAX_BY_GROUP[g.group];
   for(let i=0;i<portions.length;i+=max){
     const batch=portions.slice(i,i+max);
     const duration=DURATION_BY_GROUP[g.group][batch.length];
     const placement=Math.max(...batch.map(p=>p.placedAt.getHours()*60+p.placedAt.getMinutes()));
     const holdingLimitMinutes=CURRIES.has(g.itemId)?HOLD_MINUTES:10;
     const earliest=Math.max(990,placement,g.readyMinute-holdingLimitMinutes-duration);
     const latest=g.readyMinute-duration;
     jobs.push({itemId:g.itemId,group:g.group,readyMinute:g.readyMinute,
       portions:batch.length,orderIds:[...new Set(batch.map(p=>p.orderId))],
       duration,earliest,latest,holdingLimitMinutes});
   }
 }
 if(jobs.length>32)return {status:'UNVERIFIED',reason:'SEARCH_SIZE_LIMIT',bookingApprovalAllowed:false};
 if(jobs.some(j=>j.earliest>j.latest||j.latest+j.duration>1320))
   return {status:'UNVERIFIED',reason:'IMPOSSIBLE_BATCH_WINDOW',bookingApprovalAllowed:false};
 // Single shared wok. Enumerate feasible start minutes; never accept a clash.
 // Search is bounded and reports UNVERIFIED rather than assuming feasibility.
 const occupied=[];
 let nodes=0,exhausted=false;
 function search(remaining){
   if(!remaining.length)return true;
   if(++nodes>100000){exhausted=true;return false;}
   // Most constrained job first; tie-break by promised ready time.
   const candidates=[...remaining].sort((a,b)=>(a.latest-a.earliest)-(b.latest-b.earliest)||a.readyMinute-b.readyMinute);
   for(const job of candidates){
     for(let t=job.latest;t>=job.earliest;t--){
       const finish=t+job.duration;
       if(occupied.some(o=>t<o.finish+1&&finish+1>o.start))continue;
       occupied.push({...job,start:t,finish,holdingMinutes:job.readyMinute-finish,
         placementSatisfied:true,holdingSatisfied:true});
       if(search(remaining.filter(x=>x!==job)))return true;
       occupied.pop();
       if(exhausted)return false;
     }
   }
   return false;
 }
 const feasible=search(jobs);
 const chronological=feasible?[...occupied].sort((a,b)=>a.start-b.start):[];
 return {status:feasible?'FEASIBLE_PROTOTYPE':'UNVERIFIED',
   reason:feasible?'SHARED_WOK_TIMELINE':exhausted?'SEARCH_LIMIT':'NO_SHARED_TIMELINE',
   holdingLimitMinutes:HOLD_MINUTES,productionBatches:jobs.length,
   jobs:chronological,noOverlap:feasible,nodes,bookingApprovalAllowed:false};
}
module.exports={scheduleCrossOrderPanang};
