'use strict';
// Staging-only coordinated plan. Prefer a 10-minute curry hold; permit
// 20 minutes only when the preferred coordinated plan cannot be placed.
// Neither result authorises booking or substitutes for hot-holding controls.
const {scheduleCrossOrderPanang}=require('./staging-cross-order-scheduler');
const {planFryerBeforeWok}=require('./staging-fryer-before-wok');
const {diagnoseFryer}=require('./staging-fryer-diagnostic');
const {planAuxiliaryWork}=require('./master-wok-auxiliary-work');
function planCoordinatedKitchen(orders,rows,options={}){
 const inventory=diagnoseFryer(orders,rows,options);
 if(inventory.unmodelled.length)
  return {status:'UNVERIFIED',reason:'FRY_RECIPES_UNMODELLED',inventory,bookingApprovalAllowed:false};
 let last=null;
 for(const curryHoldMinutes of [10,20]){
  let fryer,auxiliary;
  const wok=scheduleCrossOrderPanang(orders,rows,{allowFryerDependent:true,curryHoldMinutes,
   blackouts:options.blackouts,notBeforeByOrder:options.notBeforeByOrder,validateComplete:jobs=>{
    fryer=planFryerBeforeWok(orders,rows,{status:'FEASIBLE_PROTOTYPE',jobs},options);
    auxiliary=options.confirmedStarterRecipes?planAuxiliaryWork(orders,options.auxiliaryRows||rows,jobs,options):{status:'AUXILIARY_PLACED_PROTOTYPE',jobs:[]};
    return fryer.status==='PREREQUISITES_PLACED_PROTOTYPE'&&auxiliary.status==='AUXILIARY_PLACED_PROTOTYPE';
   }});
  if(wok.status!=='FEASIBLE_PROTOTYPE'){
   last={status:'UNVERIFIED',reason:'WOK_PLAN_UNVERIFIED',wok,bookingApprovalAllowed:false};
   continue;
  }
  fryer=planFryerBeforeWok(orders,rows,wok,options);
  if(fryer.status!=='PREREQUISITES_PLACED_PROTOTYPE'){
   last={status:'UNVERIFIED',reason:fryer.reason,wok,fryer,bookingApprovalAllowed:false};
   continue;
  }
  return {status:'COORDINATED_PROTOTYPE',reason:'STAGING_ONLY_NOT_BOOKING_APPROVAL',
   curryHoldPolicy:curryHoldMinutes===10?'PREFERRED_10_MINUTES':'EXCEPTION_20_MINUTES',
   curryHoldMinutes,wok,fryer,auxiliary,events:[
    ...wok.jobs.map(j=>({resource:'wok',start:j.start,finish:j.finish,itemId:j.itemId})),
    ...fryer.jobs.map(j=>({resource:j.basket,start:j.start,finish:j.finish,fryType:j.type})),
    ...auxiliary.jobs.map(j=>({resource:j.resource,start:j.start,finish:j.finish,itemId:j.itemId}))
   ].sort((a,b)=>a.start-b.start),bookingApprovalAllowed:false};
 }
 return last;
}
module.exports={planCoordinatedKitchen};

