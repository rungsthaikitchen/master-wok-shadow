'use strict';
const {readStagingOrders}=require('./staging-order-reader');
const {normalizeStagingOrders}=require('./staging-order-snapshot');
const {reserveWithMasterWok}=require('./master-wok-transaction-writer');

// Staging integration seam. Database writes remain INJECTED and must insert
// header, items and reservation together on the locked connection.
// This module has no credentials and does not deploy to checkout.
function londonPlacement(instant) {
  const dt=new Date(instant);
  if(!Number.isFinite(dt.getTime())) throw Error('INVALID_PLACEMENT');
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
    timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'
  }).formatToParts(dt).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
  // Master Wok uses Date#getHours(); encode London wall clock as local Date.
  return new Date(parts.year,parts.month-1,parts.day,parts.hour,parts.minute,parts.second);
}
function normalizePlacedAt(orders) {
  return orders.map(order=>({...order,placedAt:londonPlacement(order.placedAt)}));
}
async function bookStagingCandidate({connection,serviceDate,key,candidate,model,engine,lookupKey,persist}) {
  if(!model || !engine || typeof engine.assessCapacityV1!=='function' ||
      typeof lookupKey!=='function' || typeof persist!=='function') {
    return {status:'UNVERIFIED',committed:false,reason:'INVALID_REQUEST'};
  }
  return reserveWithMasterWok({
    connection,serviceDate,key,candidate,
    readCommitted:async(conn,ctx)=>{
      const rows=await readStagingOrders(conn,ctx.serviceDate);
      const acceptedOrders=normalizePlacedAt(normalizeStagingOrders({rows,model,serviceDate:ctx.serviceDate}));
      const existingKey=await lookupKey(conn,ctx.key);
      return {acceptedOrders,existingKey};
    },
    assess:async({acceptedOrders,proposedOrder})=>{
      const localCandidate={...proposedOrder,placedAt:londonPlacement(proposedOrder.placedAt)};
      return engine.assessCapacityV1({acceptedOrders,proposedOrder:localCandidate});
    },
    persist
  });
}
module.exports={bookStagingCandidate,londonPlacement};
