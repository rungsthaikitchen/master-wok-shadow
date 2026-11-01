'use strict';
// Microwave cycles share one appliance. Eggs use the small wok and conservatively
// share the existing single-wok/chef timeline; no new parallel chef is assumed.
const {AUXILIARY}=require('./master-wok-recipe-rules');
const recipeKey=(ready,line)=>JSON.stringify([ready,line.item_id,line.modifiers,line.spice??null,line.item_note??null]);
const key=a=>JSON.stringify([String(a.orderId),a.itemId,a.sourceRecipeKey]);
function demands(orders,rows,{notBeforeByOrder={},fixedAuxiliary=[]}={}){
 const known=new Map(orders.map(o=>[String(o.orderId),o])),portions=[];
 for(const row of rows){
  const order=known.get(String(row.id));if(!order)continue;
  for(const line of row.items||[]){
   const tasks=[];if(AUXILIARY[line.item_id])tasks.push(line.item_id);
   if((line.modifiers||[]).some(m=>m.id==='extra-egg'))tasks.push('fried-egg');
   for(const task of tasks)for(let i=0;i<line.qty;i++)portions.push({orderId:String(row.id),itemId:task,
    sourceItemId:line.item_id,sourceRecipeKey:recipeKey(order.readyMinute,line),readyMinute:order.readyMinute,
    notBefore:Math.max(990,order.placedAt.getHours()*60+order.placedAt.getMinutes(),notBeforeByOrder[String(row.id)]||0),qty:1});
  }
 }
 for(const job of fixedAuxiliary)for(const a of job.allocations||[]){
  if(!known.has(String(a.orderId)))continue; // Cancelled started work stays occupied.
  const index=portions.findIndex(p=>key(p)===key(a));
  if(index<0)throw Error('STARTED_WORK_CHANGED');portions.splice(index,1);
 }
 return portions;
}
function planAuxiliaryWork(orders,rows,wokJobs,options={}){
 try{
  const portions=demands(orders,rows,options);
  if(portions.length>100)return {status:'UNVERIFIED',reason:'AUXILIARY_SEARCH_SIZE_LIMIT'};
  const buckets=new Map();
  for(const p of portions){const k=JSON.stringify([p.itemId,p.sourceRecipeKey]);if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(p);}
  const groups=[...buckets.values()].sort((a,b)=>a[0].readyMinute-b[0].readyMinute);
  const jobs=[],occupied=[...[...wokJobs,...(options.fixedWok||[])].map(j=>({...j,resource:'wok'})),...(options.fixedAuxiliary||[])];
  let nodes=0;
  function search(index,remaining){
   if(++nodes>20000)return false;if(index===groups.length)return true;
   if(!remaining.length)return search(index+1,groups[index+1]||[]);
   const first=remaining[0],rule=AUXILIARY[first.itemId],reset=rule.resource==='wok'?1:0;
   for(let start=first.readyMinute-rule.minutes;start>=Math.max(990,first.notBefore,first.readyMinute-rule.minutes-10);start--){
    const finish=start+rule.minutes;
    if([...(options.kitchenBlackouts||options.blackouts||[])].some(b=>start<b.finish&&finish>b.start)||
     [...occupied,...jobs].some(j=>j.resource===rule.resource&&start<j.finish+reset&&finish+reset>j.start))continue;
    for(let size=Math.min(rule.capacity,remaining.length);size>=1;size--){
     const assigned=remaining.slice(0,size);if(assigned.some(p=>start<p.notBefore))continue;
     jobs.push({resource:rule.resource,appliance:rule.appliance,itemId:first.itemId,sourceRecipeKey:first.sourceRecipeKey,
      start,finish,readyMinute:first.readyMinute,portions:size,orderIds:[...new Set(assigned.map(p=>p.orderId))],allocations:assigned});
     if(search(index,remaining.slice(size)))return true;jobs.pop();
    }
   }
   return false;
  }
  return search(0,groups[0]||[])?{status:'AUXILIARY_PLACED_PROTOTYPE',jobs:jobs.sort((a,b)=>a.start-b.start),bookingApprovalAllowed:false}:
   {status:'UNVERIFIED',reason:nodes>20000?'AUXILIARY_SEARCH_LIMIT':'AUXILIARY_CAPACITY_UNVERIFIED',bookingApprovalAllowed:false};
 }catch(error){return {status:'UNVERIFIED',reason:error.message==='STARTED_WORK_CHANGED'?error.message:'AUXILIARY_INPUT_INVALID',bookingApprovalAllowed:false};}
}
function validateAuxiliaryWork(orders,rows,jobs,options={}){
 try{
  const expected=new Map(),actual=new Map(),bounds=new Map();
  for(const p of demands(orders,rows,options)){expected.set(key(p),(expected.get(key(p))||0)+1);bounds.set(key(p),p);}
  for(const j of jobs){
   const rule=AUXILIARY[j.itemId];
   if(!rule||j.resource!==rule.resource||j.finish-j.start!==rule.minutes||!Number.isInteger(j.portions)||j.portions<1||j.portions>rule.capacity||
    j.allocations?.length!==j.portions||j.start<990||j.finish>1320||j.finish>j.readyMinute||j.readyMinute-j.finish>10)return false;
   for(const p of j.allocations){const original=bounds.get(key(p));
    if(!original||p.qty!==1||p.itemId!==j.itemId||p.sourceRecipeKey!==j.sourceRecipeKey||j.readyMinute!==original.readyMinute||j.start<original.notBefore||j.start<p.notBefore||!j.orderIds.includes(p.orderId))return false;
    actual.set(key(p),(actual.get(key(p))||0)+1);}
  }
  return expected.size===actual.size&&[...expected].every(([k,v])=>actual.get(k)===v);
 }catch(_){return false;}
}
module.exports={planAuxiliaryWork,validateAuxiliaryWork,demands};
