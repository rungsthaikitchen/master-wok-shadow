'use strict';
// Offline fryer inventory only. No database writes or booking approvals.
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {normalizeStagingOrders}=require('./staging-order-snapshot');
const {londonPlacement}=require('./staging-booking-integration');
const {diagnoseFryer}=require('./staging-fryer-diagnostic');
const snapshot=JSON.parse(fs.readFileSync(process.argv[2]||'', 'utf8'));
const context=vm.createContext({window:{},Date});
for(const file of ['master-wok-model-bundle.js','master-wok.js'])
 vm.runInContext(fs.readFileSync(path.join(__dirname,file),'utf8'),context);
const outcomes=[];
for(let n=1;n<=snapshot.orders.length;n++){
 const rows=snapshot.orders.slice(0,n);
 const orders=normalizeStagingOrders({rows,model:context.window.MasterWokModelV1,serviceDate:snapshot.serviceDate})
  .map(o=>({...o,placedAt:londonPlacement(o.placedAt)}));
 const result=diagnoseFryer(orders,rows);
 outcomes.push({ordersIncluded:n,reason:result.reason,
  dependencies:result.dependencies.length,
  unmodelled:[...new Set(result.unmodelled.map(x=>x.itemId||x.reason))]});
}
console.log(JSON.stringify({serviceDate:snapshot.serviceDate,outcomes,bookingApprovalAllowed:false},null,2));
