'use strict';
// Staging-only launch safety gate. Never grants booking approval.
// Validates reported resource intervals and order-placement boundaries.
function validateKitchenTimeline(orders,plan){
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
