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
  // Zero-duration, known catalog baskets have no scheduled wok reservation.
  // Preserve them in the replay totals; never fabricate cooking minutes.
  const scheduled=[];
  let noWokReservation=0;
  for(const order of normalized) {
    const pressure=model.calculateCombinedKitchenPressure([order.classification]);
    const raw=pressure?.productionWindow?.rawMinutes;
    const reserved=pressure?.productionWindow?.reservedMinutes;
    if(!Number.isFinite(raw)||!Number.isFinite(reserved)||raw<0||reserved<0)
      throw Error('INVALID_PRODUCTION_DURATION');
    if(raw===0 && reserved===0) { noWokReservation++; continue; }
    if(raw===0 || reserved===0) throw Error('INCONSISTENT_PRODUCTION_DURATION');
    scheduled.push(order);
  }
  // Compare the conservative and raw-duration baselines without relaxing either.
  const baseline=engine.schedule(scheduled,{serviceDate:snapshot.serviceDate});
  const rawOrders=scheduled.map(order=>{
    const pressure=model.calculateCombinedKitchenPressure([order.classification]);
    return {...order,durationOverride:pressure.productionWindow.rawMinutes};
  });
  const rawBaseline=engine.schedule(rawOrders,{serviceDate:snapshot.serviceDate});
  // Diagnostic lower bound: distinct orders remain distinct jobs. This is NOT
  // cross-order batching, and does not change acceptance decisions.
  const minuteBuckets={};
  for(const order of scheduled) {
    const key=String(order.readyMinute);
    minuteBuckets[key]=(minuteBuckets[key]||0)+1;
  }
  return {serviceDate:snapshot.serviceDate,committed:normalized.length,scheduled:scheduled.length,noWokReservation,excluded,
    feasible:baseline.feasible===true,exhausted:baseline.exhausted===true,
    rawFeasible:rawBaseline.feasible===true,rawExhausted:rawBaseline.exhausted===true,
    conservativeNodes:baseline.nodes,rawNodes:rawBaseline.nodes,
    jobsByReadyMinute:minuteBuckets,
    crossOrderBatchingApplied:false,
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
