'use strict';
const {holdFor,validateExceptions}=require('./master-wok-hold-policy');
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
 // Identical source lines share the same physical recipe batches. Aggregate
 // their fryer counts before attributing them to one-portion wok jobs; dividing
 // each individual line across all matching jobs creates fractional portions.
 const grouped=new Map(),dependencies=[];
 for(const dep of inventory.dependencies){
  if(dep.standalone){dependencies.push(dep);continue;}
  const order=known.get(dep.orderId),line=(rows.find(r=>String(r.id)===dep.orderId)?.items||[])[dep.lineIndex];
  if(!order||!line)return fail('FRY_WOK_BATCH_MAPPING_UNVERIFIED');
  const key=JSON.stringify([dep.orderId,recipeKey(order.readyMinute,line)]);
  let group=grouped.get(key);
  if(!group){group={...dep,counts:{}};grouped.set(key,group);dependencies.push(group);}
  for(const [type,count] of Object.entries(dep.counts))group.counts[type]=(group.counts[type]||0)+count;
 }
 for(const dep of dependencies){
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
  // Counts now cover all identical source lines. Match their complete physical
  // quantity to the attributed wok batches; fractions still fail closed.
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
  // A compatible prerequisite batch can feed different wok start times.
  // Each allocation retains its own deadline and ten-minute holding limit.
  // Standalone recipes retain their original time/recipe grouping.
  const key=JSON.stringify([p.type,p.duration,p.standalone?p.deadline:null,p.standalone?p.recipeKey:null]);
  if(!buckets.has(key))buckets.set(key,[]);
  buckets.get(key).push(p);
 }
 const groups=[...buckets.values()].map(g=>g.sort((a,b)=>a.deadline-b.deadline||b.notBefore-a.notBefore))
  .sort((a,b)=>a[0].deadline-b[0].deadline);
 const jobs=[];let nodes=0,exhausted=false;
 // Index occupied minutes once. Re-scanning every previous job and blackout
 // in every nested fryer branch consumed most of the availability CPU time.
 const occupied=new Map(BASKETS.map(b=>[b.id,new Int16Array(1321)]));
 for(const basket of BASKETS)for(const b of options.fryerBlackouts||[]){
  if(b.basket&&b.basket!==basket.id)continue;
  for(let t=Math.max(0,Math.floor(b.start));t<Math.min(1321,Math.ceil(b.finish));t++)occupied.get(basket.id)[t]++;
 }
 function reserve(basket,start,finish,delta){
  const minutes=occupied.get(basket);
  for(let t=start;t<finish;t++)minutes[t]+=delta;
 }
 function fits(basket,start,finish){
  const minutes=occupied.get(basket);
  for(let t=start;t<finish;t++)if(minutes[t])return false;
  return true;
 }
 function search(groupIndex,remaining){
  if(++nodes>(options.maxNodes??20000)){exhausted=true;return false;}
  if(groupIndex===groups.length)return true;
  if(!remaining.length)return search(groupIndex+1,groups[groupIndex+1]||[]);
  const first=remaining[0];
  const hold=first.standalone?holdFor(options,[first.orderId],options.holdingLimitMinutes===20?20:10):10;
  for(let start=first.deadline-first.duration;start>=Math.max(990,first.deadline-first.duration-hold,first.notBefore);start--){
   const finish=start+first.duration;
   if((options.kitchenBlackouts||options.blackouts||[]).some(b=>start<b.finish&&finish>b.start))continue;
   for(const basket of BASKETS){
    if(!fits(basket.id,start,finish))continue;
    for(let size=Math.min(fryerCapacity(first.type,basket.id),remaining.length);size>=1;size--){
     const assigned=remaining.slice(0,size);
     if(assigned.some(p=>start<p.notBefore||finish<(p.earliestFinish??0)||finish>p.deadline||
      p.deadline-finish>(p.standalone?holdFor(options,[p.orderId],options.holdingLimitMinutes===20?20:10):10)))continue;
     const job={type:first.type,basket:basket.id,portions:size,start,finish,
      assigned,
      ...(first.standalone?{standalone:true,readyMinute:first.deadline}:{wokStart:first.deadline})};
     jobs.push(job);
     reserve(basket.id,start,finish,1);
     if(search(groupIndex,remaining.slice(size)))return true;
     reserve(basket.id,start,finish,-1);
     jobs.pop();if(exhausted)return false;
    }
   }
  }
  return false;
 }
 if(!search(0,groups[0]||[]))return fail(exhausted?'FRY_SEARCH_LIMIT':'FRY_BEFORE_WOK_CAPACITY_UNVERIFIED');
 return {status:'PREREQUISITES_PLACED_PROTOTYPE',reason:'ATTRIBUTED_FRYER_TIMELINE',
  // Attribution is needed only for the successful plan, not for thousands of
  // discarded branches. Keep every original portion and recipe key intact.
  jobs:jobs.map(({assigned,...job})=>({...job,
   orderIds:[...new Set(assigned.map(p=>p.orderId))],
   itemIds:[...new Set(assigned.map(p=>p.itemId))],
   allocations:assigned.map(p=>({...p,qty:1}))})).sort((a,b)=>a.start-b.start),
  inventory,nodes,bookingApprovalAllowed:false};
}
module.exports={planFryerBeforeWok};
