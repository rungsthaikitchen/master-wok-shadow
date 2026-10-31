'use strict';
// Offline-only audit of a historical snapshot. Does not write or approve bookings.
const fs=require('node:fs');
const vm=require('node:vm');
const {normalizeStagingOrders}=require('./staging-order-snapshot');
const {londonPlacement}=require('./staging-booking-integration');
const {firstOrderTwoWokExperiment}=require('./staging-two-wok-first-order-experiment');
function auditSnapshot(snapshot){
 if(!snapshot||!Array.isArray(snapshot.orders)||!snapshot.serviceDate)throw Error('INVALID_SNAPSHOT');
 const context=vm.createContext({window:{},Date});
 for(const file of ['master-wok-model-bundle.js','master-wok.js'])
  vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,file),'utf8'),context);
 const outcomes=[];
 for(let i=0;i<snapshot.orders.length;i++){
  const row=snapshot.orders[i];
  const normalized=normalizeStagingOrders({rows:[row],model:context.window.MasterWokModelV1,serviceDate:snapshot.serviceDate})
   .map(o=>({...o,placedAt:londonPlacement(o.placedAt)}));
  const result=normalized.length===1?firstOrderTwoWokExperiment(normalized,[row]):
   {status:'UNVERIFIED',reason:'ORDER_NORMALIZATION_FAILED',bookingApprovalAllowed:false};
  outcomes.push({sequence:i+1,readyMinute:normalized[0]?.readyMinute??null,
   status:result.status,reason:result.reason,
   wokJobs:result.wok?.jobs.length||0,fryerJobs:result.fryer?.jobs.length||0,
   bookingApprovalAllowed:false});
 }
 return {serviceDate:snapshot.serviceDate,total:outcomes.length,
  coordinatedExperiments:outcomes.filter(x=>x.status==='COORDINATED_EXPERIMENT').length,
  bookingApprovalAllowed:false,outcomes};
}
if(require.main===module){
 const file=process.argv[2];
 if(!file)throw Error('Usage: node staging-two-wok-snapshot-audit.js <snapshot.json>');
 const result=auditSnapshot(JSON.parse(fs.readFileSync(file,'utf8')));
 process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
module.exports={auditSnapshot};
