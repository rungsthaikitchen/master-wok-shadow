'use strict';
const {createDriverPlanner,validateFoodAge}=require('./master-wok-driver-plan');
const {verifyCombinedCapacity}=require('./master-wok-combined-assessment');
const {planWithProtectedWork}=require('./master-wok-protected-plan');
const {localDate,relativePlacement}=require('./master-wok-clock');
function createDeliveryCapacity({quoteLeg}={}){
 const driver=createDriverPlanner({quoteLeg});
 async function prepare({orders,rows,previousPlan,serviceDate,now,combine,splitTripId}){
  const d=await driver({rows,previousPlan,serviceDate,now,combine,splitTripId});
  return {delivery:d.delivery,
   orders:orders.map(o=>d.deadlines.has(String(o.orderId))?{...o,readyMinute:d.deadlines.get(String(o.orderId)),customerReadyMinute:o.readyMinute}:o),
   rows:rows.map(r=>d.deadlines.has(String(r.id))?{...r,local_ready_minute:d.deadlines.get(String(r.id))}:r)};
 }
 return {
  async verify(context){
   try{
    const c=context.proposedOrder,id=String(c.orderId);
    const row={...c.rawRow,order_type:c.validatedHeader.order_type,
     customer_lat:c.validatedHeader.customer_lat,customer_lng:c.validatedHeader.customer_lng,source_order_id:c.rawRow.source_order_id||id};
    const p=await prepare({orders:[...context.acceptedOrders,c],rows:[...context.rawRows,row],
     previousPlan:context.state.previousPlan,serviceDate:context.serviceDate,now:context.state.now});
    const candidate=p.orders.find(o=>String(o.orderId)===id),candidateRow=p.rows.find(r=>String(r.id)===id);
    const result=verifyCombinedCapacity({...context,acceptedOrders:p.orders.filter(o=>o!==candidate),
     rawRows:p.rows.filter(r=>r!==candidateRow),proposedOrder:{...candidate,rawRow:candidateRow}});
    if(result.status!=='VERIFIED_KITCHEN_CAPACITY')return result;
    const plan={...result.plan,delivery:p.delivery};validateFoodAge(plan);
    return {...result,plan};
   }catch(error){return {status:'UNVERIFIED',reason:error.message,bookingApprovalAllowed:false};}
  },
  async replan({orders,rows,previousPlan,serviceDate,now,availability,combine,splitTripId}){
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
     standaloneSpringRolls:true,confirmedStarterRecipes:true,fryerWarmupMinutes:5});
    if(result.status!=='VALIDATED_PROTECTED_PLAN')return result;
    const plan={...result.plan,delivery:p.delivery};validateFoodAge(plan);
    return {...result,plan};
   }catch(error){return {status:'UNVERIFIED',reason:error.message,bookingApprovalAllowed:false};}
  }
 };
}
module.exports={createDeliveryCapacity};
