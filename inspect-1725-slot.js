'use strict';
// Offline 17:25 forensic trace. Never writes, never approves bookings.
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {run}=require('./generate-offline-slot-comparison');
const {normalizeStagingOrders}=require('./staging-order-snapshot');
const {londonPlacement}=require('./staging-booking-integration');
const {scheduleCrossOrderPanang}=require('./staging-cross-order-scheduler');
const {plan}=require('./staging-combined-friday-replay');
const {reconstructLegacySlots}=require('./staging-legacy-capacity-reconstruction');
const {extractMenuLoads}=require('./audit-legacy-menu-loads');
const BASKET=[{item_id:'green-curry',qty:2,modifiers:[{id:'chicken'}]},{item_id:'pad-thai',qty:1,modifiers:[{id:'chicken'}]},{item_id:'stir-crispy',qty:1,modifiers:[]}];
const clock=n=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
function inspect(snapshot,html){
 const comparison=run(snapshot,html,{priorCount:4});
 const slot=comparison.rows.find(r=>r.time==='17:25');
 if(!slot)throw Error('MISSING_SLOT');
 const prior=snapshot.orders.slice(0,4);
 const candidate={id:'offline-candidate',created_at:snapshot.orders[4].created_at,
  confirmed_time:snapshot.serviceDate+'T17:25:00Z',local_service_date:snapshot.serviceDate,
  local_ready_minute:1045,status:'completed',items:BASKET};
 const rows=[...prior,candidate];
 const context=vm.createContext({window:{},Date});
 for(const file of ['master-wok-model-bundle.js','master-wok.js'])
  vm.runInContext(fs.readFileSync(path.join(__dirname,file),'utf8'),context);
 const orders=normalizeStagingOrders({rows,model:context.window.MasterWokModelV1,serviceDate:snapshot.serviceDate})
  .map(o=>({...o,placedAt:londonPlacement(o.placedAt)}));
 const wok=scheduleCrossOrderPanang(orders,rows,{sharedRings:true,allowFryerDependent:true});
 const fryer=plan(orders,rows,wok);
 const menu=extractMenuLoads(html);
 const enriched={...snapshot,orders:snapshot.orders.map(o=>({...o,items:o.items.map(i=>({...i,kitchen_load:menu.get(i.item_id).kitchenLoad}))}))};
 const legacy=reconstructLegacySlots(enriched,{priorCount:4,candidateLoad:4});
 const booking=new Date(candidate.created_at);
 const local=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(booking);
 const bookingMinute=Number(local.slice(0,2))*60+Number(local.slice(3,5));
 return {slot:'17:25',bookingMomentUTC:candidate.created_at,bookingMomentUK:local,
  minutesFromBookingToCollection:1045-bookingMinute,
  candidateLoad:4,legacyCapacityFit:slot.legacyCapacityFit,
  masterWokPrototype:slot.masterWok,
  priorOrders:prior.map(o=>({id:o.id,ready:clock(o.local_ready_minute),items:o.items.map(i=>({id:i.item_id,qty:i.qty}))})),
  wokStatus:wok.status,wokReason:wok.reason,
  wokJobs:(wok.jobs||[]).map(j=>({itemId:j.itemId,group:j.group,
   orderIds:j.orderIds,start:clock(j.start),finish:clock(j.finish),
   ready:clock(j.readyMinute),portions:j.portions,holdingMinutes:j.holdingMinutes})),
  fryerStatus:fryer.status,fryerReason:fryer.reason,
  fryerCycles:fryer.scheduled||[],fryerFailures:fryer.failures||[],
  missingChecks:['customer lead-time policy','blackouts','chef attention','unmodelled starters','historical decision evidence'],
  comparisonVerified:false,bookingApprovalAllowed:false};
}
if(require.main===module){
 const [snap,html]=process.argv.slice(2);
 if(!snap||!html)throw Error('Usage: node inspect-1725-slot.js <snapshot.json> <index.html>');
 console.log(JSON.stringify(inspect(JSON.parse(fs.readFileSync(snap,'utf8')),fs.readFileSync(html,'utf8')),null,2));
}
module.exports={inspect};
