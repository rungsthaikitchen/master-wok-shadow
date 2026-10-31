'use strict';
// Staging-only, narrow experiment for the observed two-wok kitchen sequence.
// Does not change production booking, the general scheduler, or allow arbitrary parallel mains.
const {planFryerBeforeWok}=require('./staging-fryer-before-wok');
const {diagnoseFryer}=require('./staging-fryer-diagnostic');
const START=990,END=1320;
function firstOrderTwoWokExperiment(orders,rows) {
 const fail=(reason,detail={})=>({status:'UNVERIFIED',reason,...detail,bookingApprovalAllowed:false});
 if(orders.length!==1||rows.length!==1)return fail('FIRST_ORDER_ONLY');
 const order=orders[0],row=rows[0],id=String(row.id);
 if(String(order.orderId)!==id||!Number.isInteger(order.readyMinute)||order.readyMinute<1020||order.readyMinute>1260)
  return fail('ORDER_ID_OR_READY_TIME_MISMATCH');
 const ready=order.readyMinute;
 const lines=(row.items||[]).map(x=>({id:x.item_id,qty:x.qty,modifiers:x.modifiers}));
 if(lines.length!==4||lines.some(x=>!Number.isInteger(x.qty)||x.qty!==1||!Array.isArray(x.modifiers)))
  return fail('UNEXPECTED_ORDER_LINES');
 const counts={};
 for(const x of lines)counts[x.id]=(counts[x.id]||0)+x.qty;
 if(counts['pad-see-ew']!==2||counts['fried-rice']!==1||counts['salt-chickenchips']!==1||Object.keys(counts).length!==3)
  return fail('UNSUPPORTED_RECIPE_MIX');
 if(JSON.stringify(lines.filter(x=>x.id==='pad-see-ew').map(x=>x.modifiers)[0])!==JSON.stringify(lines.filter(x=>x.id==='pad-see-ew').map(x=>x.modifiers)[1]))
  return fail('PAD_SEE_EW_MODIFIERS_DIFFER');
 const placement=order.placedAt instanceof Date&&!Number.isNaN(order.placedAt.valueOf())
  ?Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(order.placedAt).slice(0,2))*60+
   Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(order.placedAt).slice(3,5)):NaN;
 if(!Number.isFinite(placement)||placement>ready-20)return fail('ORDER_PLACED_TOO_LATE');
 const jobs=[
  {itemId:'pad-see-ew',portions:2,orderIds:[id],start:ready-20,finish:ready-10,wokStation:1},
  {itemId:'fried-rice',portions:1,orderIds:[id],start:ready-9,finish:ready-1,wokStation:1},
  {itemId:'salt-chickenchips',portions:1,orderIds:[id],start:ready-3,finish:ready-1,wokStation:2}
 ].map(j=>({...j,duration:j.finish-j.start,readyMinute:ready,holdingMinutes:ready-j.finish,
   portionAllocations:[{orderId:id,qty:j.portions}],placementSatisfied:placement<=j.start,holdingSatisfied:ready-j.finish<=10}));
 if(jobs.some(j=>j.start<START||j.finish>END||j.finish>ready||!j.placementSatisfied||!j.holdingSatisfied))
  return fail('JOB_WINDOW_INVALID');
 // Explicitly check physical station overlap and a one-minute reset on each station.
 for(let i=0;i<jobs.length;i++)for(let k=i+1;k<jobs.length;k++){
  const a=jobs[i],b=jobs[k];
  if(a.wokStation===b.wokStation && a.start<b.finish+1 && b.start<a.finish+1)
   return fail('WOK_STATION_COLLISION');
 }
 const inventory=diagnoseFryer(orders,rows);
 if(inventory.unmodelled.length)return fail('FRY_RECIPES_UNMODELLED');
 const wok={status:'FEASIBLE_PROTOTYPE',reason:'TWO_WOK_NARROW_EXPERIMENT',jobs,
  noOverlap:false,bookingApprovalAllowed:false};
 const fryer=planFryerBeforeWok(orders,rows,wok);
 if(fryer.status!=='PREREQUISITES_PLACED_PROTOTYPE')
  return fail(fryer.reason,{wok,fryer});
 return {status:'COORDINATED_EXPERIMENT',reason:'FIRST_ORDER_ONLY_NOT_BOOKING_APPROVAL',
  wok,fryer,bookingApprovalAllowed:false};
}
module.exports={firstOrderTwoWokExperiment};
