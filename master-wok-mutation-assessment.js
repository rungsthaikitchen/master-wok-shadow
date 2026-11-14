'use strict';
const {commitmentTimes,readCapacityCommitments}=require('./master-wok-commitment-reader');
const {normalizeStagingOrders}=require('./staging-order-snapshot');
const {relativePlacement}=require('./master-wok-clock');
const {assessCombinedBooking}=require('./master-wok-combined-assessment');
const {planWithProtectedWork}=require('./master-wok-protected-plan');
const {createServicePlanStore}=require('./master-wok-service-plan-store');
function demands(order){
 return order.is_test||['cancelled','declined','rejected'].includes(order.status)?[]:commitmentTimes(order);
}
function createMutationAssessment({model,readAvailability,readOrders=readCapacityCommitments,planStore=createServicePlanStore(),deliveryCapacity,stagingSharedRings=false}={}){
 const kitchenOptions=stagingSharedRings===true?{sharedRings:true,stagingSharedRings:true}:{};
 return async function assessMutation({connection,before,after,dates,now,action}){
  const old=demands(before),next=demands(after);
  const plansByDate={};
  const reduced=next.every(time=>old.includes(time));
  const retainExistingPlan=action==='accept'&&before.capacity_scheduler==='MASTER_WOK'&&reduced&&next.length===old.length&&
   ['order_type','customer_lat','customer_lng','is_test'].every(key=>before[key]===after[key]);
  for(const serviceDate of dates){
   const rows=await readOrders(connection,serviceDate);
   const orders=normalizeStagingOrders({rows,model,serviceDate})
    .map(o=>({...o,placedAt:relativePlacement(o.placedAt,serviceDate)}));
   const changed=rows.filter(r=>r.source_order_id===String(after.id)&&!old.includes(new Date(r.confirmed_time).toISOString()));
   const previousPlan=await planStore.read(connection,serviceDate);
   const availability=await readAvailability(connection,serviceDate);
   if(!changed.length){
    const protectedResult=deliveryCapacity?await deliveryCapacity.replan({orders,rows,previousPlan,now,serviceDate,availability,retainExistingPlan}):planWithProtectedWork({orders,rows,previousPlan,now,serviceDate,
     ...kitchenOptions,retainExistingPlan,
     standaloneSpringRolls:true,confirmedStarterRecipes:true,fryerWarmupMinutes:5});
    if(protectedResult.status!=='VALIDATED_PROTECTED_PLAN')return protectedResult;
    plansByDate[serviceDate]=protectedResult.plan;
    continue;
   }
   // At most one new proposed/effective time is introduced by one header action.
   if(changed.length!==1)return {status:'UNVERIFIED',reason:'AMBIGUOUS_MUTATION_DEMAND',bookingApprovalAllowed:false};
   const row=changed[0],candidate=orders.find(o=>String(o.orderId)===String(row.id));
   const result=await (deliveryCapacity?deliveryCapacity.verify:assessCombinedBooking)({serviceDate,state:{now,availability,previousPlan},
    acceptedOrders:orders.filter(o=>o!==candidate),rawRows:rows.filter(r=>r!==row),
    proposedOrder:{...candidate,items:row.items,rawRow:row,validatedHeader:{preferred_time:row.confirmed_time,order_type:row.order_type,customer_lat:row.customer_lat,customer_lng:row.customer_lng}}},kitchenOptions);
   if(!['VALIDATED_COMBINED_ASSESSMENT','VERIFIED_KITCHEN_CAPACITY'].includes(result.status))return result;
   plansByDate[serviceDate]=result.plan;
  }
  return {status:'VALIDATED_LIFECYCLE_ASSESSMENT',reason:reduced?'CAPACITY_UNCHANGED_OR_REDUCED':'LOCKED_POST_MUTATION_STATE_VALIDATED',plansByDate,bookingApprovalAllowed:false};
 };
}
module.exports={createMutationAssessment,demands};
