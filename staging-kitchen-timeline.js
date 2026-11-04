'use strict';
// One read-only staging report across wok, fryer and dependency checks.
// No resource plan is allowed to approve bookings.
const {scheduleCrossOrderPanang}=require('./staging-cross-order-scheduler');
const {assessFryer}=require('./staging-fryer-capacity');
const {diagnoseFryer}=require('./staging-fryer-diagnostic');
const {checkFryerWokDependencies}=require('./staging-fryer-wok-dependencies');
function assessKitchen(orders,rows){
 const inventory=diagnoseFryer(orders,rows);
 const wok=scheduleCrossOrderPanang(orders,rows);
 const fryer=assessFryer(orders,rows);
 const dependency=checkFryerWokDependencies(wok,fryer);
 const events=[
  ...(wok.jobs||[]).map(j=>({resource:'wok',start:j.start,finish:j.finish,itemId:j.itemId,orderIds:j.orderIds})),
  ...(fryer.jobs||[]).map(j=>({resource:j.basket,start:j.start,finish:j.finish,itemId:j.itemId,orderIds:[j.orderId],fryType:j.type}))
 ].sort((a,b)=>a.start-b.start);
 const blockers=[];
 if(wok.status!=='FEASIBLE_PROTOTYPE')blockers.push('WOK_PLAN_UNVERIFIED');
 if(inventory.unmodelled.length)blockers.push('FRY_RECIPES_UNMODELLED');
 if(inventory.dependencies.length&&fryer.status!=='FRY_ONLY_PROTOTYPE')blockers.push('FRYER_PLAN_UNVERIFIED');
 if(inventory.dependencies.length)blockers.push('WOK_FRYER_DEPENDENCIES_NOT_INTEGRATED');
 if(dependency.violations.length)blockers.push('FRYER_FINISHES_AFTER_WOK_START');
 return {status:'UNVERIFIED',reason:blockers[0]||'STAGING_PROTOTYPE_ONLY',
  blockers,events,wok,fryer,dependency,bookingApprovalAllowed:false};
}
module.exports={assessKitchen};
