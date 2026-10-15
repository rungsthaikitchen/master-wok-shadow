'use strict';
// Subprocess bridge for approximated polled-state replay. No network/DB access.
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {validServiceDate}=require('../master-wok-live-shadow');
function run(input) {
 if(Intl.DateTimeFormat().resolvedOptions().timeZone!=='Europe/London' ||
    !input || !validServiceDate(input.serviceDate) || !Array.isArray(input.rows) || input.rows.length>500) throw Error();
 const context=vm.createContext({window:{},Date});
 for(const name of ['master-wok-model-bundle.js','master-wok.js','master-wok-shadow.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..',name),'utf8'),context,{timeout:2000});
 }
 context.rows=input.rows.map(row=>{
  if(!row || !Array.isArray(row.lines) || !row.lines.length || row.lines.length>100 || row.lines.some(line=>
   !line || !context.window.MasterWokModelV1.hasItem(line.itemId) || !Number.isSafeInteger(line.qty) ||
   line.qty<1 || line.qty>100 || !Array.isArray(line.mods) || line.mods.length>30 || line.mods.some(mod=>!mod || typeof mod.id!=='string'))) throw Error();
  return {orderId:row.orderId,placedAt:new Date(row.placedAt),readyMinute:row.readyMinute,
   classification:context.window.MasterWokModelV1.classifyBasket(row.lines)};
 });
 context.day=input.serviceDate;
 const replay=vm.runInContext('window.MasterWokShadowV1.replayReservationsV1(day,rows)',context,{timeout:10000});
 return {...replay,chronologyBasis:'POLLED_FINAL_STATE_APPROXIMATION_NOT_DECISION_HISTORY'};
}
if(require.main===module) {
 try {
  const raw=fs.readFileSync(0,'utf8');
  if(Buffer.byteLength(raw)>5_000_000) throw Error();
  process.stdout.write(JSON.stringify(run(JSON.parse(raw))));
 } catch (_) {
  process.stdout.write(JSON.stringify({verified:false,status:'UNVERIFIED',reasonCode:'POLL_REPLAY_UNAVAILABLE',observations:[]}));
 }
}
module.exports={run};
