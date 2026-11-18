'use strict';
const {createDriverPlanner,validateFoodAge,POLICY}=require('./master-wok-driver-plan');
const {verifyCombinedCapacity}=require('./master-wok-combined-assessment');
const {planWithProtectedWork,RING_MODEL_VERSION}=require('./master-wok-protected-plan');
const {localDate,relativePlacement}=require('./master-wok-clock');
function createDeliveryCapacity({quoteLeg,stagingSharedRings=false,advisoryHolding=false}={}){
 const {holdFor}=require('./master-wok-hold-policy');
 const kitchenOptions=stagingSharedRings===true?{sharedRings:true,stagingSharedRings:true}:{};
 const driver=createDriverPlanner({quoteLeg});
 const foodAgeConstraint=(delivery,holdExceptions={},holdingAdvisories={})=>stagingSharedRings?{
  earliestFinishByOrder:Object.fromEntries(delivery.trips.flatMap(t=>t.stops.map(s=>[s.id,t.start-holdFor({holdExceptions,holdingAdvisories},[s.id],POLICY.maxKitchenHold)]))),
  validateCompletePlan:plan=>{
  try{validateFoodAge({...plan,delivery,holdExceptions,holdingAdvisories});return true;}catch(_){return false;}
 }}:{};
 async function prepare({orders,rows,previousPlan,serviceDate,now,combine,splitTripId}){
  const d=await driver({rows,previousPlan,serviceDate,now,combine,splitTripId});
  return {delivery:d.delivery,
   orders:orders.map(o=>d.deadlines.has(String(o.orderId))?{...o,readyMinute:d.deadlines.get(String(o.orderId)),customerReadyMinute:o.readyMinute}:o),
   rows:rows.map(r=>d.deadlines.has(String(r.id))?{...r,local_ready_minute:d.deadlines.get(String(r.id))}:r)};
 }
 async function verifyOne(context,searchOptions={}){
   try{
    const c=context.proposedOrder,id=String(c.orderId);
    const row={...c.rawRow,order_type:c.validatedHeader.order_type,
     customer_lat:c.validatedHeader.customer_lat,customer_lng:c.validatedHeader.customer_lng,source_order_id:c.rawRow.source_order_id||id};
    const p=await prepare({orders:[...context.acceptedOrders,c],rows:[...context.rawRows,row],
     previousPlan:context.state.previousPlan,serviceDate:context.serviceDate,now:context.state.now});
    const candidate=p.orders.find(o=>String(o.orderId)===id),candidateRow=p.rows.find(r=>String(r.id)===id);
    if(row.order_type==='delivery'){
     const stop=p.delivery.trips.flatMap(t=>t.stops).find(s=>s.id===id);
     if(!stop||stop.arrival>stop.target)throw Error('DELIVERY_PROMISE_UNMET');
    }
    const result=verifyCombinedCapacity({...context,acceptedOrders:p.orders.filter(o=>o!==candidate),
     rawRows:p.rows.filter(r=>r!==candidateRow),proposedOrder:{...candidate,rawRow:candidateRow}},
     {...kitchenOptions,...foodAgeConstraint(p.delivery,{...context.state.previousPlan?.holdExceptions,...(c.staffHoldException?{[id]:c.staffHoldException}:{})},{...context.state.previousPlan?.holdingAdvisories,...(c.planningHoldMinutes?{[id]:{kind:'staff_review_required',maxMinutes:c.planningHoldMinutes}}:{})}),maxSearchNodes:searchOptions.maxSearchNodes,
      maxCompleteChecks:searchOptions.maxCompleteChecks,preserveOnly:searchOptions.preserveOnly});
    if(result.status!=='VERIFIED_KITCHEN_CAPACITY')return result;
    const plan={...result.plan,delivery:p.delivery};validateFoodAge(plan);
    return {...result,plan};
   }catch(error){return {status:'UNVERIFIED',reason:error.message,bookingApprovalAllowed:false};}
  }
 return {
  kitchenModelVersion:stagingSharedRings===true?RING_MODEL_VERSION:'combined-kitchen-protected-v3',
  async verify(context,searchOptions={}){
   const first=await verifyOne(context,searchOptions);
   const retryable=['SEARCH_LIMIT','NO_PHYSICAL_TIMELINE','WOK_PLAN_UNVERIFIED','FIXED_RING_WORKLOAD_EXCEEDS_WINDOW','FIXED_BATCH_CAPACITY_EXCEEDED','FIXED_VESSEL_CAPACITY_EXCEEDED','FIXED_RESOURCE_WINDOW_EXCEEDED','FRYER_WINDOW_CAPACITY_EXCEEDED','AUXILIARY_CAPACITY_UNVERIFIED','TIMELINE_VALIDATION_FAILED'];
   if(!advisoryHolding||!stagingSharedRings||first.status==='VERIFIED_KITCHEN_CAPACITY'||!retryable.includes(first.reason)||context.proposedOrder.staffHoldException)return first;
   // The service horizon is the search bound, not a new customer holding rule.
   // Try only one bounded alternative; a failed search remains unverified.
   const candidate={...context.proposedOrder,planningHoldMinutes:330};
   const alternate=await verifyOne({...context,proposedOrder:candidate},{...searchOptions,
    maxSearchNodes:Math.min(searchOptions.maxSearchNodes??100000,1000),
    maxCompleteChecks:Math.min(searchOptions.maxCompleteChecks??128,8)});
   if(alternate.status!=='VERIFIED_KITCHEN_CAPACITY')return first;
   require('./master-wok-holding-advisory').clampAdvisory(alternate.plan,String(candidate.orderId));
   validateFoodAge(alternate.plan);require('./master-wok-protected-plan').protectStartedWork(alternate.plan,0);
   return alternate;
  },

  async replan({orders,rows,previousPlan,serviceDate,now,availability,combine,splitTripId,retainExistingPlan=false}){
   try{
    const p=await prepare({orders,rows,previousPlan,serviceDate,now,combine,splitTripId});
    // Closures affect production as well as customer handover. Capacity-only
    // blackouts do not retrospectively invalidate existing promises.
    const blackouts=[];
    for(const b of availability?.blackouts||[]){
     if(b.active===false||b.kind!=='closed')continue;
     const start=new Date(b.start_at),end=new Date(b.end_at);
     if(!Number.isFinite(+start)||!Number.isFinite(+end)||end<=start)throw Error('INVALID_BLACKOUT');
     if(localDate(start)<=serviceDate&&localDate(end)>=serviceDate){
      const m=t=>{const d=relativePlacement(t,serviceDate);return d.getHours()*60+d.getMinutes();};
      blackouts.push({start:localDate(start)<serviceDate?0:m(start),finish:localDate(end)>serviceDate?1440:m(end)});
     }
    }
    const result=planWithProtectedWork({orders:p.orders,rows:p.rows,previousPlan,serviceDate,now,blackouts,
     ...kitchenOptions,...foodAgeConstraint(p.delivery,previousPlan?.holdExceptions,previousPlan?.holdingAdvisories),retainExistingPlan:retainExistingPlan&&!combine&&!splitTripId,
     standaloneSpringRolls:true,confirmedStarterRecipes:true,fryerWarmupMinutes:5});
    if(result.status!=='VALIDATED_PROTECTED_PLAN')return result;
    const plan={...result.plan,delivery:p.delivery};validateFoodAge(plan);
    return {...result,plan};
   }catch(error){return {status:'UNVERIFIED',reason:error.message,bookingApprovalAllowed:false};}
  }
 };
}
module.exports={createDeliveryCapacity};
