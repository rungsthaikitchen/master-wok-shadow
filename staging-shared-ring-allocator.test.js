'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {allocateSharedRings}=require('./staging-shared-ring-allocator');
const job=(itemId,earliest=1040,latest=1040)=>({
 itemId,earliest,latest,duration:5,readyMinute:1050,holdingLimitMinutes:10
});
test('noodles, small stir fry and two curries can use four rings',()=>{
 const r=allocateSharedRings([
  job('pad-thai'),job('stir-basil'),job('panang-curry'),job('green-curry')
 ]);
 assert.equal(r.status,'PHYSICAL_FIT_PROTOTYPE');
 assert.equal(new Set(r.jobs.map(x=>x.vessel)).size,4);
 assert.equal(r.chefConcurrencyVerified,false);
 assert.equal(r.bookingApprovalAllowed,false);
});
test('fifth simultaneous vessel fails closed',()=>{
 const r=allocateSharedRings([
  job('pad-thai'),job('stir-basil'),job('panang-curry'),job('green-curry'),job('red-curry')
 ]);
 assert.equal(r.status,'UNVERIFIED');
});
test('shared-ring search revisits cooking times when prerequisites reject the first placement',()=>{
 let checks=0;
 const r=allocateSharedRings([job('green-curry',1035,1040)],{validateComplete:jobs=>{
  checks++;return jobs[0].start===1035;
 }});
 assert.equal(r.status,'PHYSICAL_FIT_PROTOTYPE');
 assert.equal(r.jobs[0].start,1035);
 assert.ok(checks>1);
 const unknown=allocateSharedRings([job('green-curry',990,1100)],{validateComplete:()=>false});
 assert.equal(unknown.reason,'SEARCH_LIMIT');
 assert.equal(unknown.bookingApprovalAllowed,false);
});
test('two large woks only, with no small wok substitution for noodles',()=>{
 const r=allocateSharedRings([job('pad-thai'),job('pad-see-ew'),job('fried-rice')]);
 assert.equal(r.status,'UNVERIFIED');
});
test('unclassified cooking vessels fail closed',()=>{
 assert.equal(allocateSharedRings([job('unknown-dish')]).reason,'VESSEL_ELIGIBILITY_UNVERIFIED');
});
test('shared rings respect blackouts for hot work and cold preparation',()=>{
 for(const item of ['pad-thai','green-curry','beef-salad']){
  assert.equal(allocateSharedRings([job(item)],{blackouts:[{start:1042,finish:1043}]}).reason,'NO_PHYSICAL_TIMELINE');
  const r=allocateSharedRings([job(item,1035,1040)],{blackouts:[{start:1040,finish:1050}]});
  assert.equal(r.status,'PHYSICAL_FIT_PROTOTYPE');
  assert.equal(r.jobs[0].finish,1040);
  assert.equal(r.bookingApprovalAllowed,false);
 }
 for(const blackouts of [{},[null],[{start:1040,finish:1040}],[{start:'1040',finish:1050}]])
  assert.equal(allocateSharedRings([],{blackouts}).reason,'INVALID_BLACKOUT');
});
test('cross-order four-ring entry point forwards production blackouts',()=>{
 const {scheduleCrossOrderPanang}=require('./staging-cross-order-scheduler');
 const orders=[{orderId:'blocked',readyMinute:1215,placedAt:new Date(2026,10,6,15)}];
 const rows=[{id:'blocked',items:[{item_id:'pad-thai',qty:1,modifiers:[{id:'chicken'}],spice:0}]}];
 assert.equal(scheduleCrossOrderPanang(orders,rows,{sharedRings:true}).status,'PHYSICAL_FIT_PROTOTYPE');
 const blocked=scheduleCrossOrderPanang(orders,rows,{sharedRings:true,blackouts:[{start:990,finish:1320}]});
 assert.equal(blocked.reason,'NO_PHYSICAL_TIMELINE');
 assert.equal(blocked.bookingApprovalAllowed,false);
});
test('vessel reset requires a minute between consecutive batches',()=>{
 const r=allocateSharedRings([
  job('pad-thai',1040,1040),job('pad-see-ew',1040,1040),job('fried-rice',1045,1045)
 ]);
 assert.equal(r.status,'UNVERIFIED');
});


test('£50 customer basket and £100 mixed basket expose single-wok limits',()=>{
 const {priceBasket}=require('./master-wok-commercial');
 const {scheduleCrossOrderPanang}=require('./staging-cross-order-scheduler');
 const items=[
  ['pork-dumplings'],['red-curry','chicken',1],['stir-pepper','beef',1],
  ['chef-pad-thai','pork',1],['fried-rice','chicken'],['jasmine-rice'],
  ['coconut-rice'],['chips']
 ].map(([item_id,protein,spice=0])=>({item_id,qty:1,modifiers:protein?[{id:protein}]:[],spice}));
 const orders=[{orderId:'large-basket',readyMinute:1215,placedAt:new Date(2026,10,6,15)}];
 for(const multiplier of [1,2]){
  const basket=items.map(item=>({...item,qty:multiplier}));
  assert.equal(priceBasket(basket).subtotalCents,5000*multiplier);
  const rows=[{id:'large-basket',items:basket}];
  const options={allowFryerDependent:true,curryHoldMinutes:10};
  assert.equal(scheduleCrossOrderPanang(orders,rows,options).reason,'FIXED_BATCH_CAPACITY_EXCEEDED');
  const parallel=scheduleCrossOrderPanang(orders,rows,{...options,sharedRings:true});
  assert.equal(parallel.status,'PHYSICAL_FIT_PROTOTYPE');
  assert.equal(parallel.bookingApprovalAllowed,false);
 }
});

