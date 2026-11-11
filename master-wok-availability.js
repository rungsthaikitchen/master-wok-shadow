'use strict';
// Basket-specific time hints from the same locked inputs/assessor as checkout.
// Always rolls back: a hint never reserves capacity or approves a booking.
const {beginBookingTransaction}=require('./master-wok-transaction-writer');
const {readCapacityCommitments}=require('./master-wok-commitment-reader');
const {normalizeStagingOrders}=require('./staging-order-snapshot');
const {prepareStagingBasket}=require('./staging-canonical-basket');
const {priceBasket}=require('./master-wok-commercial');
const {createServicePlanStore}=require('./master-wok-service-plan-store');
const {localDate,relativePlacement}=require('./master-wok-clock');
const {londonPlacement}=require('./staging-booking-integration');
function createBasketAvailability({pool,model,readAvailability,assessBooking,assertWriteAllowed,
 includeDiagnostics=false,quoteDelivery,readOrders=readCapacityCommitments,planStore=createServicePlanStore()}={}){
 if(!pool||!model||[readAvailability,assessBooking,assertWriteAllowed].some(f=>typeof f!=='function'))throw Error('INVALID_AVAILABILITY_CONFIGURATION');
 return async input=>{
  let connection;
  try{
   if(!Array.isArray(input?.times)||!input.times.length||input.times.length>61||
    new Set(input.times).size!==input.times.length||input.times.some(t=>typeof t!=='string'||!/(Z|[+-]\d\d:\d\d)$/.test(t)||!Number.isFinite(Date.parse(t))))
    return {success:false,statusCode:400,reason:'INVALID_AVAILABILITY_TIMES'};
   const date=localDate(input.times[0]);
   if(input.times.some(t=>localDate(t)!==date))return {success:false,statusCode:400,reason:'SINGLE_SERVICE_DATE_REQUIRED'};
   const priced=priceBasket(input.items),items=priced.items;
   let delivery=null;
   if(quoteDelivery&&input.orderType==='delivery')delivery=await quoteDelivery({address:input.address,subtotalCents:priced.subtotalCents});
   if(quoteDelivery&&!['collection','delivery'].includes(input.orderType))throw Error('ORDER_TYPE_REQUIRED');
   connection=await pool.connect();await beginBookingTransaction(connection,{serviceDates:[date]});
   await assertWriteAllowed(connection);
   const now=(await connection.query('SELECT clock_timestamp() AS now')).rows[0]?.now;
   const rows=await readOrders(connection,date),orders=normalizeStagingOrders({rows,model,serviceDate:date})
    .map(o=>({...o,placedAt:relativePlacement(o.placedAt,date)}));
   const availability=await readAvailability(connection,date),previousPlan=await planStore.read(connection,date);
   const hints=[];
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
    hints.push({time,available:fits,...(includeDiagnostics?{reason}:{})});
   }
   await connection.query('ROLLBACK');
   return {success:true,hints,bookingApprovalAllowed:false};
  }catch(_){if(connection)try{await connection.query('ROLLBACK');}catch(_){}
   return {success:false,statusCode:503,reason:'AVAILABILITY_UNAVAILABLE'};
  }finally{connection?.release();}
 };
}
module.exports={createBasketAvailability};
