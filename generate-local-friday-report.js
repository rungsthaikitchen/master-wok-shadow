'use strict';
// Offline local HTML report for the historical Friday snapshot.
// Reads a local JSON file, never sends data or modifies bookings.
const fs=require('node:fs');
const path=require('node:path');
const {compareHistoricalDecisions}=require('./staging-booking-decision-comparison');
function escapeHtml(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function render(snapshot){
 const result=compareHistoricalDecisions(snapshot);
 const rows=result.events.map(e=>`<tr><td>${e.orderNumber}</td><td>${escapeHtml(e.placedAt||'Unknown')}</td><td>${Math.floor((e.requestedReadyMinute||0)/60).toString().padStart(2,'0')}:${((e.requestedReadyMinute||0)%60).toString().padStart(2,'0')}</td><td>UNVERIFIED</td><td>${escapeHtml(e.masterWok.status)}</td><td>${escapeHtml(e.masterWok.wokStatus)}</td><td>${escapeHtml(e.masterWok.fryerStatus)}</td></tr>`).join('\n');
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Master Wok | Offline Friday Replay</title><style>body{font:16px system-ui,sans-serif;max-width:1100px;margin:40px auto;padding:0 16px;color:#18232f;background:#f7f9fb}h1{margin-bottom:0}.note{background:#fff3d6;border-left:4px solid #bd7a00;padding:14px;margin:24px 0}table{border-collapse:collapse;width:100%;background:white}td,th{border-bottom:1px solid #ddd;padding:10px;text-align:left}th{background:#e9eff4}small{color:#566}</style></head><body><h1>Master Wok — offline Friday replay</h1><p>Service date: ${escapeHtml(result.serviceDate)} · ${result.ordersCompared} orders</p><div class="note"><strong>Not a verified legacy-versus-Master-Wok comparison.</strong> Legacy booking-time decisions were not recorded. The prototype fit covers modelled wok/fryer resources only. Chef attention and some starters remain unmodelled. No booking approval is permitted.</div><table><thead><tr><th>#</th><th>Placed (UTC)</th><th>Ready (local)</th><th>Legacy</th><th>Master Wok</th><th>Wok</th><th>Fryer</th></tr></thead><tbody>${rows}</tbody></table><p><small>Generated locally from the anonymised snapshot. No network requests or production changes.</small></p></body></html>`;
}
function main(){
 const file=process.argv[2];if(!file)throw Error('Usage: node generate-local-friday-report.js <snapshot.json>');
 const snapshot=JSON.parse(fs.readFileSync(file,'utf8'));
 const out=path.resolve('master-wok-friday-local-report.html');
 fs.writeFileSync(out,render(snapshot),'utf8');
 console.log('Offline report created: '+out);
 console.log('Open it in your browser; legacy decisions remain UNVERIFIED.');
}
if(require.main===module)main();
module.exports={render};
