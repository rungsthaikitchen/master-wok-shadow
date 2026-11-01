'use strict';
// Complete assessment pipeline for staging certification. A valid schedule is
// evidence, not a production booking authorization. Remains false by design.
const {planCoordinatedKitchen}=require('./staging-coordinated-kitchen');
const {validateKitchenTimeline}=require('./staging-kitchen-launch-validator');
const {diagnoseFryer}=require('./staging-fryer-diagnostic');
const {localDate,relativePlacement}=require('./master-wok-atomic-checkout');
const DURATIONS={fast:{1:5,2:6,3:8,4:10},noodle:{1:8,2:10},salad:{1:10,2:10,3:15,4:15}};
const CAPACITY={large:3,'small-1':2,'small-2':2};
function assessCombinedBooking({acceptedOrders,proposedOrder,rawRows,serviceDate,state},options={}){
 const fail=(reason,extra={})=>({status:'UNVERIFIED',reason,bookingApprovalAllowed:false,...extra});
 try{
  const availability=state?.availability,now=new Date(state?.now);
  if(!availability||!Array.isArray(availability.blackouts)||!availability.serviceState||
    !Number.isFinite(now.getTime())||!Array.isArray(acceptedOrders)||!Array.isArray(rawRows)||
    !proposedOrder?.rawRow)return fail('MISSING_LOCKED_BOOKING_STATE');
  const date=new Date(serviceDate+'T12:00:00Z');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)||date.toISOString().slice(0,10)!==serviceDate)
   return fail('INVALID_SERVICE_DATE');
  const weekday=date.getUTCDay(),today=localDate(now),ready=proposedOrder.readyMinute;
  const placed=relativePlacement(now,serviceDate),minute=placed.getHours()*60+placed.getMinutes();
  if(!(availability.openDays||[3,4,5,6]).includes(weekday)||
     (availability.closedDates||[]).includes(serviceDate)||today>serviceDate||ready<1020||ready>1320)
   return fail('OUTSIDE_SERVICE_WINDOW');
  // Existing same-day overflow rule: late promises are offered only while
  // today's normal ordering window is still open. Production ends at 22:00.
  if(ready>1260&&(today!==serviceDate||minute>=1260))return fail('OVERRUN_NOT_AVAILABLE');
  const control=availability.serviceState;
  if(control.effective_until&&!Number.isFinite(new Date(control.effective_until).getTime()))
   return fail('INVALID_SERVICE_CONTROL_EXPIRY');
  const active=!control.effective_until||new Date(control.effective_until)>now;
  if(active&&control.mode==='paused')return fail('ORDERS_PAUSED');
  // Do not erase existing slowdown semantics by guessing a new throttle model.
  if(active&&(Number(control.capacity_throttle)!==0||!['normal','paused'].includes(control.mode)))
   return fail('SERVICE_THROTTLE_INTEGRATION_REQUIRED');
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
  const id=String(proposedOrder.orderId),warmup=5,buffer=10;
  const plan=planCoordinatedKitchen(orders,rows,{blackouts,
   standaloneSpringRolls:options.standaloneSpringRolls===true,
   notBeforeByOrder:{[id]:Math.max(990,minute+Math.max(warmup,buffer))}});
  if(plan.status!=='COORDINATED_PROTOTYPE')return fail(plan.fryer?.reason||plan.wok?.reason||plan.reason);
  const validation=validateKitchenTimeline(orders,plan,rows);
  if(validation.status!=='VALIDATED_STAGING_TIMELINE')return fail('TIMELINE_VALIDATION_FAILED',{issues:validation.issues});
  // Validate actual durations, deadlines and exact per-order fryer coverage,
  // independently of the allocator's success status.
  for(const job of plan.wok.jobs){
   if(DURATIONS[job.group]?.[job.portions]!==job.finish-job.start||
     job.finish>job.readyMinute||job.readyMinute-job.finish>job.holdingLimitMinutes)
    return fail('INVALID_WOK_JOB');
  }
  const inventory=diagnoseFryer(orders,rows,{standaloneSpringRolls:options.standaloneSpringRolls===true});
  if(inventory.unmodelled.length)return fail('FRY_RECIPES_UNMODELLED');
  const key=(orderId,itemId,type)=>JSON.stringify([String(orderId),itemId,type]);
  const expected=new Map(),actual=new Map();
  for(const d of inventory.dependencies)for(const [type,count] of Object.entries(d.counts)){
   const k=key(d.orderId,d.itemId,type);expected.set(k,(expected.get(k)||0)+count);
  }
  for(const job of plan.fryer.jobs){
   if(!CAPACITY[job.basket]||job.portions>CAPACITY[job.basket]||
     job.finish-job.start!==(job.type==='springRollBatch'?7:5)||
     !Array.isArray(job.allocations)||job.allocations.length!==job.portions)
    return fail('INVALID_FRYER_JOB');
   for(const a of job.allocations){
    if(job.start<a.notBefore||job.finish>a.deadline||a.deadline-job.finish>10||
      a.type!==job.type||a.qty!==1)return fail('INVALID_FRYER_ALLOCATION');
    const k=key(a.orderId,a.itemId,a.type);actual.set(k,(actual.get(k)||0)+1);
   }
  }
  if(expected.size!==actual.size||[...expected].some(([k,v])=>actual.get(k)!==v))
   return fail('FRYER_COVERAGE_MISMATCH');
  const jobs=[...plan.wok.jobs,...plan.fryer.jobs].filter(j=>j.orderIds.includes(id));
  if(!jobs.length)return fail('NO_MODELLED_CANDIDATE_WORK');
  const earliest=Math.min(...jobs.map(j=>j.start)),finish=Math.max(...jobs.map(j=>j.finish));
  // The buffer precedes the first candidate work; fryer warmup is an additional
  // lower bound, not a replacement for the agreed whole-basket lead time.
  if(earliest<Math.max(990,minute+buffer)||finish>ready)return fail('INSUFFICIENT_LEAD_TIME');
  // Independent sides and most starters still need approved resource recipes.
  const unmodelled=new Set(['chicken-satay','moo-ping','thai-sausage','spare-ribs','fried-egg']);
  if(rows.some(r=>r.items.some(l=>unmodelled.has(l.item_id)||
    l.modifiers.some(m=>m.id==='extra-egg'))))return fail('NON_WOK_RECIPE_COVERAGE_REQUIRED');
  return {status:'VALIDATED_COMBINED_ASSESSMENT',reason:'STAGING_CERTIFICATION_ONLY',
   plan,leadTime:{earliestCandidateWork:earliest,finalCandidateCompletion:finish,bufferMinutes:buffer},
   bookingApprovalAllowed:false};
 }catch(_){return fail('COMBINED_ASSESSMENT_FAILED');}
}
module.exports={assessCombinedBooking};
