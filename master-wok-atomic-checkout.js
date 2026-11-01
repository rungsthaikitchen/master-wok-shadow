'use strict';
// Existing components joined at the single server-side checkout boundary.
// No HTTP server or production wiring is installed by importing this module.
const {reserveWithMasterWok}=require('./master-wok-transaction-writer');
const {readCapacityCommitments}=require('./master-wok-commitment-reader');
const {normalizeStagingOrders}=require('./staging-order-snapshot');
const {londonPlacement}=require('./staging-booking-integration');
const {prepareStagingBasket}=require('./staging-canonical-basket');
const {createOrderStore}=require('./master-wok-order-store');
const {createServicePlanStore,remapPlanOrder}=require('./master-wok-service-plan-store');
const {localDate,relativePlacement}=require('./master-wok-clock');
function createAtomicCheckout({pool,model,validateCommercialOrder,readAvailability,assessBooking,
 store=createOrderStore(),planStore=createServicePlanStore(),readOrders=readCapacityCommitments,mode='LEGACY'}={}){
 if(!pool||typeof pool.connect!=='function'||!model||
  typeof validateCommercialOrder!=='function'||typeof readAvailability!=='function'||
  typeof assessBooking!=='function')throw Error('MISSING_TRUSTED_CHECKOUT_DEPENDENCY');
 return async function checkout(request){
  const fail=reason=>({status:'UNVERIFIED',committed:false,reason});
  if(mode==='LEGACY')return {status:'LEGACY',committed:false,reason:'USE_EXISTING_CHECKOUT'};
  if(mode!=='MASTER_WOK')return fail('INVALID_BOOKING_MODE');
  // The mode and dependencies are server bootstrap settings, never request fields.
  if(!request||typeof request.key!=='string'||!request.key.trim()||request.key.length>128||
    typeof request.preferredTime!=='string'||!/(Z|[+-]\d\d:\d\d)$/.test(request.preferredTime))
   return fail('INVALID_REQUEST');
  let serviceDate,connection;
  try{serviceDate=localDate(request.preferredTime);connection=await pool.connect();}
  catch(_){return fail('CONNECTION_OR_TIME_INVALID');}
  try{
   return await reserveWithMasterWok({connection,serviceDate,key:request.key,candidate:request,
    readCommitted:async(c)=>{
     const existingKey=await store.lookupKey(c,request.key);
     if(existingKey)return {acceptedOrders:[],existingKey};
     const rawRows=await readOrders(c,serviceDate);
     const acceptedOrders=normalizeStagingOrders({rows:rawRows,model,serviceDate})
      .map(o=>({...o,placedAt:relativePlacement(o.placedAt,serviceDate)}));
     const previousPlan=await planStore.read(c,serviceDate);
     const availability=await readAvailability(c,serviceDate);
     if(!availability)throw Error('MISSING_AUTHORITATIVE_AVAILABILITY');
     const clock=await c.query('SELECT clock_timestamp() AS now');
     const now=clock.rows[0]?.now;
     if(!now||!Number.isFinite(new Date(now).getTime()))throw Error('INVALID_SERVER_CLOCK');
     return {acceptedOrders,rawRows,availability,now,previousPlan};
    },
    prepareCandidate:async(input,c,state)=>{
     // Commercial validation must derive prices, delivery, discounts and loyalty
     // from trusted server data. It must not simply echo a browser payload.
     const commercial=await validateCommercialOrder(c,input,state);
     if(!commercial||!commercial.header||!Array.isArray(commercial.items))
      throw Error('COMMERCIAL_VALIDATION_FAILED');
     if(new Date(commercial.header.preferred_time).getTime()!==new Date(input.preferredTime).getTime())
      throw Error('VALIDATION_CHANGED_SERVICE_TIME');
     const ready=londonPlacement(input.preferredTime);
     const prepared=prepareStagingBasket({id:'candidate:'+input.key,createdAt:state.now,
      readyMinute:ready.getHours()*60+ready.getMinutes(),serviceDate,
      items:commercial.items,model});
     if(prepared.status!=='PREPARED')throw Error(prepared.reason);
     return {...prepared.candidate,placedAt:relativePlacement(state.now,serviceDate),
      items:prepared.rawRow.items,rawRow:prepared.rawRow,validatedHeader:commercial.header,
      validatedItems:commercial.items};
    },
    assess:async context=>{
     const result=await assessBooking({...context,serviceDate});
     // Only a separately certified authoritative assessor can authorize writes.
     // An otherwise GREEN prototype never receives authority here.
     return result?.bookingApprovalAllowed===true?result:
      {status:'UNVERIFIED',bookingApprovalAllowed:false,reason:'UNCERTIFIED_BOOKING_ASSESSMENT'};
    },
    persist:async(c,data)=>{
     if(!data.assessment?.plan)throw Error('VALIDATED_SERVICE_PLAN_REQUIRED');
     const response=await store.persist(c,data);
     const savedId=String(response.orderId)+'@'+new Date(data.candidate.validatedHeader.preferred_time).toISOString();
     const plan=remapPlanOrder(data.assessment.plan,data.candidate.orderId,savedId);
     await planStore.save(c,serviceDate,plan);
     return response;
    }
   });
  }finally{connection.release();}
 };
}
module.exports={createAtomicCheckout,localDate,relativePlacement};
