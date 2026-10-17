'use strict';
const crypto=require('node:crypto');
const base=require('../fixtures/delivery/integrated-two-stops-input.json');
const makeRow=(orderId,type='delivery',status='confirmed')=>({orderId,created_at:'2026-10-17T12:00:00Z',
 order_type:type,status,is_test:true,preferred_time:'2026-10-17T18:00:00Z',confirmed_time:null,proposed_time:null,delivery_fee:0});
function makeCases() {
 const source=()=>({projectRef:'hvrqgufqjslvgiohgkvu',dataOrigin:'SYNTHETIC_STAGING',basis:'ATOMIC_STAGING_FIXTURE_QUERY',
  complete:true,serviceDate:base.serviceDate,assessedAt:base.assessedAt,expectedOrders:2,expectedItems:2,
  orders:[makeRow('A'),makeRow('B')],items:['A','B'].map(orderId=>({id:'item_'+orderId,orderId,item_id:'panang-curry',qty:1,modifiers:[{id:'chicken'}]})),
  candidateIds:['A','B'],existingPlan:structuredClone(base.existingPlan),legs:structuredClone(base.legs),maxEstimateAgeMinutes:15});
 const cases=[];
 function add(caseKey,change,prediction,kind=null){const s=source();change(s);cases.push({caseKey,source:s,expectedPrediction:prediction,expectedKind:kind});}
 add('COMBINED_CLEAR',()=>{},'RECOMMENDED','COMBINED');
 add('SEPARATE_TARGETS',s=>{s.orders[1].preferred_time='2026-10-17T18:45:00Z';},'RECOMMENDED','SEPARATE');
 function existing(s,type){s.orders.push(makeRow('EXISTING',type));s.items.push({id:'item_existing',orderId:'EXISTING',item_id:'jasmine-rice',qty:1,modifiers:[]});s.expectedOrders++;s.expectedItems++;}
 add('COLLECTION_BUSY',s=>{existing(s,'collection');s.existingPlan.orders=[{orderId:'EXISTING',orderType:'collection',
  kitchenRequirement:'REQUIRED',kitchenAllocation:{start:1090,finish:1200},driverTripId:null}];},'UNVERIFIED');
 add('DRIVER_BUSY',s=>{existing(s,'delivery');s.existingPlan.orders=[{orderId:'EXISTING',orderType:'delivery',
  kitchenRequirement:'NONE',kitchenAllocation:null,driverTripId:'busy'}];
  s.existingPlan.driverTrips=[{tripId:'busy',orderIds:['EXISTING'],startMinute:1090,endMinute:1200}];},'UNVERIFIED');
 add('MISSING_REVERSE_LEG',s=>{s.legs=s.legs.filter(l=>!(l.from==='B'&&l.to==='A'));},'UNVERIFIED');
 add('UNACKNOWLEDGED_PROPOSAL',s=>{s.orders[0].status='pending';s.orders[0].proposed_time='2026-10-17T18:10:00Z';},'UNVERIFIED');
 return cases;
}
function fixtureUuid(caseKey,alias){const h=crypto.createHash('sha256').update('master-wok-delivery-staging-v1/'+caseKey+'/'+alias).digest('hex').slice(0,32);return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);}
const literal=s=>"'"+String(s).replace(/'/g,"''")+"'";
function seedSql() {
 const statements=['BEGIN;'];
 for(const c of makeCases()) {
  const s=c.source,aliases={};
  for(const o of s.orders){const id=fixtureUuid(c.caseKey,o.orderId);aliases[id]=o.orderId;
   statements.push(`INSERT INTO public.orders(id,created_at,preferred_time,proposed_time,confirmed_time,status,is_test,order_type,delivery_fee) VALUES(${literal(id)}::uuid,${literal(o.created_at)}::timestamptz,${literal(o.preferred_time)}::timestamptz,${o.proposed_time?literal(o.proposed_time)+'::timestamptz':'NULL'},NULL,${literal(o.status)},true,${literal(o.order_type)},0) ON CONFLICT(id) DO NOTHING;`);
  }
  for(const item of s.items)statements.push(`INSERT INTO public.order_items(id,order_id,item_id,qty,modifiers) VALUES(${literal(fixtureUuid(c.caseKey,item.id))}::uuid,${literal(fixtureUuid(c.caseKey,item.orderId))}::uuid,${literal(item.item_id)},${item.qty},${literal(JSON.stringify(item.modifiers))}::jsonb) ON CONFLICT(id) DO NOTHING;`);
  const evidence={existingPlan:s.existingPlan,legs:s.legs,maxEstimateAgeMinutes:s.maxEstimateAgeMinutes};
  statements.push(`INSERT INTO master_wok_delivery_test.cases(case_key,service_date,assessed_at,expected_orders,expected_items,order_aliases,candidate_ids,planning_evidence,expected_prediction,expected_kind) VALUES(${literal(c.caseKey)},${literal(s.serviceDate)}::date,${literal(s.assessedAt)}::timestamptz,${s.expectedOrders},${s.expectedItems},${literal(JSON.stringify(aliases))}::jsonb,${literal(JSON.stringify(s.candidateIds))}::jsonb,${literal(JSON.stringify(evidence))}::jsonb,${literal(c.expectedPrediction)},${c.expectedKind?literal(c.expectedKind):'NULL'}) ON CONFLICT(case_key) DO NOTHING;`);
 }
 statements.push('COMMIT;');return statements.join('\n');
}
module.exports={makeCases,seedSql,fixtureUuid};
