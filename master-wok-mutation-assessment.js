'use strict';
const {commitmentTimes,readCapacityCommitments}=require('./master-wok-commitment-reader');
const {normalizeStagingOrders}=require('./staging-order-snapshot');
const {relativePlacement}=require('./master-wok-clock');
const {assessCombinedBooking}=require('./master-wok-combined-assessment');
function demands(order){
 return order.is_test||['cancelled','declined','rejected'].includes(order.status)?[]:commitmentTimes(order);
}
function createMutationAssessment({model,readAvailability,readOrders=readCapacityCommitments}={}){
 return async function assessMutation({connection,before,after,dates,now}){
  const old=demands(before),next=demands(after);
  // Payment, completion and acknowledgement can retain or reduce capacity;
  // they must not be subjected to a fresh-order lead time at cooking time.
  if(next.every(time=>old.includes(time)))return {status:'VALIDATED_LIFECYCLE_ASSESSMENT',
   reason:'CAPACITY_UNCHANGED_OR_REDUCED',bookingApprovalAllowed:false};
  for(const serviceDate of dates){
   const rows=await readOrders(connection,serviceDate);
   const orders=normalizeStagingOrders({rows,model,serviceDate})
    .map(o=>({...o,placedAt:relativePlacement(o.placedAt,serviceDate)}));
   const changed=rows.filter(r=>r.source_order_id===String(after.id)&&!old.includes(new Date(r.confirmed_time).toISOString()));
   if(!changed.length)continue;
   // At most one new proposed/effective time is introduced by one header action.
   if(changed.length!==1)return {status:'UNVERIFIED',reason:'AMBIGUOUS_MUTATION_DEMAND',bookingApprovalAllowed:false};
   const row=changed[0],candidate=orders.find(o=>String(o.orderId)===String(row.id));
   const availability=await readAvailability(connection,serviceDate);
   const result=assessCombinedBooking({serviceDate,state:{now,availability},
    acceptedOrders:orders.filter(o=>o!==candidate),rawRows:rows.filter(r=>r!==row),
    proposedOrder:{...candidate,items:row.items,rawRow:row,validatedHeader:{preferred_time:row.confirmed_time}}});
   if(result.status!=='VALIDATED_COMBINED_ASSESSMENT')return result;
  }
  return {status:'VALIDATED_LIFECYCLE_ASSESSMENT',reason:'LOCKED_POST_MUTATION_STATE_VALIDATED',bookingApprovalAllowed:false};
 };
}
module.exports={createMutationAssessment,demands};
