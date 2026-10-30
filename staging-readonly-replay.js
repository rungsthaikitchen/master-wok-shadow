'use strict';
// Read-only offline replay. Feed a JSON snapshot on stdin; no DB connection.
// Input: {serviceDate, orders:[{id,created_at,local_ready_minute,
// local_service_date,status,items:[{item_id,qty,modifiers}]}]}.
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {normalizeStagingOrders}=require('./staging-order-snapshot');
const {londonPlacement}=require('./staging-booking-integration');
const {diagnostic}=require('./staging-cross-order-batch-diagnostic');
const {scheduleCrossOrderPanang}=require('./staging-cross-order-scheduler');
const {diagnoseFryer}=require('./staging-fryer-diagnostic');
const {compareBookingShadow}=require('./staging-booking-shadow-adapter');
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
  // Historical shadow: replay each accepted order as the candidate against only
  // earlier accepted orders. This is NOT evidence of the legacy slot decision.
  const chronological=committed.map((row,i)=>({row,order:normalized[i]}))
    .sort((a,b)=>new Date(a.row.created_at)-new Date(b.row.created_at));
  const shadowHistory=[];
  for(let i=0;i<chronological.length;i++){
    const {row,order}=chronological[i];
    const earlier=chronological.slice(0,i);
    const comparison=compareBookingShadow({
      orders:earlier.map(x=>x.order),rows:earlier.map(x=>x.row),
      candidate:{order,row},legacyDecision:null
    });
    shadowHistory.push({sequence:i+1,readyMinute:order.readyMinute,
      status:comparison.status,reason:comparison.reason,
      validationIssues:comparison.validationIssues||[],
      checkedOrders:comparison.checkedOrders||null,
      bookingApprovalAllowed:false});
  }
  // Synthetic additional bookings against the full committed staging workload.
  // Assumes a 17:30 London placement; NOT an actual historical availability decision.
  const candidateScenarios=[];
  for(const itemId of ['panang-curry','pad-thai','stir-crispy']){
    for(const readyMinute of [1140,1170,1200]){
      const id='shadow-synthetic-'+itemId+'-'+readyMinute;
      const [year,month,day]=snapshot.serviceDate.split('-').map(Number);
      const order={orderId:id,readyMinute,placedAt:new Date(year,month-1,day,17,30)};
      const row={id,items:[{item_id:itemId,qty:1,modifiers:[]}]};
      const result=compareBookingShadow({orders:normalized,rows:committed,
        candidate:{order,row},legacyDecision:null});
      candidateScenarios.push({itemId,readyMinute,status:result.status,
        reason:result.reason,validationIssues:result.validationIssues||[],
        bookingApprovalAllowed:false});
    }
  }
  return {serviceDate:snapshot.serviceDate,committed:normalized.length,scheduled:scheduled.length,noWokReservation,excluded,
    candidateScenarios:{placementTime:'17:30 London (synthetic)',scenarios:candidateScenarios,legacyDecisionAvailable:false},
    historicalShadow:{tested:shadowHistory.length,validated:shadowHistory.filter(x=>x.status==='VALIDATED_SHADOW_PROTOTYPE').length,
      unverified:shadowHistory.filter(x=>x.status!=='VALIDATED_SHADOW_PROTOTYPE').length,
      comparisons:shadowHistory,legacyDecisionAvailable:false},
    feasible:baseline.feasible===true,exhausted:baseline.exhausted===true,
    rawFeasible:rawBaseline.feasible===true,rawExhausted:rawBaseline.exhausted===true,
    conservativeNodes:baseline.nodes,rawNodes:rawBaseline.nodes,
    jobsByReadyMinute:minuteBuckets,
    crossOrderBatchingApplied:false,
    strictPanangBatchDiagnostic:diagnostic(scheduled,committed),
    crossOrderPrototype:scheduleCrossOrderPanang(scheduled,committed),
    fryerDiagnostic:diagnoseFryer(normalized,committed),
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
