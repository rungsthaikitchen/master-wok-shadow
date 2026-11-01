'use strict';
// Offline-only combination: physical replay plus proposed lead time. Never booking approval.
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {run:compare}=require('./generate-offline-slot-comparison');
const {assess}=require('./staging-proposed-lead-time');
const {assess:assessFryer}=require('./staging-fryer-readiness');
const {plan}=require('./staging-combined-friday-replay');
const {normalizeStagingOrders}=require('./staging-order-snapshot');
const {londonPlacement}=require('./staging-booking-integration');
const {scheduleCrossOrderPanang}=require('./staging-cross-order-scheduler');
const BASKET=[{item_id:'green-curry',qty:2,modifiers:[{id:'chicken'}]},
 {item_id:'pad-thai',qty:1,modifiers:[{id:'chicken'}]},
 {item_id:'stir-crispy',qty:1,modifiers:[]}];
function minute(t){const [h,m]=t.split(':').map(Number);return h*60+m;}
function run(snapshot,html){
 const base=compare(snapshot,html);
 const context=vm.createContext({window:{},Date});
 for(const file of ['master-wok-model-bundle.js','master-wok.js'])
  vm.runInContext(fs.readFileSync(path.join(__dirname,file),'utf8'),context);
 const placedAt=base.bookingMoment;
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(placedAt));
 const hm=Object.fromEntries(parts.filter(p=>['hour','minute'].includes(p.type)).map(p=>[p.type,Number(p.value)]));
 const placedMinute=hm.hour*60+hm.minute;
 const rows=base.rows.map(slot=>{
  if(slot.masterWok!=='PROTOTYPE_FIT')return {...slot,leadTime:'NOT_ASSESSED',combined:'NOT_VERIFIED'};
  const readyMinute=minute(slot.time);
  const candidate={id:'offline-candidate',created_at:placedAt,
   confirmed_time:snapshot.serviceDate+'T'+slot.time+':00Z',local_service_date:snapshot.serviceDate,
   local_ready_minute:readyMinute,status:'completed',items:BASKET};
  try{
   const source=[...snapshot.orders.slice(0,base.priorCount),candidate];
   const orders=normalizeStagingOrders({rows:source,model:context.window.MasterWokModelV1,serviceDate:snapshot.serviceDate})
    .map(o=>({...o,placedAt:londonPlacement(o.placedAt)}));
   const wok=scheduleCrossOrderPanang(orders,source,{sharedRings:true,allowFryerDependent:true});
   if(wok.status!=='PHYSICAL_FIT_PROTOTYPE')return {...slot,leadTime:'UNVERIFIED',combined:'NOT_VERIFIED'};
   const jobs=wok.jobs.filter(j=>j.orderIds.includes('offline-candidate'));
   const check=assess({placedMinute,readyMinute,jobs});
   const fryer=plan(orders,source,wok);
   const fryerCheck=fryer.status==='FRY_PLACED_PROTOTYPE'
    ?assessFryer({placedMinute,cycles:fryer.scheduled,orderId:'offline-candidate',warmupMinutes:5})
    :{status:'UNVERIFIED',reason:fryer.reason,bookingApprovalAllowed:false};
   const coldFryerReady=['COLD_FRYER_READY_IN_TIME','NO_CANDIDATE_FRY_CYCLES'].includes(fryerCheck.status);
   return {...slot,leadTime:check.status,projectedCookingMinutes:check.projectedCookingMinutes??null,
    requiredLeadMinutes:check.requiredMinutes??null,actualLeadMinutes:check.availableMinutes??null,fryerReadiness:fryerCheck.status,
    combined:check.status==='MEETS_PROPOSED_LEAD_TIME'&&coldFryerReady?'PROTOTYPE_FIT_LEAD_AND_COLD_FRYER_ONLY':'NOT_VERIFIED'};
  }catch(e){return {...slot,leadTime:'UNVERIFIED',combined:'NOT_VERIFIED'};}
 });
 return {...base,rows,rule:'Candidate wok job elapsed span + 10 minutes',coldFryerWarmupMinutes:5,
  warning:'Cold-start assumption is conservative, not measured fryer state. Joint wok/fryer optimisation, blackouts, order acknowledgement, historical booking decisions and live availability are not verified.',
  bookingApprovalAllowed:false,comparisonVerified:false};
}
function render(result){
 const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const trs=result.rows.map(r=>'<tr><td>'+esc(r.time)+'</td><td>'+esc(r.masterWok)+'</td><td>'+esc(r.leadTime)+'</td><td>'+esc(r.projectedCookingMinutes??'—')+'</td><td>'+esc(r.requiredLeadMinutes??'—')+'</td><td>'+esc(r.combined)+'</td></tr>').join('');
 return '<!doctype html><html lang="en"><meta charset="utf-8"><title>Master Wok combined offline diagnostic</title><style>body{font:15px system-ui;max-width:1150px;margin:30px auto;padding:0 12px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:8px;text-align:left}th{background:#eee}.warning{padding:14px;background:#fff1d6}</style><h1>Master Wok: combined offline slot diagnostic</h1><p>Booking moment: '+esc(result.bookingMoment)+' · '+esc(result.rule)+'</p><p class="warning"><b>NOT LIVE BOOKING AVAILABILITY.</b> '+esc(result.warning)+' Neither status grants booking approval.</p><table><thead><tr><th>Collection</th><th>Physical prototype</th><th>Lead time</th><th>Cook min</th><th>Required min</th><th>Cold fryer</th><th>Combined diagnostic</th></tr></thead><tbody>'+trs+'</tbody></table></html>';
}
if(require.main===module){
 const [snap,html]=process.argv.slice(2);
 if(!snap||!html)throw Error('Usage: node generate-combined-offline-slot-report.js <snapshot.json> <index.html>');
 const result=run(JSON.parse(fs.readFileSync(snap,'utf8')),fs.readFileSync(html,'utf8'));
 const output='master-wok-combined-offline-slots.html';
 fs.writeFileSync(output,render(result));
 console.log('Created '+output+'; physicalFit='+result.rows.filter(r=>r.masterWok==='PROTOTYPE_FIT').length+
  '; meetsLeadAndColdFryer='+result.rows.filter(r=>r.combined==='PROTOTYPE_FIT_LEAD_AND_COLD_FRYER_ONLY').length+
  '; bookingApprovalAllowed=false');
}
module.exports={run,render};
