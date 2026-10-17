'use strict';
// Offline adapter. Fixed hypothetical allocations are never treated as activity.
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const unknown=reasonCode=>({status:'UNVERIFIED',reasonCode});
const minute=n=>Number.isFinite(n)&&n>=990&&n<=1320;
const id=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(s);

function createDeliveryKitchenAssessment(snapshot,{timeoutMs=1000}={}) {
 try {
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000)throw Error();
  const s=structuredClone(snapshot);
  if(!s||s.basis!=='HYPOTHETICAL_KITCHEN_OCCUPANCY'||s.complete!==true||
     !minute(s.asOfMinute)||!Array.isArray(s.fixedAllocations)||s.fixedAllocations.length>500||
     !Array.isArray(s.orders)||s.orders.length<1||s.orders.length>2)throw Error();
  const ids=new Set();
  for(const o of s.orders) {
   if(!o||!id(o.orderId)||ids.has(o.orderId)||!Array.isArray(o.lines)||!o.lines.length||o.lines.length>100)throw Error();
   ids.add(o.orderId);
  }
  const fixedIds=new Set();
  const blocks=s.fixedAllocations.slice().sort((a,b)=>a.start-b.start);
  for(let i=0;i<blocks.length;i++) {
   const b=blocks[i];
   if(!b||!id(b.orderId)||ids.has(b.orderId)||fixedIds.has(b.orderId)||!minute(b.start)||
      !minute(b.finish)||b.finish<=b.start||(i&&b.start<blocks[i-1].finish))throw Error();
   fixedIds.add(b.orderId);
  }
  const context=vm.createContext({window:{},Date});
  for(const file of ['master-wok-model-bundle.js','master-wok.js'])
   vm.runInContext(fs.readFileSync(path.join(__dirname,file),'utf8'),context,{timeout:timeoutMs});
  const model=context.window.MasterWokModelV1;
  const orders=s.orders.map(o=>{
   for(const l of o.lines) {
    if(!l||!model.hasItem(l.itemId)||!Number.isSafeInteger(l.qty)||l.qty<1||l.qty>100||
       (l.mods!=null&&(!Array.isArray(l.mods)||l.mods.length>30||l.mods.some(m=>!m||typeof m.id!=='string'||m.id.length>80))))throw Error();
   }
   return {orderId:o.orderId,classification:model.classifyBasket(o.lines)};
  });
  // Host-local Date is used only to convey a minute-of-day to the legacy engine.
  // No UTC/service-date conversion is performed or inferred by this offline API.
  const placedAt=new Date(2000,0,1,0,0,0);
  placedAt.setMinutes(s.asOfMinute);
  return function assessKitchen(proposal) {
   try {
    const p=structuredClone(proposal);
    if(!p||!['SEPARATE','COMBINED'].includes(p.kind)||!Array.isArray(p.proposedFoodReady)||p.proposedFoodReady.length!==orders.length)
     return unknown('INCOMPLETE_JOINT_PROPOSAL');
    const ready=new Map();
    for(const r of p.proposedFoodReady) {
     if(!r||!ids.has(r.orderId)||ready.has(r.orderId)||!minute(r.foodReadyMinute)||r.foodReadyMinute<s.asOfMinute)
      return unknown('INVALID_FOOD_READY_PROPOSAL');
     ready.set(r.orderId,r.foodReadyMinute);
    }
    context.reservations=orders.map(o=>({...o,placedAt,readyMinute:ready.get(o.orderId)}));
    context.options={asOfMinute:s.asOfMinute,blockedIntervals:blocks.map(b=>({start:b.start,finish:b.finish}))};
    const result=vm.runInContext('window.MasterWokV1.schedule(reservations,options)',context,{timeout:timeoutMs});
    if(result.exhausted)return unknown('KITCHEN_SEARCH_EXHAUSTED');
    if(!result.feasible)return {status:'NO_FIT',reasonCode:'FIXED_KITCHEN_PLAN_CONFLICT'};
    return {status:'FIT',verified:false,evidenceBasis:'HYPOTHETICAL_KITCHEN_PLAN_NOT_COOKING_ACTIVITY',
     foodReadyByOrder:result.timeline.map(j=>({orderId:j.id,foodReadyMinute:j.finish})),
     timeline:structuredClone(result.timeline)};
   } catch(_){return unknown('KITCHEN_ASSESSMENT_FAILED');}
  };
 } catch(_){return ()=>unknown('KITCHEN_SNAPSHOT_UNVERIFIED');}
}
module.exports={createDeliveryKitchenAssessment};
