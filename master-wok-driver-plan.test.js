'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createDriverPlanner,validateDriverPlan,validateFoodAge}=require('./master-wok-driver-plan');
const date='2026-11-04',now='2026-11-04T08:00:00Z';
const row=(id,time=1110,lat=53.75)=>({id,source_order_id:id.split('@')[0],order_type:'delivery',local_ready_minute:time,customer_lat:lat,customer_lng:-1.58});
function planner(){return createDriverPlanner({quoteLeg:async({origin,destination})=>({durationSeconds:origin.lat===53.744437?300:destination.lat===53.744437?420:120})});}
const run=(rows,other={})=>planner()({rows,serviceDate:date,now,...other});
test('persisted coordinate round-off preserves the exact reserved trip',async()=>{
 const rows=[row('roundtrip')],first=await run(rows);
 const reread=[{...rows[0],customer_lat:rows[0].customer_lat+2*Number.EPSILON*rows[0].customer_lat}];
 const next=await run(reread,{previousPlan:{delivery:first.delivery}});
 assert.deepEqual(next.delivery,first.delivery);
});
test('real destination or promise changes still refuse a retained trip',async()=>{
 const rows=[row('moved')],first=await run(rows);
 for(const changed of [{...rows[0],customer_lat:53.750000001},{...rows[0],customer_lng:-1.580000001},{...rows[0],local_ready_minute:1115}])
  await assert.rejects(()=>run([changed],{previousPlan:{delivery:first.delivery}}),/DELIVERY_COMMITMENT_CHANGED/);
});
test('arrival means the door: reserve loading, distinct outbound, handover and return',async()=>{
 const p=await run([row('a')]),t=p.delivery.trips[0];
 assert.equal(t.start,1103);assert.equal(t.departure,1105);assert.equal(t.stops[0].arrival,1110);assert.equal(t.finish,1119);assert.equal(p.deadlines.get('a'),1103);
 validateDriverPlan(p.delivery);
});
test('default remains separate trips and includes driver return when choosing another arrival',async()=>{
 await assert.rejects(()=>run([row('a'),row('b',1120,53.76)]),/DRIVER_UNAVAILABLE/);
 const p=await run([row('a'),row('b',1130,53.76)]),[a,b]=p.delivery.trips;
 assert.equal(p.delivery.trips.length,2);assert.ok(b.start>=a.finish);assert.equal(b.stops[0].arrival,1130);
});
test('overlapping deliveries that cannot meet their arrival deadlines fail closed',async()=>{
 await assert.rejects(()=>run([row('a'),row('b'),row('c')]),/DRIVER_UNAVAILABLE/);
});
test('an explicit combined trip visits both doors and reserves one complete return',async()=>{
 const p=await run([row('a'),row('b',1115,53.76)],{combine:['a','b']});const t=p.delivery.trips[0];
 assert.equal(p.delivery.trips.length,1);assert.deepEqual(t.legs,[5,2,7]);
 assert.ok(t.stops.every(s=>s.arrival<=s.target&&s.target-s.arrival<=10));assert.equal(p.deadlines.get('a'),p.deadlines.get('b'));
});
test('confirmed combinations persist when later orders are assessed',async()=>{
 const rows=[row('a'),row('b',1115,53.76)],first=await run(rows,{combine:['a','b']});
 const next=await run([...rows,row('c',1140,53.77)],{previousPlan:{delivery:first.delivery}});
 assert.deepEqual(next.delivery.trips[0],first.delivery.trips[0]);assert.equal(next.delivery.trips.length,2);
});
test('driver trips already loading cannot be combined or split',async()=>{
 const rows=[row('a'),row('b',1130,53.76)],first=await run(rows);
 await assert.rejects(()=>run(rows,{previousPlan:{delivery:first.delivery},now:'2026-11-04T18:25:00Z',combine:['a','b']}),/ALREADY_STARTED/);
});
test('proposed times reserve both alternatives without treating one order as two simultaneous trips',async()=>{
 const a=row('a@old'),b=row('a@new',1115);const p=await run([a,b]);
 assert.equal(p.delivery.trips.length,2);validateDriverPlan(p.delivery);
 await assert.rejects(()=>run([a,b],{combine:[a.id,b.id]}),/RESOLVE_PROPOSED/);
});
test('cancellation cannot free a driver already out on a trip',async()=>{
 const first=await run([row('a')]);const next=await run([],{previousPlan:{delivery:first.delivery},now:'2026-11-04T18:30:00Z'});
 assert.deepEqual(next.delivery,first.delivery);
 const home=await run([],{previousPlan:{delivery:first.delivery},now:'2026-11-04T19:00:00Z'});assert.equal(home.delivery.trips.length,0);
});
test('unsafe food age, missing duration and forged coordinates cannot approve delivery',async()=>{
 const long=createDriverPlanner({quoteLeg:async()=>({durationSeconds:1200})});
 await assert.rejects(()=>long({rows:[row('a')],serviceDate:date,now}),/DRIVER_UNAVAILABLE/);
 const absent=createDriverPlanner({quoteLeg:async()=>({durationSeconds:null})});
 await assert.rejects(()=>absent({rows:[row('a')],serviceDate:date,now}),/TRAVEL_TIME_UNAVAILABLE/);
 await assert.rejects(()=>run([{...row('a'),customer_lat:'invalid'}]),/COORDINATES_REQUIRED/);
});
test('cooking must finish before loading and actual food readiness must satisfy holding limit',async()=>{
 const p=await run([row('a')]);const plan={delivery:p.delivery,wok:{jobs:[{orderIds:['a'],finish:1104}]},fryer:{jobs:[]}};
 assert.throws(()=>validateFoodAge(plan),/FOOD_HOLDING/);plan.wok.jobs[0].finish=1080;assert.throws(()=>validateFoodAge(plan),/FOOD_HOLDING/);
 plan.wok.jobs[0].finish=1103;assert.equal(validateFoodAge(plan),true);
});

