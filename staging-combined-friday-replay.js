'use strict';
// Offline, read-only diagnostic. Conservative greedy placement; failures are UNVERIFIED.
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {normalizeStagingOrders}=require('./staging-order-snapshot');
const {londonPlacement}=require('./staging-booking-integration');
const {scheduleCrossOrderPanang}=require('./staging-cross-order-scheduler');
const {diagnoseFryer}=require('./staging-fryer-diagnostic');
const BASKETS=[{id:'large',normal:3,spring:3},{id:'small-1',normal:2,spring:2},{id:'small-2',normal:2,spring:2}];
const PRODUCTION_START=990,MAX_EARLY=10;
function minute(d){return d.getHours()*60+d.getMinutes();}
function plan(orders,rows,wok){
 const inventory=diagnoseFryer(orders,rows);
 if(inventory.unmodelled.length)return {status:'UNVERIFIED',reason:'UNMODELLED_FRY',unmodelled:inventory.unmodelled};
 if(wok.status!=='PHYSICAL_FIT_PROTOTYPE')return {status:'UNVERIFIED',reason:'WOK_UNVERIFIED'};
 const byId=new Map(orders.map(o=>[String(o.orderId),o]));
 const portions=[];
 for(const dep of inventory.dependencies){
  const order=byId.get(dep.orderId);
  const placed=minute(order.placedAt);
  if(dep.standalone){
   for(let k=0;k<dep.counts.springRollBatch;k++)
    portions.push({type:'springRollBatch',duration:7,deadline:dep.readyMinute,placed,orderId:dep.orderId,standalone:true});
   continue;
  }
  const batches=wok.jobs.filter(j=>j.itemId===dep.itemId&&j.orderIds.includes(dep.orderId));
  if(batches.length!==1)return {status:'UNVERIFIED',reason:'AMBIGUOUS_WOK_BATCH',itemId:dep.itemId,orderId:dep.orderId};
  for(const [type,count] of Object.entries(dep.counts))
   for(let k=0;k<count;k++)
    portions.push({type,duration:5,deadline:batches[0].start,placed,orderId:dep.orderId,standalone:false});
 }
 // Group only identical frying types, cycle lengths and deadlines.
 const groups=new Map();
 for(const p of portions){
  const key=JSON.stringify([p.type,p.deadline,p.duration]);
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push(p);
 }
 const cycles=[],failures=[];
 const ordered=[...groups.values()].sort((a,b)=>a[0].deadline-b[0].deadline);
 for(const group of ordered){
  const remaining=[...group].sort((a,b)=>b.placed-a.placed);
  while(remaining.length){
   let best=null;
   for(const basket of BASKETS){
    const capacity=group[0].type==='springRollBatch'?basket.spring:basket.normal;
    for(let start=group[0].deadline-group[0].duration;start>=Math.max(PRODUCTION_START,group[0].deadline-group[0].duration-MAX_EARLY);start--){
     const candidates=remaining.filter(p=>p.placed<=start).slice(0,capacity);
     if(!candidates.length)continue;
     if(cycles.some(c=>c.basket===basket.id&&start<c.finish&&start+group[0].duration>c.start))continue;
     if(!best||candidates.length>best.portions.length||(candidates.length===best.portions.length&&start>best.start))
      best={basket:basket.id,start,finish:start+group[0].duration,type:group[0].type,portions:candidates,deadline:group[0].deadline};
    }
   }
   if(!best){failures.push({reason:'NO_GREEDY_FRY_SLOT',type:group[0].type,deadline:group[0].deadline,remaining:remaining.length});break;}
   cycles.push(best);
   for(const p of best.portions)remaining.splice(remaining.indexOf(p),1);
  }
 }
 return {status:failures.length?'UNVERIFIED':'FRY_PLACED_PROTOTYPE',
  reason:failures.length?'GREEDY_PLACEMENT_INCOMPLETE':'FRY_TIMELINE_FOUND_NOT_JOINTLY_OPTIMISED',
  dependencies:inventory.dependencies.length,cycles:cycles.length,failures,
  scheduled:cycles.map(c=>({basket:c.basket,type:c.type,start:c.start,finish:c.finish,deadline:c.deadline,portions:c.portions.length})),
  bookingApprovalAllowed:false};
}
function replay(snapshot){
 const context=vm.createContext({window:{},Date});
 for(const file of ['master-wok-model-bundle.js','master-wok.js'])
  vm.runInContext(fs.readFileSync(path.join(__dirname,file),'utf8'),context);
 const outcomes=[];
 for(let n=1;n<=snapshot.orders.length;n++){
  const rows=snapshot.orders.slice(0,n);
  const orders=normalizeStagingOrders({rows,model:context.window.MasterWokModelV1,serviceDate:snapshot.serviceDate})
   .map(o=>({...o,placedAt:londonPlacement(o.placedAt)}));
  const wok=scheduleCrossOrderPanang(orders,rows,{sharedRings:true,allowFryerDependent:true});
  const fryer=plan(orders,rows,wok);
  outcomes.push({ordersIncluded:n,wokStatus:wok.status,fryerStatus:fryer.status,
   fryerReason:fryer.reason,dependencies:fryer.dependencies??null,cycles:fryer.cycles??null,
   failures:fryer.failures??[],bookingApprovalAllowed:false});
 }
 return {serviceDate:snapshot.serviceDate,outcomes,
  warning:'Conservative greedy fryer placement; chef attention, starters other than spring rolls, and joint re-optimisation not verified',
  bookingApprovalAllowed:false};
}
if(require.main===module){
 const file=process.argv[2];
 if(!file)throw Error('Usage: node staging-combined-friday-replay.js <snapshot.json>');
 console.log(JSON.stringify(replay(JSON.parse(fs.readFileSync(file,'utf8'))),null,2));
}
module.exports={replay,plan};
