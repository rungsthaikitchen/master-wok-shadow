'use strict';
// Staging-only coordinated plan. Wok placement is tentative until fryer
// prerequisites fit; this never approves a booking.
const {scheduleCrossOrderPanang}=require('./staging-cross-order-scheduler');
const {planFryerBeforeWok}=require('./staging-fryer-before-wok');
function planCoordinatedKitchen(orders,rows){
 const wok=scheduleCrossOrderPanang(orders,rows,{allowFryerDependent:true});
 if(wok.status!=='FEASIBLE_PROTOTYPE')
  return {status:'UNVERIFIED',reason:'WOK_PLAN_UNVERIFIED',wok,bookingApprovalAllowed:false};
 const fryer=planFryerBeforeWok(orders,rows,wok);
 if(fryer.status!=='PREREQUISITES_PLACED_PROTOTYPE')
  return {status:'UNVERIFIED',reason:fryer.reason,wok,fryer,bookingApprovalAllowed:false};
 return {status:'COORDINATED_PROTOTYPE',reason:'STAGING_ONLY_NOT_BOOKING_APPROVAL',
  wok,fryer,events:[
   ...wok.jobs.map(j=>({resource:'wok',start:j.start,finish:j.finish,itemId:j.itemId})),
   ...fryer.jobs.map(j=>({resource:j.basket,start:j.start,finish:j.finish,fryType:j.type}))
  ].sort((a,b)=>a.start-b.start),bookingApprovalAllowed:false};
}
module.exports={planCoordinatedKitchen};