test('each finished dish must meet the delivery holding limit, even when the final dish is fresh',async()=>{
 const d=await run([row('a')]);
 const plan={wok:{jobs:[{orderIds:['a'],finish:1089},{orderIds:['a'],finish:1103}]},fryer:{jobs:[]},delivery:d.delivery};
 assert.throws(()=>validateFoodAge(plan),/DELIVERY_FOOD_HOLDING_LIMIT/);
 plan.wok.jobs[0].finish=1090;assert.equal(validateFoodAge(plan),true);
 plan.auxiliary={jobs:[{itemId:'pork-dumplings',orderIds:['a'],finish:1089}]};
 assert.throws(()=>validateFoodAge(plan),/DELIVERY_FOOD_HOLDING_LIMIT/);
 plan.auxiliary.jobs[0].itemId='coconut-rice';assert.equal(validateFoodAge(plan),true);
});
test('no driver is reserved for collection orders',async()=>{
 const p=await run([{id:'a',order_type:'collection'}]);assert.deepEqual(p.delivery.trips,[]);
});
test('asymmetric routes and non-service-day placement work in both host time zones',async()=>{
 const p=await run([row('a')],{now:'2026-11-03T20:30:00Z'});assert.deepEqual(p.delivery.trips[0].legs,[5,7]);
});

test('PostgreSQL numeric coordinates survive the real pg string representation',async()=>{const p=await run([{...row('db'),customer_lat:'53.75',customer_lng:'-1.58'}]);assert.equal(p.delivery.trips[0].stops[0].destination.lat,53.75);});

test('a 19:45 promise cannot borrow late tolerance after the driver returns at 19:42',async()=>{
 const driver=createDriverPlanner({quoteLeg:async({origin,destination})=>({durationSeconds:origin.lat===53.75||destination.lat===53.75?600:480})});
 const prior=row('previous',1170,53.75),first=await driver({rows:[prior],serviceDate:date,now});
 assert.equal(first.delivery.trips[0].finish,1182);
 for(const target of [1185,1190])await assert.rejects(()=>driver({rows:[prior,row('next',target,53.76)],previousPlan:{delivery:first.delivery},serviceDate:date,now}),/DRIVER_UNAVAILABLE/);
 const result=await driver({rows:[prior,row('next',1195,53.76)],previousPlan:{delivery:first.delivery},serviceDate:date,now});
 const trip=result.delivery.trips.find(t=>t.stops[0].id==='next');
 assert.equal(trip.start,1185);assert.equal(trip.departure,1187);assert.equal(trip.stops[0].arrival,1195);
 assert.deepEqual(result.delivery.trips[0],first.delivery.trips[0]);
});
test('existing reservations with legacy late tolerance remain intact when a new trip is assessed',async()=>{
 const first=await run([row('existing')]),legacy=structuredClone(first.delivery);
 const trip=legacy.trips[0];trip.start+=7;trip.departure+=7;trip.finish+=7;trip.stops[0].arrival+=7;
 assert.equal(validateDriverPlan(legacy),true);
 const result=await run([row('existing'),row('new',1200,53.76)],{previousPlan:{delivery:legacy}});
 assert.deepEqual(result.delivery.trips[0],legacy.trips[0]);
 assert.ok(result.delivery.trips.find(t=>t.stops[0].id==='new').stops.every(s=>s.arrival<=s.target));
});
