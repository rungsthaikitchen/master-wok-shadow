'use strict';
// Coordinates fryer prerequisites with an attributed wok plan. This remains a
// staging plan: recipe coverage and launch approval are checked separately.
const {diagnoseFryer}=require('./staging-fryer-diagnostic');
const {fryerCapacity}=require('./master-wok-recipe-rules');
const BASKETS=[{id:'large',capacity:3},{id:'small-1',capacity:2},{id:'small-2',capacity:2}];
const recipeKey=(ready,line)=>JSON.stringify([ready,line.item_id,line.modifiers,line.spice??null,line.item_note??null]);
function planFryerBeforeWok(orders,rows,wokPlan,options={}){
 const inventory=diagnoseFryer(orders,rows,options);
 const fail=reason=>({status:'UNVERIFIED',reason,inventory,jobs:[],bookingApprovalAllowed:false});
 if(inventory.unmodelled.length)return fail('FRY_RECIPES_UNMODELLED');
 if(!wokPlan||wokPlan.status!=='FEASIBLE_PROTOTYPE')return fail('WOK_PLAN_UNVERIFIED');
 const known=new Map(orders.map(o=>[String(o.orderId),o]));
 const portions=[];
 for(const dep of inventory.dependencies){
  const order=known.get(dep.orderId);
  const placed=order?.placedAt instanceof Date?order.placedAt.getHours()*60+order.placedAt.getMinutes():NaN;
  const notBefore=Math.max(990,placed,options.notBeforeByOrder?.[dep.orderId]??0);
  if(!Number.isFinite(notBefore))return fail('INVALID_PLACEMENT');
  if(dep.standalone){
   const line=(rows.find(r=>String(r.id)===dep.orderId)?.items||[])[dep.lineIndex];
   for(const [type,count] of Object.entries(dep.counts))for(let i=0;i<count;i++)
    portions.push({orderId:dep.orderId,itemId:dep.itemId,type,duration:dep.durationMinutes,
     earliestFinish:options.earliestFinishByOrder?.[dep.orderId]??0,
     deadline:dep.readyMinute,notBefore,standalone:true,recipeKey:recipeKey(order.readyMinute,line)});
   continue;
  }
  // Attribute each line's portions to the exact recipe and wok batch. Repeated
  // item IDs with different proteins/spice must not borrow each other's frying.
  const line=(rows.find(r=>String(r.id)===dep.orderId)?.items||[])[dep.lineIndex];
  const matches=wokPlan.jobs.filter(w=>w.itemId===dep.itemId&&(w.orderIds||[]).includes(dep.orderId)&&
    (!w.recipeKey||w.recipeKey===recipeKey(order.readyMinute,line)));
  if(!matches.length)return fail('FRY_WOK_BATCH_MAPPING_UNVERIFIED');
  if(matches.length===1&&!matches[0].portionAllocations){
   for(const [type,count] of Object.entries(dep.counts))for(let i=0;i<count;i++)
    portions.push({orderId:dep.orderId,itemId:dep.itemId,type,duration:5,
     deadline:matches[0].start,notBefore,wokStart:matches[0].start});
   continue;
  }
  const attributed=matches.map(w=>({w,qty:(w.portionAllocations||[])
   .filter(a=>String(a.orderId)===dep.orderId).reduce((n,a)=>n+a.qty,0)}));
  // More than one identical source line is aggregated below, using its share
  // of each batch. Fractions cannot be represented safely and fail closed.
  const totalLineQty=(rows.find(r=>String(r.id)===dep.orderId)?.items||[])
   .filter(l=>recipeKey(order.readyMinute,l)===recipeKey(order.readyMinute,line))
   .reduce((n,l)=>n+l.qty,0);
  if(attributed.reduce((n,a)=>n+a.qty,0)!==totalLineQty)return fail('FRY_WOK_BATCH_MAPPING_UNVERIFIED');
  for(const {w,qty} of attributed)for(const [type,count] of Object.entries(dep.counts)){
   const allocated=count*qty/totalLineQty;
   if(!Number.isInteger(allocated))return fail('FRY_WOK_BATCH_MAPPING_UNVERIFIED');
   for(let i=0;i<allocated;i++)portions.push({orderId:dep.orderId,itemId:dep.itemId,type,duration:5,
    deadline:w.start,notBefore,wokStart:w.start,recipeKey:w.recipeKey});
  }
 }
 if(portions.length>150)return fail('FRY_SEARCH_SIZE_LIMIT');
 const buckets=new Map();
 for(const p of portions){
  const key=JSON.stringify([p.type,p.duration,p.deadline,p.standalone?p.recipeKey:null]);
  if(!buckets.has(key))buckets.set(key,[]);
  buckets.get(key).push(p);
 }
 const groups=[...buckets.values()].sort((a,b)=>a[0].deadline-b[0].deadline)
  .map(g=>g.sort((a,b)=>b.notBefore-a.notBefore));
 const jobs=[];let nodes=0,exhausted=false;
 function search(groupIndex,remaining){
  if(++nodes>(options.maxNodes??20000)){exhausted=true;return false;}
  if(groupIndex===groups.length)return true;
  if(!remaining.length)return search(groupIndex+1,groups[groupIndex+1]||[]);
  const first=remaining[0];
  const hold=first.standalone&&options.holdingLimitMinutes===20?20:10;
  for(let start=first.deadline-first.duration;start>=Math.max(990,first.deadline-first.duration-hold,first.notBefore);start--){
   const finish=start+first.duration;
   if((options.kitchenBlackouts||options.blackouts||[]).some(b=>start<b.finish&&finish>b.start))continue;
   const blocked=options.fryerBlackouts||[];
   for(const basket of BASKETS){
    if(jobs.some(j=>j.basket===basket.id&&start<j.finish&&finish>j.start)||
      blocked.some(b=>(!b.basket||b.basket===basket.id)&&start<b.finish&&finish>b.start))continue;
    for(let size=Math.min(fryerCapacity(first.type,basket.id),remaining.length);size>=1;size--){
     const assigned=remaining.slice(0,size);
     if(assigned.some(p=>finish<(p.earliestFinish??0)))continue;
     const job={type:first.type,basket:basket.id,portions:size,start,finish,
      orderIds:[...new Set(assigned.map(p=>p.orderId))],
      itemIds:[...new Set(assigned.map(p=>p.itemId))],
      allocations:assigned.map(p=>({...p,qty:1})),
      ...(first.standalone?{standalone:true,readyMinute:first.deadline}:{wokStart:first.deadline})};
     jobs.push(job);
     if(search(groupIndex,remaining.slice(size)))return true;
     jobs.pop();if(exhausted)return false;
    }
   }
  }
  return false;
 }
 if(!search(0,groups[0]||[]))return fail(exhausted?'FRY_SEARCH_LIMIT':'FRY_BEFORE_WOK_CAPACITY_UNVERIFIED');
 return {status:'PREREQUISITES_PLACED_PROTOTYPE',reason:'ATTRIBUTED_FRYER_TIMELINE',
  jobs:jobs.sort((a,b)=>a.start-b.start),inventory,nodes,bookingApprovalAllowed:false};
}
module.exports={planFryerBeforeWok};
