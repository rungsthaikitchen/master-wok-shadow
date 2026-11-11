'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {planCoordinatedKitchen}=require('./staging-coordinated-kitchen');
const {planWithProtectedWork,protectStartedWork}=require('./master-wok-protected-plan');
const {remapPlanOrder}=require('./master-wok-service-plan-store');
const {validateAuxiliaryWork}=require('./master-wok-auxiliary-work');
const {assessCombinedBooking}=require('./master-wok-combined-assessment');
const {FRYER}=require('./master-wok-recipe-rules');
const line=(item_id,qty=1,modifiers=[])=>({item_id,qty,modifiers,spice:null});
function input(items,id='a',ready=1140){return {order:{orderId:id,placedAt:new Date(2026,10,4,16,0),readyMinute:ready},row:{id,items}};}
function plan(items){const a=input(items);return planCoordinatedKitchen([a.order],[a.row],{confirmedStarterRecipes:true});}
test('fish cakes, prawns and sausage use recipe-specific times and basket capacities',()=>{
 for(const [item,type,minutes,small,large] of [['fish-cakes','fishCakeBatch',3,3,6],['fried-prawns','friedPrawnBatch',2,3,6],['thai-sausage','thaiSausageBatch',3,5,10]]){
  const qty=large+2*small,p=plan([line(item,qty)]);assert.equal(p.status,'COORDINATED_PROTOTYPE');
  const jobs=p.fryer.jobs.filter(j=>j.type===type);assert.equal(jobs.reduce((n,j)=>n+j.portions,0),qty);
  for(const j of jobs){assert.equal(j.finish-j.start,minutes);assert.ok(j.portions<=(j.basket==='large'?large:small));}
 }
 assert.equal(FRYER.crispyChicken.large,3);assert.equal(FRYER.crispyChicken.small,2);
});
test('dumplings batch in six minutes while ribs retain their five-minute run',()=>{
 const p=plan([line('pork-dumplings',2),line('spare-ribs')]);assert.equal(p.status,'COORDINATED_PROTOTYPE');
 const jobs=p.auxiliary.jobs;assert.equal(jobs.length,2);
 for(const j of jobs){assert.equal(j.resource,'microwave');assert.equal(j.portions,j.itemId==='pork-dumplings'?2:1);assert.equal(j.finish-j.start,j.itemId==='pork-dumplings'?6:5);}
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
 const sausage=input([line('thai-sausage')]);assert.equal(assessCombinedBooking({...context,proposedOrder:{...candidate,rawRow:sausage.row}}).status,'VALIDATED_COMBINED_ASSESSMENT');
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

test('rice preheats share the microwave and finish before their exact wok batch',()=>{
 const a=input([line('egg-rice',2),line('coconut-rice'),line('pork-dumplings')]);
 const p=plan(a.row.items);assert.equal(p.status,'COORDINATED_PROTOTYPE');
 const rice=p.auxiliary.jobs.filter(j=>['egg-rice','coconut-rice'].includes(j.itemId));
 assert.equal(rice.length,3);
 for(const j of rice){assert.equal(j.resource,'microwave');assert.equal(j.finish-j.start,1);
  for(const allocation of j.allocations){assert.ok(j.finish<=allocation.deadline);
   assert.ok(p.wok.jobs.some(w=>w.itemId===j.itemId&&w.start===allocation.deadline));}}
 assert.equal(validateAuxiliaryWork([a.order],[a.row],p.auxiliary.jobs,{mainJobs:p.wok.jobs}),true);
 const missing=p.auxiliary.jobs.filter(j=>j!==rice[0]);
 assert.equal(validateAuxiliaryWork([a.order],[a.row],missing,{mainJobs:p.wok.jobs}),false);
 const late=structuredClone(p.auxiliary.jobs);const bad=late.find(j=>j.itemId==='egg-rice');
 bad.start=bad.allocations[0].deadline;bad.finish=bad.start+1;
 assert.equal(validateAuxiliaryWork([a.order],[a.row],late,{mainJobs:p.wok.jobs}),false);
});
test('started rice preheat freezes dependent wok batch and survives cancellation',()=>{
 const a=input([line('egg-rice')]);
 const first=planWithProtectedWork({orders:[a.order],rows:[a.row],serviceDate:'2026-11-04',now:'2026-11-04T16:00:00Z',confirmedStarterRecipes:true});
 assert.equal(first.status,'VALIDATED_PROTECTED_PLAN');
 const preheat=first.plan.auxiliary.jobs[0],parent=first.plan.wok.jobs[0];
 const fixed=protectStartedWork(first.plan,preheat.start);assert.equal(fixed.wok.length,1);
 const clock='2026-11-04T'+String(Math.floor(preheat.start/60)).padStart(2,'0')+':'+String(preheat.start%60).padStart(2,'0')+':00Z';
 const next=planWithProtectedWork({orders:[a.order],rows:[a.row],serviceDate:'2026-11-04',now:clock,previousPlan:first.plan,confirmedStarterRecipes:true});
 assert.equal(next.status,'VALIDATED_PROTECTED_PLAN');assert.deepEqual(next.plan.wok.jobs[0],parent);
 assert.deepEqual(next.plan.auxiliary.jobs[0],preheat);assert.equal(next.futurePlan.auxiliary.jobs.length,0);
 const cancelled=planWithProtectedWork({orders:[],rows:[],serviceDate:'2026-11-04',now:clock,previousPlan:first.plan,confirmedStarterRecipes:true});
 assert.equal(cancelled.status,'VALIDATED_PROTECTED_PLAN');assert.deepEqual(cancelled.plan.wok.jobs[0],parent);
});
test('satay and moo ping finishing reserve single-chef time against mains and eggs',()=>{
 const p=plan([line('chicken-satay'),line('moo-ping'),line('fried-egg'),line('green-curry')]);
 assert.equal(p.status,'COORDINATED_PROTOTYPE');assert.equal(p.auxiliary.jobs.length,3);
 const all=[...p.wok.jobs,...p.auxiliary.jobs];
 for(let i=0;i<all.length;i++)for(let k=i+1;k<all.length;k++)
  assert.ok(all[i].finish+1<=all[k].start||all[k].finish+1<=all[i].start);
});

test('jasmine and sticky rice always reserve conservative reheating alongside other microwave work',()=>{
 const p=plan([line('jasmine-rice'),line('sticky-rice'),line('pork-dumplings')]);
 assert.equal(p.status,'COORDINATED_PROTOTYPE');
 assert.equal(p.auxiliary.jobs.length,3);
 for(const j of p.auxiliary.jobs.filter(j=>j.itemId!=='pork-dumplings')){
  assert.equal(j.resource,'microwave');assert.equal(j.finish-j.start,3);assert.equal(j.portions,1);
 }
});
test('completion and capacity-reducing lifecycle changes retain spring-roll recipe coverage',async()=>{
 const {createMutationAssessment}=require('./master-wok-mutation-assessment');
 const {expandCommitments}=require('./master-wok-commitment-reader');
 require('./master-wok-model-bundle');
 const before={id:'order-a',created_at:'2026-11-03T12:00:00Z',status:'confirmed',is_test:false,confirmed_time:'2026-11-04T19:00:00Z',
  items:[line('green-curry'),line('veg-spring-rolls'),line('jasmine-rice')]};
 const after={...before,status:'completed'},rows=expandCommitments([after],'2026-11-04');
 const assess=createMutationAssessment({model:globalThis.MasterWokModelV1,readOrders:async()=>rows,
  readAvailability:async()=>({blackouts:[],serviceState:{mode:'normal',capacity_throttle:0}}),planStore:{read:async()=>null}});
 const r=await assess({connection:{},before,after,dates:['2026-11-04'],now:'2026-11-03T12:00:00Z'});
 assert.equal(r.status,'VALIDATED_LIFECYCLE_ASSESSMENT');
 assert.ok(r.plansByDate['2026-11-04'].fryer.jobs.some(j=>j.type==='springRollBatch'));
});
test('preorders cannot spend cold-fryer warmup before production opens at 16:30',()=>{
 const context=ready=>{const time='2026-11-04T17:'+String(ready-1020).padStart(2,'0')+':00Z';
  const row=id=>({id,items:[line('green-curry',4,[{id:'tofu'}])]});
  const order=id=>({orderId:id,placedAt:new Date(2026,10,4,0,0),readyMinute:ready});
  return {serviceDate:'2026-11-04',acceptedOrders:[order('a')],rawRows:[row('a')],
   proposedOrder:{...order('b'),rawRow:row('b'),validatedHeader:{preferred_time:time}},
   state:{now:'2026-11-03T12:00:00Z',availability:{blackouts:[],serviceState:{mode:'normal',capacity_throttle:0}}}};};
 assert.equal(assessCombinedBooking(context(1020)).status,'UNVERIFIED');
 const next=assessCombinedBooking(context(1025));assert.equal(next.status,'VALIDATED_COMBINED_ASSESSMENT');
 assert.ok(next.plan.fryer.jobs.every(j=>j.start>=995));assert.equal(next.bookingApprovalAllowed,false);
});

test('dumpling runs use confirmed durations for one, two and three portions',()=>{
 for(const [qty,minutes] of [[1,4],[2,6],[3,8]]){
  const p=plan([line('pork-dumplings',qty)]);
  assert.equal(p.status,'COORDINATED_PROTOTYPE');
  const jobs=p.auxiliary.jobs;
  assert.equal(jobs.length,1);
  assert.equal(jobs[0].portions,qty);
  assert.equal(jobs[0].finish-jobs[0].start,minutes);
 }
});

test('started dumpling batches survive new bookings and cancellation without moving',()=>{
 for(const qty of [2,3]){
  const a=input([line('pork-dumplings',qty)]);
  const options={serviceDate:'2026-11-04',confirmedStarterRecipes:true};
  const first=planWithProtectedWork({...options,orders:[a.order],rows:[a.row],now:'2026-11-04T16:00:00Z'});
  assert.equal(first.status,'VALIDATED_PROTECTED_PLAN');
  const job=first.plan.auxiliary.jobs[0],minute=job.start+1;
  const now=`2026-11-04T${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}:00Z`;
  const b=input([line('pork-dumplings')],'b',1200);
  const next=planWithProtectedWork({...options,orders:[a.order,b.order],rows:[a.row,b.row],previousPlan:first.plan,now,newOrderId:'b'});
  assert.equal(next.status,'VALIDATED_PROTECTED_PLAN');
  assert.deepEqual(next.protectedJobs.auxiliary,[job]);
  assert.deepEqual(next.plan.auxiliary.jobs.find(j=>j.orderIds.includes('a')),job);
  const cancelled=planWithProtectedWork({...options,orders:[],rows:[],previousPlan:first.plan,now});
  assert.equal(cancelled.status,'VALIDATED_PROTECTED_PLAN');
  assert.deepEqual(cancelled.plan.auxiliary.jobs,[job]);
  for(const duration of [4,5,7,9]){
   const corrupt=structuredClone(first.plan);
   corrupt.auxiliary.jobs[0].start=job.finish-duration;
   assert.throws(()=>protectStartedWork(corrupt,minute),/INVALID_COMMITTED_PLAN/);
  }
 }
});

test('twenty-minute microwave fallback passes protected planning and combined assessment',()=>{
 const a=input([line('pork-dumplings',9)]);
 const options={orders:[a.order],rows:[a.row],serviceDate:'2026-11-04',now:'2026-11-04T16:00:00Z',confirmedStarterRecipes:true};
 const first=planWithProtectedWork(options);
 assert.equal(first.status,'VALIDATED_PROTECTED_PLAN');
 assert.equal(first.plan.holdingLimitMinutes,20);
 const replay=planWithProtectedWork({...options,previousPlan:first.plan});
 assert.equal(replay.status,'VALIDATED_PROTECTED_PLAN');
 const assessed=assessCombinedBooking({serviceDate:'2026-11-04',acceptedOrders:[],rawRows:[],
  proposedOrder:{...a.order,rawRow:a.row,validatedHeader:{preferred_time:'2026-11-04T19:00:00Z'}},
  state:{now:'2026-11-03T12:00:00Z',availability:{blackouts:[],serviceState:{mode:'normal',capacity_throttle:0}}}});
 assert.equal(assessed.status,'VALIDATED_COMBINED_ASSESSMENT');
 assert.equal(assessed.plan.holdingLimitMinutes,20);
 assert.equal(assessed.bookingApprovalAllowed,false);
});
