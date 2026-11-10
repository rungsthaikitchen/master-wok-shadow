'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
require('./master-wok-model-bundle');
const {createDeliveryAdmin}=require('./master-wok-delivery-admin');
const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'];
const date='2026-11-20',times=['18:30','18:50'];
const rows=ids.map((id,i)=>({id:id+'@'+date+'T'+times[i]+':00.000Z',source_order_id:id,
 order_ref:'FIXTURE-'+i,created_at:'2026-11-09T08:00:00Z',status:'pending',order_type:'delivery',
 confirmed_time:date+'T'+times[i]+':00Z',local_service_date:date,local_ready_minute:1110+i*20,
 items:[{item_id:'green-curry',qty:1,modifiers:[{id:'chicken'}],spice:1}]}));
const stops=rows.map((r,i)=>({id:r.id,sourceId:ids[i],target:1110+i*20,arrival:1117+i*3}));
const combined={id:'combined',start:1108,finish:1128,stops};
const previous={delivery:{trips:stops.map((s,i)=>({id:'single-'+i,start:1101+i*20,finish:1119+i*20,stops:[s]}))}};
function fixture(){
 const queries=[];let replans=0;
 const c={release(){},async query(sql){queries.push(sql);
  if(sql.startsWith('SELECT * FROM'))return {rows:[{id:ids[0],order_type:'delivery',status:'pending',is_test:false,preferred_time:rows[0].confirmed_time}]};
  if(sql.startsWith('SELECT revision'))return {rows:[{revision:7}]};
  if(sql.startsWith('SELECT clock_timestamp'))return {rows:[{now:'2026-11-09T08:00:00Z'}]};
  return {rows:[]};
 }};
 const plan={delivery:{trips:[combined]},wok:{jobs:[
  {orderIds:[rows[0].id],finish:1102},{orderIds:[rows[0].id],finish:1103},
  {orderIds:[rows[1].id],finish:1108}]},
  fryer:{jobs:[{orderIds:[rows[0].id],finish:1000}]},
  auxiliary:{jobs:[{itemId:'coconut-rice',orderIds:[rows[0].id],finish:1000}]}};
 const admin=createDeliveryAdmin({pool:{connect:async()=>c},schema:'master_wok_rehearsal',
  model:globalThis.MasterWokModelV1,assertWriteAllowed:async()=>{},readOrders:async()=>rows,
  readAvailability:async()=>({}),planStore:{read:async()=>previous,save:async()=>{throw Error('Recommendation wrote a plan');}},
  deliveryCapacity:{replan:async()=>{replans++;return {status:'VALIDATED_PROTECTED_PLAN',plan};}}});
 return {admin,queries,get replans(){return replans;}};
}
test('Admin recommendation reports oldest finished dish and excludes intermediate prep',async()=>{
 const f=fixture(),before=JSON.stringify(previous);
 const result=await f.admin({action:'delivery_trip_options',orderId:ids[0]});
 assert.equal(result.success,true,result.reason);assert.equal(result.committed,false);
 assert.equal(result.recommendations[0].foodAgeMinutes,15);
 assert.equal(result.recommendations[0].savedMinutes,16);
 assert.equal(JSON.stringify(previous),before);assert.ok(f.queries.includes('ROLLBACK'));
 assert.ok(!f.queries.includes('COMMIT'));
});
test('stale Admin trip confirmation refuses before replanning or persistence',async()=>{
 const f=fixture(),result=await f.admin({action:'combine_deliveries',orderId:ids[0],orderIds:ids,expectedRevision:6});
 assert.equal(result.reason,'DELIVERY_PLAN_CHANGED_REFRESH');assert.equal(result.committed,false);
 assert.equal(f.replans,0);assert.ok(f.queries.includes('ROLLBACK'));
});
