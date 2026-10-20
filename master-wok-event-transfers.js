'use strict';
// Pair evidence is checked offline; this does not prove database atomicity or activity.
const {isDeepStrictEqual}=require('node:util');
const {validateEventBatch}=require('./master-wok-chronological-replay');
function validateTransferPair(source,destination,transferId,{enabled=false}={}){
 if(enabled!==true)return {status:'DISABLED',verified:false,networkRequests:0};
 try{
  const a=validateEventBatch(source).filter(e=>e.transferId===transferId),b=validateEventBatch(destination).filter(e=>e.transferId===transferId);
  if(a.length!==1||b.length!==1||a[0].kind!=='RESERVATION_TRANSFERRED_OUT'||b[0].kind!=='RESERVATION_TRANSFERRED_IN'||a[0].orderId!==b[0].order.orderId||a[0].at!==b[0].at||a[0].toServiceDate!==destination.serviceDate||b[0].fromServiceDate!==source.serviceDate)throw Error();
  let held;
  for(const e of source.events.slice().sort((x,y)=>x.sequence-y.sequence)){
   if(e.sequence>=a[0].sequence)break;
   if((e.orderId||e.order?.orderId)!==a[0].orderId)continue;
   if(e.kind==='RESERVATION_RELEASED'||e.kind==='RESERVATION_TRANSFERRED_OUT'||(e.kind==='PROPOSAL_RESPONSE'&&e.response==='REJECTED'))held=null;
   else if(e.kind==='RESERVATION_SET'||e.kind==='RESERVATION_TRANSFERRED_IN'||['ACCEPTED','SUGGESTED'].includes(e.actualDecision))held=e.order;
  }
  if(!held||held.orderType!==b[0].order.orderType||!isDeepStrictEqual(held.lines,b[0].order.lines))throw Error();
  return {status:'PAIRED',transferId,sourceEventId:a[0].eventId,destinationEventId:b[0].eventId,verified:false,networkRequests:0};
 }catch(_){return {status:'UNVERIFIED',reasonCode:'TRANSFER_PAIR_UNVERIFIED',verified:false,networkRequests:0};}
}
module.exports={validateTransferPair};
