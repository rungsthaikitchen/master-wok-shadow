'use strict';
// Read-only offline replay. Feed a JSON snapshot on stdin; no DB connection.
// Input: {serviceDate, orders:[{id,created_at,local_ready_minute,
// local_service_date,status,items:[{item_id,qty,modifiers}]}]}.
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {normalizeStagingOrders}=require('./staging-order-snapshot');
const {londonPlacement}=require('./staging-booking-integration');
function replay(snapshot) {
  const context=vm.createContext({window:{},Date});
  for(const file of ['master-wok-model-bundle.js','master-wok.js'])
    vm.runInContext(fs.readFileSync(path.join(__dirname,file),'utf8'),context,{timeout:3000});
  const {MasterWokModelV1:model,MasterWokV1:engine}=context.window;
  const statuses=new Set(['confirmed','accepted','preparing','ready','completed']);
  const committed=snapshot.orders.filter(o=>statuses.has(String(o.status).toLowerCase()));
  const excluded=snapshot.orders.length-committed.length;
  const normalized=normalizeStagingOrders({rows:committed,model,serviceDate:snapshot.serviceDate})
    .map(o=>({...o,placedAt:londonPlacement(o.placedAt)}));
  // Replay existing commitments only: no hypothetical order, no booking writes.
  const baseline=engine.schedule(normalized);
  return {serviceDate:snapshot.serviceDate,committed:normalized.length,excluded,
    feasible:baseline.feasible===true,exhausted:baseline.exhausted===true,
    reason:baseline.reason||null};
}
if(require.main===module) {
  try {
    const result=replay(JSON.parse(fs.readFileSync(0,'utf8')));
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
  } catch(error) {
    process.stderr.write('REPLAY_UNVERIFIED: '+error.message+'\n');
    process.exitCode=1;
  }
}
module.exports={replay};
