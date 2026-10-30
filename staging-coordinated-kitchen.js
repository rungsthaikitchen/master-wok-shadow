'use strict';
// Staging-only coordinated plan. Prefer a 10-minute curry hold; permit
// 20 minutes only when the preferred coordinated plan cannot be placed.
// Neither result authorises booking or substitutes for hot-holding controls.
const {scheduleCrossOrderPanang}=require('./staging-cross-order-scheduler');
const {planFryerBeforeWok}=require('./staging-fryer-before-wok');
function planCoordinatedKitchen(orders,rows){
 let last=null;
 for(const curryHoldMinutes of [10,20]){
  const wok=scheduleCrossOrderPanang(orders,rows,{allowFryerDependent:true,curryHoldMinutes});
  if(wok.status!=='FEASIBLE_PROTOTYPE'){
   last={status:'UNVERIFIED',reason:'WOK_PLAN_UNVERIFIED',wok,bookingApprovalAllowed:false};
   continue;
  }
  const fryer=planFryerBeforeWok(orders,rows,wok);
  if(fryer.status!=='PREREQUISITES_PLACED_PROTOTYPE'){
   last={status:'UNVERIFIED',reason:fryer.reason,wok,fryer,bookingApprovalAllowed:false};
   continue;
  }
  return {status:'COORDINATED_PROTOTYPE',reason:'STAGING_ONLY_NOT_BOOKING_APPROVAL',
   curryHoldPolicy:curryHoldMinutes===10?'PREFERRED_10_MINUTES':'EXCEPTION_20_MINUTES',
   curryHoldMinutes,wok,fryer,events:[
    ...wok.jobs.map(j=>({resource:'wok',start:j.start,finish:j.finish,itemId:j.itemId})),
    ...fryer.jobs.map(j=>({resource:j.basket,start:j.start,finish:j.finish,fryType:j.type}))
   ].sort((a,b)=>a.start-b.start),bookingApprovalAllowed:false};
 }
 return last;
}
module.exports={planCoordinatedKitchen};
