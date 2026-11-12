'use strict';
// Composition root shared by deployed transports. Certification is an explicit
// server dependency: this module never turns a prototype GREEN into approval.
const {createPaymentCompletion}=require('./master-wok-payment-completion');
const {createAmendmentWriter}=require('./master-wok-amendments');
const {createPaymentWriter}=require('./master-wok-payments');
const {createDeliveryAdmin}=require('./master-wok-delivery-admin');
const {createAtomicCheckout}=require('./master-wok-atomic-checkout');
const {createLifecycleWriter}=require('./master-wok-lifecycle');
const {createServiceControlWriter}=require('./master-wok-service-control');
const {createLaunchControl}=require('./master-wok-launch-control');
const {createOrderStore}=require('./master-wok-order-store');
const {createServicePlanStore}=require('./master-wok-service-plan-store');
const {createBookingHttpHandler}=require('./master-wok-http');
const {createNotificationDispatcher,createNotificationHttpHandler}=require('./master-wok-notification-dispatch');
const {createCommercialValidator}=require('./master-wok-commercial-validator');
const {createReviewApproval}=require('./master-wok-review-approval');
const {createBasketReviewStore,createBasketReviewAdmin}=require('./master-wok-basket-review');
const {createBasketAvailability}=require('./master-wok-availability');
function createBookingRuntime({pool,model,secret,notificationSecret,releaseId,schema='public',
 validateCommercialOrder,deliveryService,readAvailability,readOrders,assessBooking,assessMutation,notificationOrderKeyPrefix,readPreviewOrders,deliveryCapacity,quoteDelivery,reviewApprovalsEnabled=false,paymentsEnabled=false}={}){
 if(typeof assessMutation!=='function')throw Error('CERTIFIED_LIFECYCLE_ASSESSOR_REQUIRED');
 const gate=createLaunchControl({schema,releaseId});
 const reviewApproval=reviewApprovalsEnabled?createReviewApproval({pool,schema,assertWriteAllowed:gate.assertWriteAllowed}):undefined;
 const shared={pool,mode:'MASTER_WOK',assertWriteAllowed:gate.assertWriteAllowed};
 const checkout=createAtomicCheckout({...shared,reviewApproval,model,validateCommercialOrder:validateCommercialOrder||createCommercialValidator({deliveryService}),readAvailability,
  assessBooking,...(readOrders?{readOrders}:{}),store:createOrderStore({schema}),planStore:createServicePlanStore({schema})});
 const lifecycle=createLifecycleWriter({...shared,schema,assessMutation});
 if(deliveryCapacity){
  const admin=lifecycle.adminAction;
  const deliveryAdmin=createDeliveryAdmin({...shared,model,readOrders,readAvailability,
   planStore:createServicePlanStore({schema}),deliveryCapacity,schema});
  lifecycle.adminAction=input=>['delivery_trip_options','preview_delivery_combination','combine_deliveries','split_delivery_trip'].includes(input?.action)
   ?deliveryAdmin(input):admin(input);
 }
 const serviceControl=createServiceControlWriter({...shared,schema});
 const availability=createBasketAvailability({pool,model,readAvailability,assessBooking,
  quoteDelivery,assertWriteAllowed:gate.assertWriteAllowed,...(readOrders?{readOrders}:{}),planStore:createServicePlanStore({schema})});
 // Review diagnostics use the same inputs in a rolled-back transaction. They
 // remain available in LEGACY mode and cannot authorize or reserve a booking.
 const reviewAvailability=createBasketAvailability({pool,model,readAvailability,assessBooking,
  quoteDelivery,includeDiagnostics:true,assertWriteAllowed:async()=>{},
  ...(readOrders?{readOrders}:{}),planStore:createServicePlanStore({schema})});
 const saveReview=createBasketReviewStore({pool,schema,assessReview:review=>reviewAvailability({
  times:[review.preferredTime],items:review.basket,orderType:review.orderType,address:review.deliveryAddress})});
 const basketReview=async input=>{
  try{return input?.action==='approval_lookup'?(reviewApproval?await reviewApproval.lookup(input.token):{success:false,statusCode:503,reason:'REVIEW_APPROVAL_DISABLED'}):await saveReview(input);}
  catch(error){return {success:false,statusCode:error.message==='INVALID_REVIEW_REQUEST'?400:503,reason:'BASKET_REVIEW_UNAVAILABLE'};}
 };
 const paymentWriter=paymentsEnabled?createPaymentWriter({...shared,schema,completeOrder:createPaymentCompletion({schema,assessMutation})}):undefined;
 const amendmentWriter=paymentsEnabled&&quoteDelivery?createAmendmentWriter({...shared,schema,assessMutation,quoteDelivery}):undefined;
 const payments=paymentWriter?input=>input?.action?.startsWith('amend_')?(amendmentWriter?amendmentWriter(input):Promise.resolve({success:false,reason:'AMENDMENTS_DISABLED',statusCode:503})):paymentWriter(input):undefined;
 const booking=createBookingHttpHandler({secret,payments,checkout,lifecycle,serviceControl,availability,basketReview,basketReviewAdmin:createBasketReviewAdmin({pool,schema,reviewApproval}),
  readPreviewOrders:readPreviewOrders?async()=>{
   if((await gate.read(pool)).mode!=='MASTER_WOK')throw Error('PREVIEW_READER_DISABLED');
   return readPreviewOrders();
  }:undefined,
  readMode:async()=>(await gate.read(pool)).mode});
 const notifications=notificationSecret?createNotificationHttpHandler({secret:notificationSecret,
  dispatch:createNotificationDispatcher({pool,schema,orderKeyPrefix:notificationOrderKeyPrefix})}):null;
 return request=>notifications&&request.headers.has('x-master-wok-notification-secret')?notifications(request):booking(request);
}
module.exports={createBookingRuntime};

