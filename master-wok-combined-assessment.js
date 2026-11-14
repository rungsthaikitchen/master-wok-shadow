'use strict';
const {holdFor,validateExceptions}=require('./master-wok-hold-policy');
// Complete assessment pipeline for staging certification. A valid schedule is
// evidence, not a production booking authorization. Remains false by design.
const {planWithProtectedWork}=require('./master-wok-protected-plan');
const {validateKitchenTimeline}=require('./staging-kitchen-launch-validator');
const {diagnoseFryer}=require('./staging-fryer-diagnostic');
const {localDate,relativePlacement}=require('./master-wok-atomic-checkout');
const {fryerRecipe,fryerCapacity,PREPARED_SIDES}=require('./master-wok-recipe-rules');
const DURATIONS={fast:{1:5,2:6,3:8,4:10},noodle:{1:8,2:10},salad:{1:10,2:10,3:15,4:15}};
function verifyCombinedCapacity({acceptedOrders,proposedOrder,rawRows,serviceDate,state},options={}){
 const fail=(reason,extra={})=>({status:'UNVERIFIED',reason,bookingApprovalAllowed:false,...extra});
 try{
  const availability=state?.availability,now=new Date(state?.now);
  if(!availability||!Array.isArray(availability.blackouts)||!availability.serviceState||
    !Number.isFinite(now.getTime())||!Array.isArray(acceptedOrders)||!Array.isArray(rawRows)||
    !proposedOrder?.rawRow)return fail('MISSING_LOCKED_BOOKING_STATE');
  const date=new Date(serviceDate+'T12:00:00Z');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)||date.toISOString().slice(0,10)!==serviceDate)
   return fail('INVALID_SERVICE_DATE');
  const weekday=date.getUTCDay(),today=localDate(now),ready=proposedOrder.customerReadyMinute??proposedOrder.readyMinute;
  const placed=relativePlacement(now,serviceDate),minute=placed.getHours()*60+placed.getMinutes()+placed.getSeconds()/60;
  if(!(availability.openDays||[3,4,5,6]).includes(weekday)||
     (availability.closedDates||[]).includes(serviceDate)||today>serviceDate||ready<1020||ready>1320)
   return fail('OUTSIDE_SERVICE_WINDOW');
  // Preserve the current website's LEAD_MINUTES=20 as a floor, even when a
  // small basket's cooking span plus buffer would fit a shorter window.
  if(ready-minute<20)return fail('BELOW_EXISTING_MINIMUM_LEAD');
  // Existing same-day overflow rule: late promises are offered only while
  // today's normal ordering window is still open. Production ends at 22:00.
  if(ready>1260&&(today!==serviceDate||minute>=1260))return fail('OVERRUN_NOT_AVAILABLE');
  const control=availability.serviceState;
  if(control.effective_until&&!Number.isFinite(new Date(control.effective_until).getTime()))
   return fail('INVALID_SERVICE_CONTROL_EXPIRY');
  const active=!control.effective_until||new Date(control.effective_until)>now;
  if(active&&control.mode==='paused')return fail('ORDERS_PAUSED');
  // David confirmed 1 November: add lead time, do not shrink capacity or
  // alter cooking durations. Retain the existing persisted mode/throttle values.
  const serviceModes={normal:{throttle:0,extra:0},busy:{throttle:0.5,extra:15},very_busy:{throttle:1,extra:30}};
  const policy=active?serviceModes[control.mode]:serviceModes.normal;
  if(!policy||(active&&Number(control.capacity_throttle)!==policy.throttle))
   return fail('SERVICE_THROTTLE_INTEGRATION_REQUIRED');
  const extraLead=policy.extra;
  if(ready-minute<20+extraLead)return fail('BELOW_SERVICE_MINIMUM_LEAD');
  const readyAt=new Date(proposedOrder.validatedHeader.preferred_time);
  const blackouts=[];
  for(const b of availability.blackouts){
   if(b.active===false)continue;
   const start=new Date(b.start_at),end=new Date(b.end_at);
   if(!['closed','fully_booked'].includes(b.kind)||!Number.isFinite(start.getTime())||
      !Number.isFinite(end.getTime())||end<=start)return fail('INVALID_BLACKOUT');
   if(readyAt>=start&&readyAt<end)return fail('BLACKOUT');
   if(b.kind==='closed'){
    const startDate=localDate(start),endDate=localDate(end);
    if(startDate<=serviceDate&&endDate>=serviceDate){
     const localMinute=t=>{const p=relativePlacement(t,serviceDate);return p.getHours()*60+p.getMinutes();};
     blackouts.push({start:startDate<serviceDate?0:localMinute(start),
      finish:endDate>serviceDate?1440:localMinute(end)});
    }
   }
  }
  const orders=[...acceptedOrders,proposedOrder],rows=[...rawRows,proposedOrder.rawRow];
  if(orders.length!==rows.length||new Set(orders.map(o=>String(o.orderId))).size!==orders.length||
   new Set(rows.map(r=>String(r.id))).size!==rows.length||
   orders.some(o=>!rows.some(r=>String(r.id)===String(o.orderId))))return fail('INCOMPLETE_SNAPSHOT');
  const id=String(proposedOrder.orderId),warmup=5,buffer=10+extraLead;
  const holdExceptions=validateExceptions({...state.previousPlan?.holdExceptions,
   ...(proposedOrder.staffHoldException?{[id]:proposedOrder.staffHoldException}:{})});
  const planInput={orders,rows,serviceDate,now,previousPlan:state.previousPlan,
   ...(typeof options.validateCompletePlan==='function'?{validateCompletePlan:options.validateCompletePlan}:{}),
   ...(options.earliestFinishByOrder?{earliestFinishByOrder:options.earliestFinishByOrder}:{}),
   maxSearchNodes:options.maxSearchNodes,maxCompleteChecks:options.maxCompleteChecks,
   ...(options.sharedRings===true?{sharedRings:true,stagingSharedRings:options.stagingSharedRings===true}:{}),
   newOrderId:id,blackouts,holdExceptions,
   standaloneSpringRolls:true,
   fryerWarmupMinutes:5,
   confirmedStarterRecipes:true,
   notBeforeByOrder:{[id]:Math.max(990,Math.ceil(minute+Math.max(warmup,buffer)))}};
  // First fit only the new basket around existing validated reservations.
  // Avoid repeatedly searching every accepted dish for each dropdown time.
  let protectedResult=options.sharedRings===true&&state.previousPlan
   ?planWithProtectedWork({...planInput,preserveExistingWork:true}):null;
  if(!protectedResult||protectedResult.status!=='VALIDATED_PROTECTED_PLAN'){
   if(options.preserveOnly===true&&protectedResult)return fail(protectedResult.reason);
   protectedResult=planWithProtectedWork(planInput);
  }
  if(protectedResult.status!=='VALIDATED_PROTECTED_PLAN')return fail(protectedResult.reason);
  const plan=protectedResult.plan,unstartedPlan=protectedResult.futurePlan,unstartedRows=protectedResult.remainingRows;
  const validation=validateKitchenTimeline(orders,unstartedPlan,unstartedRows,options.sharedRings===true?{
   auxiliaryRows:rows,fixedWok:protectedResult.protectedJobs.wok,
   fixedAuxiliary:protectedResult.protectedJobs.auxiliary,fixedFryer:protectedResult.protectedJobs.fryer,blackouts}:{});
  if(validation.status!=='VALIDATED_STAGING_TIMELINE')return fail('TIMELINE_VALIDATION_FAILED',{issues:validation.issues});
  // Validate actual durations, deadlines and exact per-order fryer coverage,
  // independently of the allocator's success status.
  for(const job of unstartedPlan.wok.jobs){
   if(DURATIONS[job.group]?.[job.portions]!==job.finish-job.start||
     job.holdingLimitMinutes>holdFor(unstartedPlan,job.orderIds,unstartedPlan.holdingLimitMinutes===20?20:10)||
     job.finish>job.readyMinute||job.readyMinute-job.finish>job.holdingLimitMinutes)
    return fail('INVALID_WOK_JOB');
  }
  const inventory=diagnoseFryer(orders,unstartedRows,{standaloneSpringRolls:true,confirmedStarterRecipes:true});
  if(inventory.unmodelled.length)return fail('FRY_RECIPES_UNMODELLED');
  const key=(orderId,itemId,type)=>JSON.stringify([String(orderId),itemId,type]);
  const expected=new Map(),actual=new Map();
  for(const d of inventory.dependencies)for(const [type,count] of Object.entries(d.counts)){
   const k=key(d.orderId,d.itemId,type);expected.set(k,(expected.get(k)||0)+count);
  }
  for(const job of unstartedPlan.fryer.jobs){
   if(job.start<995||!fryerRecipe(job.type)||job.portions>fryerCapacity(job.type,job.basket)||
     job.finish-job.start!==fryerRecipe(job.type).minutes||
     !Array.isArray(job.allocations)||job.allocations.length!==job.portions)
    return fail('INVALID_FRYER_JOB');
   for(const a of job.allocations){
    const hold=job.standalone?holdFor(unstartedPlan,[a.orderId],unstartedPlan.holdingLimitMinutes===20?20:10):10;
    if(job.start<a.notBefore||job.finish>a.deadline||a.deadline-job.finish>hold||
      a.type!==job.type||a.qty!==1)return fail('INVALID_FRYER_ALLOCATION');
    const k=key(a.orderId,a.itemId,a.type);actual.set(k,(actual.get(k)||0)+1);
   }
  }
  if(expected.size!==actual.size||[...expected].some(([k,v])=>actual.get(k)!==v))
   return fail('FRYER_COVERAGE_MISMATCH');
  const jobs=[...plan.wok.jobs,...plan.fryer.jobs,...(plan.auxiliary?.jobs||[])].filter(j=>j.orderIds.includes(id));
  const preparedOnly=proposedOrder.rawRow.items.length>0&&proposedOrder.rawRow.items.every(l=>PREPARED_SIDES.has(l.item_id));
  if(!jobs.length&&!preparedOnly)return fail('NO_MODELLED_CANDIDATE_WORK');
  const earliest=jobs.length?Math.min(...jobs.map(j=>j.start)):Math.max(990,Math.ceil(minute+buffer));
  const finish=jobs.length?Math.max(...jobs.map(j=>j.finish)):earliest;
  // The buffer precedes the first candidate work; fryer warmup is an additional
  // lower bound, not a replacement for the agreed whole-basket lead time.
  if(earliest<Math.max(990,minute+buffer)||finish>proposedOrder.readyMinute)return fail('INSUFFICIENT_LEAD_TIME');
  return {status:'VERIFIED_KITCHEN_CAPACITY',reason:'COMPLETE_LOCKED_STATE_VALIDATED',
   plan,leadTime:{earliestCandidateWork:earliest,finalCandidateCompletion:finish,bufferMinutes:buffer,extraServiceLeadMinutes:extraLead,minimumLeadMinutes:20+extraLead},
   bookingApprovalAllowed:false};
 }catch(_){return fail('COMBINED_ASSESSMENT_FAILED');}
}
function assessCombinedBooking(context,options){
 const result=verifyCombinedCapacity(context,options);
 return result.status==='VERIFIED_KITCHEN_CAPACITY'
  ?{...result,status:'VALIDATED_COMBINED_ASSESSMENT',reason:'STAGING_CERTIFICATION_ONLY'}:result;
}
module.exports={assessCombinedBooking,verifyCombinedCapacity};
