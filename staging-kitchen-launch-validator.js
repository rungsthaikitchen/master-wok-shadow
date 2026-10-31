'use strict';
// Staging-only launch safety gate. Never grants booking approval.
// Validates reported resource intervals and order-placement boundaries.
const {OUT_OF_SCOPE}=require('./staging-out-of-scope-items');
function validateKitchenTimeline(orders,plan,rows){
 const issues=[];
 const placed=new Map(orders.map(o=>[String(o.orderId),o.placedAt instanceof Date
  ?o.placedAt.getHours()*60+o.placedAt.getMinutes():NaN]));
 if(!plan||plan.status!=='COORDINATED_PROTOTYPE')
  issues.push({code:'COORDINATED_PLAN_MISSING'});
 const wok=(plan&&plan.wok&&plan.wok.jobs)||[];
 const fry=(plan&&plan.fryer&&plan.fryer.jobs)||[];
 const all=[...wok.map(j=>({...j,resource:'wok'})),...fry.map(j=>({...j,resource:j.basket}))];
 for(const job of all){
  if(!Number.isFinite(job.start)||!Number.isFinite(job.finish)||job.finish<=job.start||
    job.start<990||job.finish>1320)issues.push({code:'INVALID_INTERVAL',resource:job.resource});
  if(!Array.isArray(job.orderIds)||!job.orderIds.length)
   issues.push({code:'MISSING_ORDER_IDS',resource:job.resource});
  for(const id of job.orderIds||[]){
   const minute=placed.get(String(id));
   if(!Number.isFinite(minute)||job.start<minute)
    issues.push({code:'BEFORE_ORDER_PLACED',orderId:String(id),resource:job.resource});
  }
 }
 for(let i=0;i<all.length;i++)for(let j=i+1;j<all.length;j++){
  const a=all[i],b=all[j];
  if(a.resource===b.resource&&a.start<b.finish&&b.start<a.finish)
   issues.push({code:'RESOURCE_OVERLAP',resource:a.resource});
 }
 // Portion coverage is provable only for single-order batches with current
 // job metadata. Cross-order batches need per-order portion allocations.
 if(Array.isArray(rows)){
  const expected=new Map();
  for(const row of rows){
   if(!row||!Array.isArray(row.items)){
    issues.push({code:'INVALID_ORDER_LINES'});continue;
   }
   for(const line of row.items){
    if(!line||!Number.isInteger(line.qty)||line.qty<=0||typeof line.item_id!=='string'){
     issues.push({code:'INVALID_ORDER_LINE',orderId:String(row.id)});continue;
    }
    if(OUT_OF_SCOPE.has(line.item_id))continue;
    const key=JSON.stringify([String(row.id),line.item_id]);
    expected.set(key,(expected.get(key)||0)+line.qty);
   }
  }
  const actual=new Map();
  for(const job of wok){
   if(!Number.isInteger(job.portions)||job.portions<=0){
    issues.push({code:'INVALID_PORTION_COUNT',itemId:job.itemId});continue;
   }
   const allocations=job.portionAllocations;
   if(!Array.isArray(allocations)||!allocations.length){
    issues.push({code:'PORTION_ALLOCATION_MISSING',itemId:job.itemId});continue;
   }
   const seen=new Set();
   let allocated=0,valid=true;
   for(const allocation of allocations){
    const id=String(allocation?.orderId);
    if(!allocation||!Number.isInteger(allocation.qty)||allocation.qty<=0||
       seen.has(id)||!(job.orderIds||[]).some(x=>String(x)===id)){
      issues.push({code:'INVALID_PORTION_ALLOCATION',itemId:job.itemId});valid=false;continue;
    }
    seen.add(id);allocated+=allocation.qty;
   }
   if(allocated!==job.portions||seen.size!==(job.orderIds||[]).length){
    issues.push({code:'PORTION_ALLOCATION_TOTAL_MISMATCH',itemId:job.itemId});valid=false;
   }
   if(valid)for(const allocation of allocations){
    const key=JSON.stringify([String(allocation.orderId),job.itemId]);
    actual.set(key,(actual.get(key)||0)+allocation.qty);
   }
  }
  for(const [key,qty] of expected){
   if(actual.get(key)!==qty)issues.push({code:'PORTION_COVERAGE_MISMATCH',key,expected:qty,actual:actual.get(key)||0});
  }
  for(const [key,qty] of actual){
   if(!expected.has(key))issues.push({code:'UNEXPECTED_SCHEDULED_PORTIONS',key,actual:qty});
  }
 }else{
  issues.push({code:'ORDER_LINES_REQUIRED_FOR_COVERAGE'});
 }
 for(const job of fry){
  for(const orderId of job.orderIds||[]){
   const candidates=wok.filter(w=>(w.orderIds||[]).includes(orderId)&&
     (job.itemIds||[]).includes(w.itemId));
   if(candidates.length!==1||job.finish>candidates[0].start)
    issues.push({code:'FRY_WOK_DEPENDENCY_UNVERIFIED',orderId});
  }
 }
 return {status:issues.length?'UNVERIFIED':'VALIDATED_STAGING_TIMELINE',
  issues,bookingApprovalAllowed:false};
}
module.exports={validateKitchenTimeline};
