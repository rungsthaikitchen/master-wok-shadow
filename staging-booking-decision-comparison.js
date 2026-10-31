'use strict';
// Offline/staging diagnostic only. No database access, writes or checkout imports.
// Reconstructs booking-time knowledge from order creation timestamps; historical
// confirmed times are NOT proof of the offers available at that moment.
const {replay}=require('./staging-combined-friday-replay');

function compareHistoricalDecisions(snapshot, {legacyAssess}={}) {
  if (!snapshot || !Array.isArray(snapshot.orders) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(snapshot.serviceDate || ''))
    throw Error('INVALID_SNAPSHOT');
  // Replay itself is a prototype and cannot authorise bookings.
  const physical=replay(snapshot);
  const events=[];
  for(let i=0;i<snapshot.orders.length;i++){
    const order=snapshot.orders[i];
    const stage=physical.outcomes[i];
    const prior=snapshot.orders.slice(0,i);
    const timestamp=new Date(order?.created_at);
    const ready=order?.local_ready_minute;
    const valid=Number.isFinite(timestamp.getTime()) &&
      Number.isFinite(ready) && ready>=0 && ready<1440 &&
      prior.every(p=>Number.isFinite(new Date(p.created_at).getTime()) &&
        new Date(p.created_at).getTime()<=timestamp.getTime());
    let legacy={status:'UNVERIFIED',reason:'LEGACY_DECISION_HISTORY_UNAVAILABLE'};
    if(typeof legacyAssess==='function' && valid){
      try {
        const result=legacyAssess({acceptedOrders:prior,proposedOrder:order,serviceDate:snapshot.serviceDate});
        if(result && typeof result.then==='function')throw Error('ASYNC_ASSESSOR_UNSUPPORTED');
        // A reconstructed assessment is not an observed historical offer.
        if(result && typeof result.status==='string')
          legacy={status:result.status,reason:'RECONSTRUCTED_NOT_HISTORICAL_DECISION'};
      }catch(_){legacy={status:'UNVERIFIED',reason:'LEGACY_ASSESSMENT_FAILED'};}
    }
    const physicalFit=valid && stage?.wokStatus==='PHYSICAL_FIT_PROTOTYPE' &&
      stage?.fryerStatus==='FRY_PLACED_PROTOTYPE';
    events.push({
      orderNumber:i+1,
      placedAt:valid?timestamp.toISOString():null,
      requestedReadyMinute:valid?ready:null,
      legacy,
      masterWok:{status:physicalFit?'PROTOTYPE_FIT':'UNVERIFIED',
        reason:!valid?'INVALID_OR_OUT_OF_ORDER_HISTORY':
          physicalFit?'MODELLED_RESOURCES_ONLY':'PHYSICAL_FIT_UNVERIFIED',
        wokStatus:stage?.wokStatus??'UNVERIFIED',
        fryerStatus:stage?.fryerStatus??'UNVERIFIED'},
      comparison:'UNVERIFIED', // no booking-time legacy decision history
      bookingApprovalAllowed:false
    });
  }
  return {serviceDate:snapshot.serviceDate,ordersCompared:events.length,
    decisionHistoryAvailable:false,comparisonVerified:false,
    limitations:['Final-state order snapshot is not booking-time decision history',
      'Chef attention and some starter operations remain unmodelled',
      'Prototype fit is not authority to accept a booking'],
    events,bookingApprovalAllowed:false};
}
module.exports={compareHistoricalDecisions};
