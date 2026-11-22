'use strict';
// Basket-specific time hints from the same locked inputs/assessor as checkout.
// Always rolls back: a hint never reserves capacity or approves a booking.
const {beginBookingTransaction}=require('./master-wok-transaction-writer');
const {beginHintSnapshot}=require('./master-wok-hint-snapshot');
const {readCapacityCommitments}=require('./master-wok-commitment-reader');
const {normalizeStagingOrders}=require('./staging-order-snapshot');
const {prepareStagingBasket}=require('./staging-canonical-basket');
const {priceBasket}=require('./master-wok-commercial');
const {createServicePlanStore}=require('./master-wok-service-plan-store');
const {localDate,relativePlacement}=require('./master-wok-clock');
const {londonPlacement}=require('./staging-booking-integration');
function createBasketAvailability({pool,model,readAvailability,assessBooking,assertWriteAllowed,
 includeDiagnostics=false,quoteDelivery,readSnapshot,readOrders=readCapacityCommitments,planStore=createServicePlanStore(),onFailure}={}){
 if(!pool||!model||[readAvailability,assessBooking,assertWriteAllowed].some(f=>typeof f!=='function'))throw Error('INVALID_AVAILABILITY_CONFIGURATION');
 return async input=>{
  let connection;
  let stage='VALIDATION';
  try{
   if(!Array.isArray(input?.times)||!input.times.length||input.times.length>61||
    new Set(input.times).size!==input.times.length||input.times.some(t=>typeof t!=='string'||!/(Z|[+-]\d\d:\d\d)$/.test(t)||!Number.isFinite(Date.parse(t))))
    return {success:false,statusCode:400,reason:'INVALID_AVAILABILITY_TIMES'};
   const date=localDate(input.times[0]);
   if(input.times.some(t=>localDate(t)!==date))return {success:false,statusCode:400,reason:'SINGLE_SERVICE_DATE_REQUIRED'};
   stage='PRICING';
   const priced=priceBasket(input.items),items=priced.items;
   let delivery=null;
   if(quoteDelivery&&input.orderType==='delivery'){stage='DELIVERY_QUOTE';delivery=await quoteDelivery({address:input.address,subtotalCents:priced.subtotalCents});}
   if(quoteDelivery&&!['collection','delivery'].includes(input.orderType))throw Error('ORDER_TYPE_REQUIRED');
   stage='DB_CONNECT';
   connection=await pool.connect();
   stage='SNAPSHOT_BEGIN';
   if(readSnapshot)await beginHintSnapshot(connection,date);
   else await beginBookingTransaction(connection,{serviceDates:[date]});
   stage='AUTHORITY_CHECK';
   await assertWriteAllowed(connection);
   stage='SNAPSHOT_READ';
   const snapshot=readSnapshot?await readSnapshot(connection,date):{
    now:(await connection.query('SELECT clock_timestamp() AS now')).rows[0]?.now,
    rows:await readOrders(connection,date),availability:await readAvailability(connection,date),previousPlan:await planStore.read(connection,date)};
   const {now,rows,availability,previousPlan}=snapshot;
   stage='ORDER_NORMALIZATION';
   const orders=normalizeStagingOrders({rows,model,serviceDate:date})
    .map(o=>({...o,placedAt:relativePlacement(o.placedAt,date)}));
   // Release the consistent snapshot before routing and CPU search.
   // These are advisory hints, never reservations; checkout
   // always reads and verifies a fresh locked snapshot before committing.
   stage='SNAPSHOT_RELEASE';
   await connection.query('ROLLBACK');
   connection.release();connection=null;
   const hints=[];
   stage='ASSESSMENT';
   for(const time of input.times){
    const local=londonPlacement(time);
    if(local.getSeconds()!==0||local.getMinutes()%5!==0)throw Error('INVALID_HINT_TIME');
    const prepared=prepareStagingBasket({id:'availability-candidate',createdAt:now,serviceDate:date,
     readyMinute:local.getHours()*60+local.getMinutes(),items,model});
    let fits=false,reason=prepared.reason||'BASKET_NOT_PREPARED';
    if(prepared.status==='PREPARED'){
     const result=await assessBooking({assessmentPurpose:includeDiagnostics?'BASKET_REVIEW':'AVAILABILITY_HINT',serviceDate:date,acceptedOrders:orders,rawRows:rows,
      state:{now,availability,previousPlan},proposedOrder:{...prepared.candidate,
       placedAt:relativePlacement(now,date),items:prepared.rawRow.items,rawRow:prepared.rawRow,
       validatedHeader:{preferred_time:time,order_type:input.orderType,...(delivery?{customer_lat:delivery.customerLatitude,customer_lng:delivery.customerLongitude}:{})}}});
     reason=result?.reason||'ASSESSMENT_UNVERIFIED';
     fits=result?.status==='GREEN'&&result.bookingApprovalAllowed===true;
    }
    const driverBusy=!fits&&reason==='DRIVER_UNAVAILABLE';
    const kitchenBusy=!fits&&['FIXED_VESSEL_CAPACITY_EXCEEDED','FIXED_RESOURCE_WINDOW_EXCEEDED','FRYER_WINDOW_CAPACITY_EXCEEDED'].includes(reason);
    hints.push({time,available:fits,unverified:!fits&&!driverBusy&&!kitchenBusy,
     ...(kitchenBusy?{availabilityReason:'KITCHEN_BUSY'}:{}),
     ...(driverBusy?{availabilityReason:'DRIVER_BUSY'}:{}),...(includeDiagnostics?{reason}:{})});
   }
   return {success:true,hints,bookingApprovalAllowed:false};
  }catch(_){
   // Emit only a fixed, non-sensitive stage label. Never log exception text,
   // SQL, customer addresses, baskets or request payloads.
   if(typeof onFailure==='function')try{onFailure({operation:'availability',stage,category:'UNEXPECTED_FAILURE'});}catch(_){}
   if(connection)try{await connection.query('ROLLBACK');}catch(_){}
   return {success:false,statusCode:503,reason:'AVAILABILITY_UNAVAILABLE'};
  }finally{connection?.release();}
 };
}
module.exports={createBasketAvailability};
