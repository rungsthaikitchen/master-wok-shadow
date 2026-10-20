'use strict';
// Offline only. No source, route, persistence or booking-decision client.
const {validServiceDate}=require('./master-wok-live-shadow');
const {createReplayAssessment}=require('./master-wok-server-adapter');
const {performance}=require('node:perf_hooks');
const EVIDENCE='RECORDED_EVENTS_WITH_HYPOTHETICAL_KITCHEN_ASSESSMENTS';
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&
 Object.keys(value).sort().join()===keys.slice().sort().join();
const id=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(value);
function stamp(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)||
 !validServiceDate(value.slice(0,10))||!Number.isFinite(Date.parse(value)))throw Error('EVENT_TIME_REQUIRED');
 // Date.parse normalizes invalid hours, so reject those explicitly.
 if(Number(value.slice(11,13))>23||Number(value.slice(14,16))>59||Number(value.slice(17,19))>59)throw Error('EVENT_TIME_REQUIRED');
 return Date.parse(value);
}
function local(value){
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(stamp(value)));
 const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
 return {day:`${p.year}-${p.month}-${p.day}`,minute:Number(p.hour)*60+Number(p.minute)+Number(p.second)/60};
}
function validateOrder(order,day,at){
 if(!exact(order,['orderId','orderType','targetAt','lines','deliveryReadyEstimate'])||!id(order.orderId)||
 !['collection','delivery'].includes(order.orderType)||!Array.isArray(order.lines)||!order.lines.length||order.lines.length>100)throw Error('ORDER_CONTRACT_REQUIRED');
 const target=local(order.targetAt);
 if(target.day!==day||target.minute<990||target.minute>1320)throw Error('SERVICE_TARGET_REQUIRED');
 for(const line of order.lines){
  if(!exact(line,['itemId','qty','mods'])||!id(line.itemId)||!Number.isSafeInteger(line.qty)||line.qty<1||line.qty>100||
   !Array.isArray(line.mods)||line.mods.length>30||line.mods.some(m=>!exact(m,['id'])||!id(m.id)))throw Error('BASKET_CONTRACT_REQUIRED');
 }
 if(order.orderType==='collection'&&order.deliveryReadyEstimate!==null)throw Error('COLLECTION_ESTIMATE_REFUSED');
 if(order.orderType==='delivery'&&order.deliveryReadyEstimate!==null){
  const e=order.deliveryReadyEstimate;
  if(!(exact(e,['foodReadyAt','estimatedAt','basis'])||exact(e,['foodReadyAt','estimatedAt','basis','arrivalAt']))||e.basis!=='DELIVERY_PLANNER_ESTIMATE'||
    stamp(e.estimatedAt)>stamp(at)||stamp(e.foodReadyAt)>=stamp(e.arrivalAt||order.targetAt)||
    (e.arrivalAt!==undefined&&(Math.abs(stamp(e.arrivalAt)-stamp(order.targetAt))>10*60000||local(e.arrivalAt).day!==day))||
    local(e.foodReadyAt).day!==day)throw Error('DELIVERY_ESTIMATE_CONTRACT_REQUIRED');
 }
}
function ready(order,at){
 if(order.orderType==='collection')return local(order.targetAt).minute;
 const e=order.deliveryReadyEstimate;
 if(!e)return null;
 if(stamp(at)-stamp(e.estimatedAt)>30*60000)return null;
 const elapsed=stamp(e.arrivalAt||order.targetAt)-stamp(e.foodReadyAt);
 if(elapsed>20*60000||elapsed<2*60000)return null;
 const minute=local(e.foodReadyAt).minute;
 return minute>=990&&minute<=1320?minute:null;
}
function validateEventBatch(input){
  if(!exact(input,['serviceDate','coverage','events'])||!validServiceDate(input.serviceDate)||
   !Array.isArray(input.events)||input.events.length>1000||
   !exact(input.coverage,['basis','complete','eventCount','firstSequence','lastSequence','initialState','throughAt'])||
   input.coverage.basis!=='DECISION_EVENT_LOG'||input.coverage.complete!==true||
   input.coverage.initialState!=='NO_PRIOR_SERVICE_COMMITMENTS'||
   input.coverage.eventCount!==input.events.length||input.coverage.firstSequence!==1||
   input.coverage.lastSequence!==input.events.length)throw Error('COMPLETE_EVENT_COVERAGE_REQUIRED');
  if(Buffer.byteLength(JSON.stringify(input))>5000000)throw Error('EVENT_INPUT_TOO_LARGE');
  const through=stamp(input.coverage.throughAt);
  const events=structuredClone(input.events).sort((a,b)=>a.sequence-b.sequence);
  const ids=new Set();let prior=-Infinity;
  for(const [index,event] of events.entries()){
   if(!event||!id(event.eventId)||ids.has(event.eventId)||event.sequence!==index+1||
    !['RESERVATION_SET','RESERVATION_RELEASED','BOOKING_DECISION','PROPOSAL_RESPONSE','ORDER_STATE_CHANGED'].includes(event.kind)||
    stamp(event.at)<prior||stamp(event.at)>through||local(event.at).day>input.serviceDate)throw Error('EVENT_SEQUENCE_UNVERIFIED');
   prior=stamp(event.at);ids.add(event.eventId);
   if(event.kind==='PROPOSAL_RESPONSE'){
    if(!exact(event,['eventId','sequence','at','kind','orderId','proposalEventId','response'])||
     !id(event.orderId)||!id(event.proposalEventId)||!['ACCEPTED','REJECTED'].includes(event.response))throw Error('PROPOSAL_RESPONSE_REQUIRED');
   }else if(event.kind==='ORDER_STATE_CHANGED'){
    if(!exact(event,['eventId','sequence','at','kind','orderId','status'])||!id(event.orderId)||
     !['CANCELLED','COMPLETED'].includes(event.status))throw Error('ORDER_STATE_CONTRACT_REQUIRED');
   }else if(event.kind==='RESERVATION_RELEASED'){
    if(!exact(event,['eventId','sequence','at','kind','orderId','reason'])||!id(event.orderId)||
     !['CANCELLED','COMPLETED'].includes(event.reason))throw Error('RELEASE_CONTRACT_REQUIRED');
   }else{
    const extra=event.kind==='RESERVATION_SET'?'commitment':'actualDecision';
    if(!exact(event,['eventId','sequence','at','kind','order',extra])||
     !(event.kind==='RESERVATION_SET'?['PROPOSED','CONFIRMED']:['ACCEPTED','DECLINED','SUGGESTED']).includes(event[extra]))throw Error('EVENT_CONTRACT_REQUIRED');
    validateOrder(event.order,input.serviceDate,event.at);
   }
  }
  // Reject stale responses at ingress, before persistence or any assessment.
  const proposals=new Map(), held=new Set(), known=new Set(), closed=new Set();
  for(const event of events){
   const orderId=event.orderId||event.order.orderId;
   if(event.kind==='PROPOSAL_RESPONSE'&&proposals.get(orderId)!==event.proposalEventId)throw Error('STALE_PROPOSAL_RESPONSE');
   if(closed.has(orderId))throw Error('ORDER_ALREADY_CLOSED');
   if(event.kind==='ORDER_STATE_CHANGED'){
    if(!known.has(orderId)||held.has(orderId))throw Error('ORDER_STATE_CHANGE_REQUIRED');
    closed.add(orderId);continue;
   }
   known.add(orderId);
   if(event.kind==='RESERVATION_RELEASED'){
    if(!held.delete(orderId))throw Error('UNKNOWN_RESERVATION_RELEASE');
    closed.add(orderId);
   }else if(event.kind==='PROPOSAL_RESPONSE'&&event.response==='REJECTED')held.delete(orderId);
   else if(event.kind==='RESERVATION_SET'||['ACCEPTED','SUGGESTED'].includes(event.actualDecision))held.add(orderId);
   if(event.kind==='PROPOSAL_RESPONSE'){
    if(proposals.get(orderId)!==event.proposalEventId)throw Error('STALE_PROPOSAL_RESPONSE');
    proposals.delete(orderId);
   }else if(event.kind==='RESERVATION_RELEASED')proposals.delete(orderId);
   else if(event.commitment==='PROPOSED'||event.actualDecision==='SUGGESTED')proposals.set(orderId,event.eventId);
   else if(event.commitment==='CONFIRMED'||event.actualDecision==='ACCEPTED')proposals.delete(orderId);
  }
  return events;
}
function replay(input,{enabled=false,assess,clock=()=>performance.now(),maxElapsedMs=30000}={}){
 if(enabled!==true)return {status:'DISABLED',verified:false,networkRequests:0};
 const fail=reasonCode=>({status:'UNVERIFIED',reasonCode,verified:false,networkRequests:0,observations:[]});
 try{
  if(!Number.isSafeInteger(maxElapsedMs)||maxElapsedMs<1||maxElapsedMs>60000)throw Error('REPLAY_BUDGET_REQUIRED');
  const started=clock();
  if(!Number.isFinite(started))throw Error('REPLAY_BUDGET_REQUIRED');
  const events=validateEventBatch(input);
  const active=new Map(),observations=[];
  function reserve(order,at,commitment){
   // An offer replaces the prior target immediately, even before acceptance.
   active.set(order.orderId,{order,at,commitment});
  }
  for(const event of events){
   const elapsed=clock()-started;
   if(!Number.isFinite(elapsed)||elapsed<0||elapsed>maxElapsedMs)throw Error('REPLAY_TIME_BUDGET_EXHAUSTED');
   if(event.kind==='PROPOSAL_RESPONSE'){
    if(event.response==='REJECTED')active.delete(event.orderId);
    else active.get(event.orderId).commitment='CONFIRMED';
    continue;
   }
   if(event.kind==='ORDER_STATE_CHANGED')continue;
   if(event.kind==='RESERVATION_RELEASED'){
    if(!active.delete(event.orderId))throw Error('UNKNOWN_RESERVATION_RELEASE');
    continue;
   }
   if(event.kind==='RESERVATION_SET'){
    reserve(event.order,event.at,event.commitment);continue;
   }
   // A replacement is assessed against all OTHER commitments; no self-conflict.
   const prior=[...active.values()].filter(r=>r.order.orderId!==event.order.orderId);
   const all=[...prior.map(r=>r.order),event.order];
   const minutes=all.map(o=>ready(o,event.at));
   let result;
   if(minutes.some(x=>x===null))result={status:'UNVERIFIED',reasonCode:'DELIVERY_READY_ESTIMATE_REQUIRED'};
   else if(prior.some(r=>stamp(r.at)===stamp(event.at)))
    // Current adapter cannot represent same-clock ordering without inventing time.
    result={status:'UNVERIFIED',reasonCode:'ASSESSMENT_CLOCK_TIE_UNSUPPORTED'};
   else{
    const reservations=prior.map((r,i)=>({orderId:r.order.orderId,placedAt:r.at,readyMinute:minutes[i],lines:r.order.lines}));
    assess=assess||createReplayAssessment();
    result=assess(structuredClone({serviceDate:input.serviceDate,snapshot:{complete:true,basis:'PRE_DECISION_HISTORY',
     decisionAt:event.at,reservations,proposed:{orderId:event.order.orderId,readyMinute:minutes.at(-1),lines:event.order.lines}}}));
    if(!result||!['GREEN','AMBER','UNVERIFIED'].includes(result.status))throw Error('ASSESSOR_CONTRACT_REQUIRED');
   }
   const reason=['DELIVERY_READY_ESTIMATE_REQUIRED','ASSESSMENT_CLOCK_TIE_UNSUPPORTED','HYPOTHETICAL_REPLAY',
    'REPLAY_UNVERIFIED','SNAPSHOT_TOO_LARGE','SERVICE_TIMEZONE_REQUIRED','ASSESSMENT_INPUT_OR_SEARCH_ERROR','SNAPSHOT_UNVERIFIED'].includes(result.reasonCode)?result.reasonCode:'ASSESSMENT_UNVERIFIED';
   observations.push({eventId:event.eventId,sequence:event.sequence,orderId:event.order.orderId,
    decisionAt:event.at,actualDecision:event.actualDecision,prediction:result.status,reasonCode:reason,
    priorCommitments:prior.length,priorProposed:prior.filter(r=>r.commitment==='PROPOSED').length,
    kitchenReadyMinute:minutes.at(-1),verified:false});
   // Recorded decisions determine reservations, never the model's recommendation.
   if(event.actualDecision!=='DECLINED')reserve(event.order,event.at,
    event.actualDecision==='ACCEPTED'?'CONFIRMED':'PROPOSED');
  }
  return {status:'REPLAYED',verified:false,networkRequests:0,serviceDate:input.serviceDate,
   evidenceBasis:EVIDENCE,coverageThroughAt:input.coverage.throughAt,decisionCount:observations.length,remainingCommitments:active.size,observations};
 }catch(error){
  const safe=['COMPLETE_EVENT_COVERAGE_REQUIRED','EVENT_SEQUENCE_UNVERIFIED','EVENT_TIME_REQUIRED',
   'ORDER_CONTRACT_REQUIRED','SERVICE_TARGET_REQUIRED','BASKET_CONTRACT_REQUIRED','COLLECTION_ESTIMATE_REFUSED',
   'DELIVERY_ESTIMATE_CONTRACT_REQUIRED','RELEASE_CONTRACT_REQUIRED','EVENT_CONTRACT_REQUIRED',
   'ORDER_STATE_CONTRACT_REQUIRED','ORDER_STATE_CHANGE_REQUIRED','ORDER_ALREADY_CLOSED','PROPOSAL_RESPONSE_REQUIRED','STALE_PROPOSAL_RESPONSE','UNKNOWN_RESERVATION_RELEASE','ASSESSOR_CONTRACT_REQUIRED','REPLAY_BUDGET_REQUIRED','REPLAY_TIME_BUDGET_EXHAUSTED','EVENT_INPUT_TOO_LARGE'];
  return fail(safe.includes(error.message)?error.message:'CHRONOLOGICAL_REPLAY_FAILED');
 }
}
module.exports={replay,validateEventBatch};
if(require.main===module){
 if(process.env.MASTER_WOK_EVENT_REPLAY_ENABLED!=='true'){
  process.stdout.write(JSON.stringify(replay(null)));
 }else{
  let text='',bytes=0,refused=false;
  process.stdin.on('data',chunk=>{bytes+=chunk.length;if(bytes>5000000){refused=true;text='';}else if(!refused)text+=chunk;});
  process.stdin.on('end',()=>{
   let result;
   try{if(refused)throw Error();const input=JSON.parse(text);
    if(process.env.MASTER_WOK_EVENT_VALIDATE_ONLY==='true'){const events=validateEventBatch(input);result={status:'VALIDATED',eventCount:events.length,serviceDate:input.serviceDate};}
    else result=replay(input,{enabled:true});}
   catch(_){result={status:'UNVERIFIED',reasonCode:'EVENT_INPUT_REFUSED',verified:false,networkRequests:0,observations:[]};}
   process.stdout.write(JSON.stringify(result));
   if(!['REPLAYED','VALIDATED'].includes(result.status))process.exitCode=1;
  });
 }
}
