'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
require('./master-wok-model-bundle');
const {prepareStagingBasket}=require('./staging-canonical-basket');
const {createDeliveryCapacity}=require('./master-wok-delivery-capacity');
const items=require('./staging-tests/slow-basket-2026-11-18.json');
test('mixed delivery basket checks a full service without repeating independent appliance searches',async()=>{
 const date='2026-11-18',now=date+'T06:25:00Z';
 const capacity=createDeliveryCapacity({stagingSharedRings:true,advisoryHolding:true,quoteLeg:async()=>({durationSeconds:240})});
 const cpu=process.cpuUsage();
 for(let slot=0;slot<61;slot++){
  const time=new Date(Date.UTC(2026,10,18,17,slot*5)).toISOString();
  const p=prepareStagingBasket({id:'candidate',createdAt:now,serviceDate:date,readyMinute:1020+slot*5,items,model:globalThis.MasterWokModelV1});
  const result=await capacity.verify({assessmentPurpose:'AVAILABILITY_HINT',serviceDate:date,acceptedOrders:[],rawRows:[],
   state:{now,availability:{blackouts:[],serviceState:{mode:'normal',capacity_throttle:0}},previousPlan:null},
   proposedOrder:{...p.candidate,rawRow:p.rawRow,validatedHeader:{order_type:'delivery',preferred_time:time,customer_lat:53.752,customer_lng:-1.58}}},
   {maxSearchNodes:1000,maxCompleteChecks:8,preserveOnly:true});
  if(slot===0){assert.equal(result.status,'UNVERIFIED');assert.equal(result.reason,'SEARCH_LIMIT');continue;}
  assert.equal(result.status,'VERIFIED_KITCHEN_CAPACITY',result.reason);
  assert.equal(result.bookingApprovalAllowed,false);
  assert.equal(require('./master-wok-driver-plan').validateFoodAge(result.plan),true);
  const finish=result.plan.auxiliary.jobs.find(j=>j.itemId==='moo-ping');
  assert.ok(finish);
  assert.ok(result.plan.wok.jobs.every(j=>finish.start>=j.finish+1||finish.finish+1<=j.start));
 }
 const used=process.cpuUsage(cpu);
 assert.ok(used.user+used.system<5000000,'61 read-only hints must use less than five CPU seconds');
});
