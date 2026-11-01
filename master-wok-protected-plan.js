'use strict';
// Reuses the existing coordinated allocator, keeping all work that may already
// have started immovable. No chef start confirmations are introduced.
const {planCoordinatedKitchen}=require('./staging-coordinated-kitchen');
const {validateKitchenTimeline}=require('./staging-kitchen-launch-validator');
const {OUT_OF_SCOPE}=require('./staging-out-of-scope-items');
const {localDate,relativePlacement}=require('./master-wok-clock');
const {validateAuxiliaryWork}=require('./master-wok-auxiliary-work');
const {AUXILIARY}=require('./master-wok-recipe-rules');
const MODEL_VERSION='combined-kitchen-protected-v3';
const recipeKey=(ready,line)=>JSON.stringify([ready,line.item_id,line.modifiers,line.spice??null,line.item_note??null]);
const overlaps=(a,b,reset=0)=>a.start<b.finish+reset&&a.finish+reset>b.start;
function protectStartedWork(previous,asOfMinute){
 if(!Number.isFinite(asOfMinute)||asOfMinute<0||asOfMinute>1440)throw Error('INVALID_PLAN_CLOCK');
 if(!previous)return {wok:[],fryer:[],auxiliary:[]};
 if(previous.schemaVersion!==1||![MODEL_VERSION,'combined-kitchen-protected-v2','combined-kitchen-protected-v1'].includes(previous.modelVersion)||!Array.isArray(previous.wok?.jobs)||!Array.isArray(previous.fryer?.jobs)||
  (previous.auxiliary&&!Array.isArray(previous.auxiliary.jobs)))
  throw Error('INVALID_COMMITTED_PLAN');
 const all=[...previous.wok.jobs.map(j=>({...j,resource:'wok'})),
  ...previous.fryer.jobs.map(j=>({...j,resource:j.basket})),...(previous.auxiliary?.jobs||[])];
 for(const j of previous.auxiliary?.jobs||[]){
  const rule=AUXILIARY[j.itemId];
  if(!rule||j.resource!==rule.resource||j.appliance!==rule.appliance||j.finish-j.start!==rule.minutes||
   !Number.isInteger(j.portions)||j.portions<1||j.portions>rule.capacity||j.allocations?.length!==j.portions||
   j.allocations.some(a=>a.qty!==1||a.itemId!==j.itemId||a.sourceRecipeKey!==j.sourceRecipeKey||!j.orderIds.includes(a.orderId)))
   throw Error('INVALID_COMMITTED_PLAN');
 }
 for(const job of all){
  if(!Number.isInteger(job.start)||!Number.isInteger(job.finish)||job.start<990||job.finish>1320||job.finish<=job.start||
   !Array.isArray(job.orderIds)||!job.orderIds.length||new Set(job.orderIds).size!==job.orderIds.length||
   !['wok','large','small-1','small-2','microwave'].includes(job.resource))throw Error('INVALID_COMMITTED_PLAN');
 }
 for(let i=0;i<all.length;i++)for(let j=i+1;j<all.length;j++)
  if(all[i].resource===all[j].resource&&overlaps(all[i],all[j],all[i].resource==='wok'?1:0))
   throw Error('COMMITTED_PLAN_RESOURCE_CLASH');
 const wok=new Set(previous.wok.jobs.filter(j=>j.start<=asOfMinute));
 const auxiliary=new Set((previous.auxiliary?.jobs||[]).filter(j=>j.start<=asOfMinute));
 const fryer=new Set(previous.fryer.jobs.filter(j=>j.start<=asOfMinute));
 function linked(f,w){return !f.standalone&&(f.allocations||[]).some(a=>
  a.deadline===w.start&&a.itemId===w.itemId&&w.orderIds.includes(a.orderId)&&
  (!a.recipeKey||a.recipeKey===w.recipeKey));}
 // A fryer job already underway also fixes its downstream wok job. A shared
 // fryer cycle can bind more than one order, so close the dependency graph.
 let changed=true;
 while(changed){
  changed=false;
  for(const a of auxiliary)if(AUXILIARY[a.itemId]?.beforeMain){
   const parents=previous.wok.jobs.filter(w=>w.itemId===a.itemId&&w.recipeKey===a.sourceRecipeKey&&
    a.allocations.some(p=>p.deadline===w.start&&w.orderIds.includes(p.orderId)));
   if(!parents.length)throw Error('COMMITTED_FRY_DEPENDENCY_MISSING');
   for(const w of parents)if(!wok.has(w)){wok.add(w);changed=true;}
  }
  for(const w of wok)for(const a of previous.auxiliary?.jobs||[])
   if(AUXILIARY[a.itemId]?.beforeMain&&a.itemId===w.itemId&&a.sourceRecipeKey===w.recipeKey&&
    a.allocations.some(p=>p.deadline===w.start&&w.orderIds.includes(p.orderId))&&!auxiliary.has(a)){
    auxiliary.add(a);changed=true;
   }
  for(const f of fryer)if(!f.standalone){
   const parents=previous.wok.jobs.filter(w=>linked(f,w));
   if(!parents.length)throw Error('COMMITTED_FRY_DEPENDENCY_MISSING');
   for(const w of parents)if(!wok.has(w)){wok.add(w);changed=true;}
  }
  for(const w of wok)for(const f of previous.fryer.jobs)
   if(linked(f,w)&&!fryer.has(f)){fryer.add(f);changed=true;}
 }
 return {wok:[...wok],fryer:[...fryer],auxiliary:[...auxiliary]};
}
function subtractProtectedPortions(orders,rows,fixed){
 const known=new Map(orders.map(o=>[String(o.orderId),o]));
 const byId=new Map(rows.map(r=>[String(r.id),structuredClone(r)]));
 function consume(orderId,itemId,qty,key=null){
  const id=String(orderId),row=byId.get(id),order=known.get(id);
  // A cancelled order can still have work in progress. Preserve its occupied
  // resources, while excluding it from unstarted demand.
  if(!row)return;
  if(!Number.isInteger(qty)||qty<=0||!order)throw Error('INVALID_PROTECTED_ALLOCATION');
  let remaining=qty;
  for(const line of row.items){
   if(line.item_id!==itemId||(key&&recipeKey(order.readyMinute,line)!==key))continue;
   const take=Math.min(remaining,line.qty);line.qty-=take;remaining-=take;
  }
  if(remaining)throw Error('STARTED_WORK_CHANGED');
 }
 for(const job of fixed.wok){
  if(!job.recipeKey||!Array.isArray(job.portionAllocations)||
    job.portionAllocations.reduce((n,a)=>n+a.qty,0)!==job.portions)throw Error('INVALID_PROTECTED_WOK_COVERAGE');
  for(const a of job.portionAllocations)consume(a.orderId,job.itemId,a.qty,job.recipeKey);
 }
 for(const job of fixed.fryer){
  if(!Array.isArray(job.allocations)||job.allocations.length!==job.portions)throw Error('INVALID_PROTECTED_FRY_COVERAGE');
  if(job.standalone)for(const a of job.allocations)consume(a.orderId,a.itemId,a.qty,a.recipeKey||null);
 }
 const remainingRows=[...byId.values()].map(r=>({...r,items:r.items.filter(l=>l.qty>0)}));
 return {rows:remainingRows,orders};
}
function serviceMinute(now,serviceDate){
 const date=localDate(now);
 if(date<serviceDate)return 0;
 if(date>serviceDate)return 1440;
 const clock=relativePlacement(now,serviceDate);
 return clock.getHours()*60+clock.getMinutes()+clock.getSeconds()/60;
}
function planWithProtectedWork({orders,rows,previousPlan,now,serviceDate,...options}){
 const fail=(reason,extra={})=>({status:'UNVERIFIED',reason,bookingApprovalAllowed:false,...extra});
 try{
  const asOfMinute=serviceMinute(now,serviceDate);
  if(!previousPlan&&asOfMinute>=990&&orders.some(o=>String(o.orderId)!==options.newOrderId))
   return fail('COMMITTED_PLAN_REQUIRED_DURING_SERVICE');
  const fixed=protectStartedWork(previousPlan,asOfMinute);
  const remaining=subtractProtectedPortions(orders,rows,fixed);
  const notBeforeByOrder=Object.fromEntries(orders.map(o=>[String(o.orderId),
   Math.max(Math.ceil(asOfMinute),options.notBeforeByOrder?.[String(o.orderId)]??0)]));
  const wokBlackouts=[...(options.blackouts||[]),...[...fixed.wok,...fixed.auxiliary.filter(j=>j.resource==='wok')].map(j=>({start:j.start-1,finish:j.finish+1}))];
  const fryerBlackouts=[...(options.fryerBlackouts||[]),...fixed.fryer.map(j=>({basket:j.basket,start:j.start,finish:j.finish}))];
  const future=planCoordinatedKitchen(remaining.orders,remaining.rows,{...options,
   blackouts:wokBlackouts,kitchenBlackouts:options.blackouts||[],fryerBlackouts,notBeforeByOrder,
   auxiliaryRows:rows,fixedAuxiliary:fixed.auxiliary,fixedWok:fixed.wok});
  if(future.status!=='COORDINATED_PROTOTYPE')return fail(future.fryer?.reason||future.wok?.reason||future.reason);
  const validation=validateKitchenTimeline(remaining.orders,future,remaining.rows);
  if(validation.status!=='VALIDATED_STAGING_TIMELINE')return fail('REMAINING_PLAN_COVERAGE_INVALID',{issues:validation.issues});
  if(options.confirmedStarterRecipes&&!validateAuxiliaryWork(orders,rows,future.auxiliary.jobs,{notBeforeByOrder,fixedAuxiliary:fixed.auxiliary,mainJobs:[...fixed.wok,...future.wok.jobs]}))
   return fail('AUXILIARY_COVERAGE_INVALID');
  // Keep the original immutable job objects in the persisted full plan. Future
  // allocations are independently validated against exactly the unstarted lines.
  const plan={...future,schemaVersion:1,modelVersion:MODEL_VERSION,
   wok:{...future.wok,jobs:[...fixed.wok,...future.wok.jobs].sort((a,b)=>a.start-b.start)},
   fryer:{...future.fryer,jobs:[...fixed.fryer,...future.fryer.jobs].sort((a,b)=>a.start-b.start)},
   auxiliary:{...future.auxiliary,jobs:[...fixed.auxiliary,...future.auxiliary.jobs].sort((a,b)=>a.start-b.start)}};
  return {status:'VALIDATED_PROTECTED_PLAN',plan,futurePlan:future,
   remainingRows:remaining.rows,protectedJobs:fixed,bookingApprovalAllowed:false};
 }catch(error){return fail(['STARTED_WORK_CHANGED','COMMITTED_PLAN_RESOURCE_CLASH',
  'COMMITTED_FRY_DEPENDENCY_MISSING'].includes(error.message)?error.message:'INVALID_COMMITTED_PLAN');}
}
module.exports={protectStartedWork,subtractProtectedPortions,planWithProtectedWork,serviceMinute};
