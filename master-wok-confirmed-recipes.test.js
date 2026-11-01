'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {planCoordinatedKitchen}=require('./staging-coordinated-kitchen');
const {planWithProtectedWork,protectStartedWork}=require('./master-wok-protected-plan');
const {remapPlanOrder}=require('./master-wok-service-plan-store');
const {validateAuxiliaryWork}=require('./master-wok-auxiliary-work');
const {assessCombinedBooking}=require('./master-wok-combined-assessment');
const {FRYER,UNCONFIRMED}=require('./master-wok-recipe-rules');
const line=(item_id,qty=1,modifiers=[])=>({item_id,qty,modifiers,spice:null});
function input(items,id='a',ready=1140){return {order:{orderId:id,placedAt:new Date(2026,10,4,16,0),readyMinute:ready},row:{id,items}};}
function plan(items){const a=input(items);return planCoordinatedKitchen([a.order],[a.row],{confirmedStarterRecipes:true});}
test('fish cakes and prawns use their own durations and basket batch capacities',()=>{
 for(const [item,type,minutes] of [['fish-cakes','fishCakeBatch',3],['fried-prawns','friedPrawnBatch',2]]){
  const p=plan([line(item,12)]);assert.equal(p.status,'COORDINATED_PROTOTYPE');
  const jobs=p.fryer.jobs.filter(j=>j.type===type);assert.equal(jobs.reduce((n,j)=>n+j.portions,0),12);
  for(const j of jobs){assert.equal(j.finish-j.start,minutes);assert.ok(j.portions<=(j.basket==='large'?6:3));}
 }
 assert.equal(FRYER.crispyChicken.large,3);assert.equal(FRYER.crispyChicken.small,2);
});
test('dumplings and ribs share one microwave, one batch per five-minute cycle',()=>{
 const p=plan([line('pork-dumplings',2),line('spare-ribs')]);assert.equal(p.status,'COORDINATED_PROTOTYPE');
 const jobs=p.auxiliary.jobs;assert.equal(jobs.length,3);
 for(const j of jobs){assert.equal(j.resource,'microwave');assert.equal(j.portions,1);assert.equal(j.finish-j.start,5);}
 for(let i=0;i<jobs.length;i++)for(let k=i+1;k<jobs.length;k++)assert.ok(jobs[i].finish<=jobs[k].start||jobs[k].finish<=jobs[i].start);
});
test('extra and standalone eggs share main-wok time, two minutes and at most two eggs',()=>{
 const p=plan([line('stir-basil',1,[{id:'chicken'},{id:'extra-egg'}]),line('fried-egg',2)]);
 assert.equal(p.status,'COORDINATED_PROTOTYPE');assert.equal(p.auxiliary.jobs.reduce((n,j)=>n+j.portions,0),3);
 for(const j of p.auxiliary.jobs){assert.equal(j.appliance,'small-wok');assert.equal(j.finish-j.start,2);assert.ok(j.portions<=2);
  for(const w of p.wok.jobs)assert.ok(j.finish+1<=w.start||w.finish+1<=j.start);}
});
test('auxiliary coverage independently rejects a missing egg or microwave cycle',()=>{
 const a=input([line('pork-dumplings'),line('fried-egg')]),p=plan(a.row.items);
 assert.equal(validateAuxiliaryWork([a.order],[a.row],p.auxiliary.jobs),true);
 assert.equal(validateAuxiliaryWork([a.order],[a.row],p.auxiliary.jobs.slice(1)),false);
});
test('started auxiliary jobs survive cancellation and persisted identity remapping',()=>{
 const a=input([line('pork-dumplings'),line('fried-egg')]);
 const first=planWithProtectedWork({orders:[a.order],rows:[a.row],serviceDate:'2026-11-04',now:'2026-11-04T16:00:00Z',confirmedStarterRecipes:true});
 assert.equal(first.status,'VALIDATED_PROTECTED_PLAN');
 const mapped=remapPlanOrder(first.plan,'a','persisted@time');assert.ok(mapped.auxiliary.jobs.every(j=>j.orderIds.includes('persisted@time')&&j.allocations.every(x=>x.orderId==='persisted@time')));
 assert.equal(protectStartedWork(first.plan,1140).auxiliary.length,2);
 const cancelled=planWithProtectedWork({orders:[],rows:[],serviceDate:'2026-11-04',now:'2026-11-04T19:00:00Z',previousPlan:first.plan,confirmedStarterRecipes:true});
 assert.equal(cancelled.status,'VALIDATED_PROTECTED_PLAN');assert.deepEqual(cancelled.plan.auxiliary.jobs,first.plan.auxiliary.jobs);
});
test('mixed starter assessment includes auxiliary work but never grants booking authority',()=>{
 const a=input([line('fish-cakes'),line('fried-prawns'),line('pork-dumplings'),line('spare-ribs'),line('fried-egg')]);
 const candidate={...a.order,items:a.row.items,rawRow:a.row,validatedHeader:{preferred_time:'2026-11-04T19:00:00Z'}};
 const context={serviceDate:'2026-11-04',acceptedOrders:[],rawRows:[],proposedOrder:candidate,
  state:{now:'2026-11-04T16:00:00Z',availability:{blackouts:[],serviceState:{mode:'normal',capacity_throttle:0}}}};
 const p=assessCombinedBooking(context);assert.equal(p.status,'VALIDATED_COMBINED_ASSESSMENT');assert.equal(p.bookingApprovalAllowed,false);
 assert.equal(p.plan.auxiliary.jobs.length,3);assert.equal(p.plan.fryer.jobs.length,2);
 assert.equal(UNCONFIRMED['thai-sausage'].method,null);
 const sausage=input([line('thai-sausage')]);assert.equal(assessCombinedBooking({...context,proposedOrder:{...candidate,rawRow:sausage.row}}).status,'UNVERIFIED');
});
test('future eggs cannot overlap a main-wok batch already cooking',()=>{
 const a=input([line('green-curry')]),b=input([line('fried-egg')],'b');
 const first=planWithProtectedWork({orders:[a.order],rows:[a.row],serviceDate:'2026-11-04',now:'2026-11-04T16:00:00Z',confirmedStarterRecipes:true});
 const next=planWithProtectedWork({orders:[a.order,b.order],rows:[a.row,b.row],serviceDate:'2026-11-04',now:'2026-11-04T18:56:00Z',previousPlan:first.plan,newOrderId:'b',confirmedStarterRecipes:true});
 assert.equal(next.status,'UNVERIFIED');
});
test('starting the main does not erase its extra-egg demand from the remaining work',()=>{
 const a=input([line('stir-basil',1,[{id:'chicken'},{id:'extra-egg'}])]);
 const first=planWithProtectedWork({orders:[a.order],rows:[a.row],serviceDate:'2026-11-04',now:'2026-11-04T16:00:00Z',confirmedStarterRecipes:true});
 first.plan.wok.jobs[0].start=1129;first.plan.wok.jobs[0].finish=1134;
 first.plan.auxiliary.jobs[0].start=1138;first.plan.auxiliary.jobs[0].finish=1140;
 const next=planWithProtectedWork({orders:[a.order],rows:[a.row],serviceDate:'2026-11-04',now:'2026-11-04T18:50:00Z',previousPlan:first.plan,confirmedStarterRecipes:true});
 assert.equal(next.status,'VALIDATED_PROTECTED_PLAN');assert.equal(next.futurePlan.auxiliary.jobs.length,1);
 assert.equal(next.futurePlan.auxiliary.jobs[0].itemId,'fried-egg');
});
test('prior v1 plans retain their started work while unknown model versions fail closed',()=>{
 const a=input([line('stir-crispy')]);
 const first=planWithProtectedWork({orders:[a.order],rows:[a.row],serviceDate:'2026-11-04',now:'2026-11-04T16:00:00Z'});
 first.plan.modelVersion='combined-kitchen-protected-v1';delete first.plan.auxiliary;
 const fixed=protectStartedWork(first.plan,1140);assert.equal(fixed.wok.length,1);assert.equal(fixed.fryer.length,1);assert.deepEqual(fixed.auxiliary,[]);
 first.plan.modelVersion='unrecognised';assert.throws(()=>protectStartedWork(first.plan,1140),/INVALID_COMMITTED_PLAN/);
});
