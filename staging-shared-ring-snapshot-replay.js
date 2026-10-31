'use strict';
// Offline cumulative snapshot replay; no booking approval or database writes.
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {normalizeStagingOrders}=require('./staging-order-snapshot');
const {londonPlacement}=require('./staging-booking-integration');
const {scheduleCrossOrderPanang}=require('./staging-cross-order-scheduler');
function replay(snapshot){
 if(!snapshot||!Array.isArray(snapshot.orders)||!snapshot.serviceDate)throw Error('INVALID_SNAPSHOT');
 const context=vm.createContext({window:{},Date});
 for(const file of ['master-wok-model-bundle.js','master-wok.js']){
  vm.runInContext(fs.readFileSync(path.join(__dirname,file),'utf8'),context);
 }
 const outcomes=[];
 for(let n=1;n<=snapshot.orders.length;n++){
  const rows=snapshot.orders.slice(0,n);
  let result;
  try{
   const orders=normalizeStagingOrders({rows,model:context.window.MasterWokModelV1,serviceDate:snapshot.serviceDate})
    .map(o=>({...o,placedAt:londonPlacement(o.placedAt)}));
   result=scheduleCrossOrderPanang(orders,rows,{sharedRings:true,allowFryerDependent:true});
  }catch(e){result={status:'UNVERIFIED',reason:'NORMALIZATION_ERROR',detail:e.message};}
  outcomes.push({ordersIncluded:n,status:result.status,reason:result.reason,
   batches:result.productionBatches??null,bookingApprovalAllowed:false});
 }
 return {serviceDate:snapshot.serviceDate,outcomes,bookingApprovalAllowed:false,
  warning:'Fryer prerequisites and chef attention not jointly verified'};
}
if(require.main===module){
 const file=process.argv[2];
 if(!file)throw Error('Usage: node staging-shared-ring-snapshot-replay.js <snapshot.json>');
 console.log(JSON.stringify(replay(JSON.parse(fs.readFileSync(file,'utf8'))),null,2));
}
module.exports={replay};
