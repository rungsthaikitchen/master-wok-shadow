'use strict';
// Offline reconstruction of RTK index.html legacy allocateLoadBackwards,
// forceAllocateExistingLoad, buildKitchenProductionMap and canBasketFitInSlot.
// Uses explicit recorded kitchen_load; never infers a missing load.
function allocate(map,readyMinute,load,{force=false}={}){
 if(!Number.isInteger(readyMinute)||!Number.isInteger(load)||load<0)throw Error('INVALID_ALLOCATION');
 const needed=[];
 for(let i=1;i<=load;i++){
  const minute=readyMinute-i*5;
  if(minute<990){if(!force)return false;break;}
  if(!force&&(map.get(minute)||0)>0)return false;
  needed.push(minute);
 }
 for(const minute of needed)map.set(minute,(map.get(minute)||0)+1);
 return needed.length===load;
}
function loadFor(row){
 if(!row||!Array.isArray(row.items)||!row.items.length)return null;
 let load=0;
 for(const item of row.items){
  if(!Number.isInteger(item.qty)||item.qty<1||
     !Number.isInteger(item.kitchen_load)||item.kitchen_load<0)return null;
  load+=item.qty*item.kitchen_load;
 }
 return load;
}
function reconstructLegacySlots(snapshot,{candidateLoad,priorCount=0,startMinute=1020,endMinute=1260}={}){
 if(!snapshot||!Array.isArray(snapshot.orders)||
    !Number.isInteger(candidateLoad)||candidateLoad<0||
    !Number.isInteger(priorCount)||priorCount<0||priorCount>snapshot.orders.length)
  throw Error('INVALID_INPUT');
 const prior=snapshot.orders.slice(0,priorCount).filter(r=>!['cancelled','declined','rejected'].includes(String(r.status).toLowerCase()));
 const loads=prior.map(loadFor);
 const unknown=loads.map((l,i)=>l===null?i+1:null).filter(x=>x!==null);
 const slots=[];
 if(unknown.length)return {status:'UNVERIFIED',reason:'MISSING_RECORDED_KITCHEN_LOAD',unknownPriorOrders:unknown,slots,bookingApprovalAllowed:false};
 const sorted=prior.map((r,i)=>({r,load:loads[i]})).sort((a,b)=>a.r.local_ready_minute-b.r.local_ready_minute);
 const map=new Map(),conflicts=[];
 for(const {r,load} of sorted){
  if(!Number.isInteger(r.local_ready_minute))return {status:'UNVERIFIED',reason:'MISSING_LOCAL_READY_TIME',slots,bookingApprovalAllowed:false};
  if(!allocate(map,r.local_ready_minute,load)){
   conflicts.push(String(r.id));
   allocate(map,r.local_ready_minute,load,{force:true});
  }
 }
 for(let minute=startMinute;minute<=endMinute;minute+=5)
  slots.push({time:String(Math.floor(minute/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0'),
   legacyCapacityFit:allocate(new Map(map),minute,candidateLoad),
   window:minute>1260?'OVERRUN':'NORMAL'});
 return {status:'RECONSTRUCTED_CAPACITY_ONLY',reason:'FINAL_STATE_NOT_BOOKING_DECISION',
  priorOrders:prior.length,conflicts,slots,bookingApprovalAllowed:false};
}
module.exports={allocate,loadFor,reconstructLegacySlots};
