'use strict';
// Composition root shared by deployed transports. Certification is an explicit
// server dependency: this module never turns a prototype GREEN into approval.
const {createAtomicCheckout}=require('./master-wok-atomic-checkout');
const {createLifecycleWriter}=require('./master-wok-lifecycle');
const {createServiceControlWriter}=require('./master-wok-service-control');
const {createLaunchControl}=require('./master-wok-launch-control');
const {createOrderStore}=require('./master-wok-order-store');
const {createServicePlanStore}=require('./master-wok-service-plan-store');
const {createBookingHttpHandler}=require('./master-wok-http');
function createBookingRuntime({pool,model,secret,releaseId,schema='public',
 validateCommercialOrder,readAvailability,readOrders,assessBooking,assessMutation}={}){
 if(typeof assessMutation!=='function')throw Error('CERTIFIED_LIFECYCLE_ASSESSOR_REQUIRED');
 const gate=createLaunchControl({schema,releaseId});
 const shared={pool,mode:'MASTER_WOK',assertWriteAllowed:gate.assertWriteAllowed};
 const checkout=createAtomicCheckout({...shared,model,validateCommercialOrder,readAvailability,
  assessBooking,...(readOrders?{readOrders}:{}),store:createOrderStore({schema}),planStore:createServicePlanStore({schema})});
 const lifecycle=createLifecycleWriter({...shared,schema,assessMutation});
 const serviceControl=createServiceControlWriter({...shared,schema});
 return createBookingHttpHandler({secret,checkout,lifecycle,serviceControl,
  readMode:async()=>(await gate.read(pool)).mode});
}
module.exports={createBookingRuntime};