test('five available curry pans share four rings, including coconut rice',()=>{
 const {eligible}=require('./staging-shared-ring-allocator');
 assert.equal(eligible('red-curry').length,5);
 assert.deepEqual(eligible('coconut-rice'),eligible('red-curry'));
 const four=['red-curry','green-curry','massaman-curry','coconut-rice'].map(id=>job(id));
 const result=allocateSharedRings(four);
 assert.equal(result.status,'PHYSICAL_FIT_PROTOTYPE');
 assert.equal(new Set(result.jobs.map(j=>j.vessel)).size,4);
 assert.ok(result.jobs.every(j=>j.vessel.startsWith('pan-')));
 assert.equal(allocateSharedRings([...four,job('tom-kha')]).reason,'FIXED_RING_WORKLOAD_EXCEEDS_WINDOW');
});

test('overloaded fixed ring workload is rejected before complete-plan searches',()=>{
 const jobs=Array.from({length:24},()=>({...job('green-curry',995,1015),portions:1,readyMinute:1020}));
 let checks=0;
 const r=allocateSharedRings(jobs,{validateComplete:()=>{checks++;return true;}});
 assert.equal(r.reason,'FIXED_RING_WORKLOAD_EXCEEDS_WINDOW');
 assert.equal(checks,0);assert.equal(r.bookingApprovalAllowed,false);
 assert.equal(allocateSharedRings(jobs.slice(0,12)).status,'PHYSICAL_FIT_PROTOTYPE');
});

test('four-ring curry, soup and coconut rice batches occupy one pan per portion',()=>{
 const {scheduleCrossOrderPanang}=require('./staging-cross-order-scheduler');
 for(const item_id of ['green-curry','tom-kha','coconut-rice']){
  const r=scheduleCrossOrderPanang([{orderId:'a',readyMinute:1215,placedAt:new Date(2026,10,7,15)}],
   [{id:'a',items:[{item_id,qty:4,modifiers:[]}]}],{sharedRings:true});
  assert.equal(r.status,'PHYSICAL_FIT_PROTOTYPE');
  assert.equal(r.jobs.length,4);
  assert.ok(r.jobs.every(j=>j.portions===1));
  assert.equal(new Set(r.jobs.map(j=>j.vessel)).size,4);
 }
});

test('both large and small woks are limited to one main portion per cook',()=>{
 const {scheduleCrossOrderPanang}=require('./staging-cross-order-scheduler');
 for(const item_id of ['stir-basil','salt-chips','stir-crispy','egg-rice','pad-thai','fried-rice']){
  const r=scheduleCrossOrderPanang([{orderId:'a',readyMinute:1215,placedAt:new Date(2026,10,7,15)}],
   [{id:'a',items:[{item_id,qty:4,modifiers:[]}]}],{sharedRings:true,allowFryerDependent:true,holdingLimitMinutes:20});
  assert.equal(r.status,'PHYSICAL_FIT_PROTOTYPE',item_id);
  assert.equal(r.jobs.length,4);assert.ok(r.jobs.every(j=>j.portions===1));
  assert.equal(allocateSharedRings([{...job(item_id),portions:2}]).reason,'VESSEL_PORTION_CAPACITY_EXCEEDED');
 }
});

test('bounded hint search fails closed while full booking search can find a later placement',()=>{
 const jobs=[job('green-curry',1035,1040)];
 const validateComplete=rows=>rows[0].start===1035;
 const limited=allocateSharedRings(jobs,{maxSearchNodes:2,maxCompleteChecks:1,validateComplete});
 assert.equal(limited.reason,'SEARCH_LIMIT');
 assert.equal(limited.bookingApprovalAllowed,false);
 const full=allocateSharedRings(jobs,{validateComplete});
 assert.equal(full.status,'PHYSICAL_FIT_PROTOTYPE');
 assert.equal(full.jobs[0].start,1035);
 for(const maxSearchNodes of [0,-1,100001,NaN])
  assert.equal(allocateSharedRings(jobs,{maxSearchNodes}).reason,'INVALID_SEARCH_BUDGET');
});

test('distant orders cannot hide an overloaded noodle promise, while six portions still fit',()=>{
 const noodles=Array.from({length:11},()=>({itemId:'pad-thai',earliest:1187,latest:1207,
  duration:8,readyMinute:1215,holdingLimitMinutes:20,portions:1}));
 const earlier={itemId:'green-curry',earliest:1085,latest:1105,duration:5,
  readyMinute:1110,holdingLimitMinutes:20,portions:1};
 let checked=0;
 const overloaded=allocateSharedRings([earlier,...noodles],{validateComplete:()=>{checked++;return true;}});
 assert.equal(overloaded.reason,'FIXED_RING_WORKLOAD_EXCEEDS_WINDOW');
 assert.equal(overloaded.bookingApprovalAllowed,false);
 assert.equal(checked,0);
 const feasible=allocateSharedRings([earlier,...noodles.slice(0,6)]);
 assert.equal(feasible.status,'PHYSICAL_FIT_PROTOTYPE');
 assert.ok(feasible.jobs.filter(j=>j.itemId==='pad-thai').every(j=>j.readyMinute-j.finish<=20));
});

test('single cold-prep workload gets the same necessary interval bound as hob resources',()=>{
 const {allocateSharedRings}=require('./staging-shared-ring-allocator');
 const jobs=Array.from({length:3},()=>({itemId:'beef-salad',portions:1,readyMinute:1020,duration:10,earliest:1000,latest:1010}));
 assert.equal(allocateSharedRings(jobs).reason,'FIXED_COLD_PREP_WORKLOAD_EXCEEDS_WINDOW');
 assert.equal(allocateSharedRings(jobs.slice(0,1)).status,'PHYSICAL_FIT_PROTOTYPE');
});
