'use strict';
// Offline reconstruction: menu-derived legacy capacity at each historical order's
// booking moment. MW result is historical prototype fit, NOT slot availability.
const fs=require('node:fs'),path=require('node:path');
const {audit,extractMenuLoads}=require('./audit-legacy-menu-loads');
const {reconstructLegacySlots}=require('./staging-legacy-capacity-reconstruction');
const {compareHistoricalDecisions}=require('./staging-booking-decision-comparison');
const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function build(snapshot,html){
 const assessment=audit(snapshot,html);
 if(assessment.status!=='MENU_DERIVED_ESTIMATE')throw Error('MENU_MAPPING_INCOMPLETE');
 const menu=extractMenuLoads(html);
 const enriched={...snapshot,orders:snapshot.orders.map(o=>({...o,items:o.items.map(i=>({
  ...i,kitchen_load:menu.get(i.item_id).kitchenLoad
 }))}))};
 const physical=compareHistoricalDecisions(snapshot);
 const records=enriched.orders.map((order,i)=>{
  const legacy=reconstructLegacySlots(enriched,{candidateLoad:assessment.orders[i].estimatedKitchenLoad,priorCount:i});
  const requested=legacy.slots.find(s=>s.time===String(Math.floor(order.local_ready_minute/60)).padStart(2,'0')+':'+String(order.local_ready_minute%60).padStart(2,'0'));
  return {number:i+1,load:assessment.orders[i].estimatedKitchenLoad,
   readyMinute:order.local_ready_minute,legacy,requested:requested?.legacyCapacityFit??null,
   masterWok:physical.events[i].masterWok.status};
 });
 return {serviceDate:snapshot.serviceDate,records,comparisonVerified:false,bookingApprovalAllowed:false};
}
function render(data){
 const clock=n=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
 const rows=data.records.map(r=>{
  const available=r.legacy.slots.filter(s=>s.legacyCapacityFit).length;
  const total=r.legacy.slots.length;
  const status=r.legacy.status==='UNVERIFIED'?'UNVERIFIED':r.requested===null?'NOT IN GRID':r.requested?'FIT':'BLOCKED';
  return `<tr><td>${r.number}</td><td>${esc(clock(r.readyMinute))}</td><td>${r.load}</td><td>${esc(status)}</td><td>${available}/${total}</td><td>${esc(r.masterWok)}</td><td>NOT ASSESSED PER SLOT</td></tr>`;
 }).join('');
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Master Wok offline comparison</title><style>body{font:16px system-ui,sans-serif;max-width:1150px;margin:40px auto;padding:0 18px;background:#f8fafc;color:#192333}table{border-collapse:collapse;width:100%;background:white}td,th{padding:12px;border-bottom:1px solid #ddd;text-align:left}th{background:#e6edf5}.warning{background:#fff3d6;padding:16px;border-left:4px solid #bd7a00}small{color:#526273}</style></head><body><h1>Master Wok — reconstructed Friday capacity</h1><p>Service date: ${esc(data.serviceDate)}</p><div class="warning"><strong>Diagnostic only — not a verified scheduler comparison.</strong> Legacy uses today's menu-derived kitchen loads and only capacity rules (not lead time, blackouts or actual booking-time decisions). Master Wok column is historical prototype fit of the cumulative orders, not per-slot availability. No booking approval is permitted.</div><table><thead><tr><th>Order</th><th>Ready</th><th>Estimated legacy load</th><th>Legacy fit at ready time</th><th>Legacy capacity-fit slots</th><th>Master Wok historical replay</th><th>Master Wok slot decision</th></tr></thead><tbody>${rows}</tbody></table><p><small>Each row reconstructs capacity from earlier orders in snapshot order, without replaying real customer-facing availability. 17:00–21:00, five-minute increments; counts exclude overrun slots.</small></p></body></html>`;
}
if(require.main===module){
 const [snapshotFile,htmlFile]=process.argv.slice(2);
 if(!snapshotFile||!htmlFile)throw Error('Usage: node generate-reconstructed-capacity-report.js <snapshot.json> <website-index.html>');
 const result=build(JSON.parse(fs.readFileSync(snapshotFile,'utf8')),fs.readFileSync(htmlFile,'utf8'));
 const out=path.resolve('master-wok-reconstructed-capacity.html');
 fs.writeFileSync(out,render(result),'utf8');
 console.log('Created '+out+'; orders='+result.records.length+'; comparisonVerified=false');
}
module.exports={build,render};
