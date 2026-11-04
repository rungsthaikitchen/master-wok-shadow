'use strict';
// Offline per-slot diagnostic, no production access, writes or booking authority.
// Uses the same prior orders and a fixed basket in both models. Master Wok's
// existing replay is a prototype; UNVERIFIED is never interpreted as blocked.
const fs=require('node:fs');
const {audit,extractMenuLoads}=require('./audit-legacy-menu-loads');
const {reconstructLegacySlots}=require('./staging-legacy-capacity-reconstruction');
const {replay}=require('./staging-combined-friday-replay');
const BASKET=[
 {item_id:'green-curry',qty:2,modifiers:[{id:'chicken'}]},
 {item_id:'pad-thai',qty:1,modifiers:[{id:'chicken'}]},
 {item_id:'stir-crispy',qty:1,modifiers:[]}
];
function clock(n){return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');}
function run(snapshot,html,{priorCount=4}={}){
 const mapping=audit(snapshot,html);
 if(mapping.status!=='MENU_DERIVED_ESTIMATE')throw Error('INCOMPLETE_MENU_MAPPING');
 if(!Number.isInteger(priorCount)||priorCount<0||priorCount>=snapshot.orders.length)throw Error('INVALID_PRIOR_COUNT');
 const menu=extractMenuLoads(html);
 for(const item of BASKET)if(!menu.has(item.item_id))throw Error('CANDIDATE_ITEM_NOT_IN_MENU_'+item.item_id);
 const enriched={...snapshot,orders:snapshot.orders.map(o=>({...o,items:o.items.map(i=>({...i,kitchen_load:menu.get(i.item_id).kitchenLoad}))}))};
 const candidateLoad=BASKET.reduce((sum,i)=>sum+i.qty*menu.get(i.item_id).kitchenLoad,0);
 const legacy=reconstructLegacySlots(enriched,{priorCount,candidateLoad});
 if(legacy.status==='UNVERIFIED')throw Error('LEGACY_RECONSTRUCTION_UNVERIFIED');
 // Booking moment is the next historical order's creation time, not the
 // final collection time. Only orders placed before it can be commitments.
 const placedAt=snapshot.orders[priorCount].created_at;
 const placedDate=new Date(placedAt);
 if(!Number.isFinite(placedDate.getTime()))throw Error('INVALID_BOOKING_MOMENT');
 const localParts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(placedDate);
 const hm=Object.fromEntries(localParts.filter(p=>p.type==='hour'||p.type==='minute').map(p=>[p.type,Number(p.value)]));
 const bookingMinute=hm.hour*60+hm.minute;
 const rows=[];
 for(const slot of legacy.slots){
  const minute=Number(slot.time.slice(0,2))*60+Number(slot.time.slice(3));
  if(minute<=bookingMinute){rows.push({...slot,masterWok:'NOT_TESTED_PAST_TIME'});continue;}
  const candidate={id:'offline-candidate',created_at:placedAt,
   confirmed_time:snapshot.serviceDate+'T'+slot.time+':00Z',
   local_service_date:snapshot.serviceDate,local_ready_minute:minute,
   status:'completed',items:BASKET};
  try{
   const result=replay({...snapshot,orders:[...snapshot.orders.slice(0,priorCount),candidate]});
   const last=result.outcomes.at(-1);
   rows.push({...slot,masterWok:last?.wokStatus==='PHYSICAL_FIT_PROTOTYPE'&&last?.fryerStatus==='FRY_PLACED_PROTOTYPE'?'PROTOTYPE_FIT':'UNVERIFIED',
    wokStatus:last?.wokStatus||'UNVERIFIED',fryerStatus:last?.fryerStatus||'UNVERIFIED'});
  }catch(e){rows.push({...slot,masterWok:'UNVERIFIED',reason:'REPLAY_ERROR'});}
 }
 return {serviceDate:snapshot.serviceDate,priorCount,bookingMoment:placedAt,candidateLoad,
  basket:BASKET,rows,comparisonVerified:false,bookingApprovalAllowed:false};
}
function render(result){
 const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const rows=result.rows.map(r=>'<tr><td>'+r.time+'</td><td>'+(r.legacyCapacityFit?'FIT':'BLOCKED')+'</td><td>'+esc(r.masterWok)+'</td><td>'+esc(r.wokStatus||'—')+'</td><td>'+esc(r.fryerStatus||'—')+'</td></tr>').join('');
 return '<!doctype html><html lang="en"><meta charset="utf-8"><title>Offline slot comparison</title><style>body{font:16px system-ui;max-width:980px;margin:35px auto;padding:0 16px;background:#f8fafc;color:#182333}table{border-collapse:collapse;width:100%;background:white}th,td{padding:9px;border-bottom:1px solid #ddd;text-align:left}th{background:#e7edf5}.warning{padding:16px;background:#fff2d4;border-left:4px solid #c80}</style><h1>Friday: offline five-minute slot diagnostic</h1><p>Prior orders: '+result.priorCount+' · Booking moment (UTC): '+esc(result.bookingMoment)+' · Candidate legacy load: '+result.candidateLoad+'</p><p>Basket: 2 × green curry (chicken), 1 × Pad Thai (chicken), 1 × crispy chicken stir-fry</p><div class="warning"><b>Not verified booking availability.</b> Legacy results reconstruct capacity only using current menu-derived loads; lead times, blackouts and historical offers are excluded. Master Wok results are prototype physical-resource fits only; UNVERIFIED does not mean blocked. Neither side may approve bookings.</div><table><thead><tr><th>Collection</th><th>Legacy capacity</th><th>Master Wok</th><th>Wok</th><th>Fryer</th></tr></thead><tbody>'+rows+'</tbody></table></html>';
}
if(require.main===module){
 const [snapshotPath,htmlPath]=process.argv.slice(2);
 if(!snapshotPath||!htmlPath)throw Error('Usage: node generate-offline-slot-comparison.js <snapshot.json> <index.html>');
 const result=run(JSON.parse(fs.readFileSync(snapshotPath,'utf8')),fs.readFileSync(htmlPath,'utf8'));
 const out='master-wok-offline-slot-comparison.html';
 fs.writeFileSync(out,render(result));
 console.log('Created '+out+'; slots='+result.rows.length+'; prototypeFit='+result.rows.filter(x=>x.masterWok==='PROTOTYPE_FIT').length+'; unverified='+result.rows.filter(x=>x.masterWok==='UNVERIFIED').length);
}
module.exports={run,render};
