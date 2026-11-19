'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
require('./master-wok-model-bundle');
const fixture=require('./staging-tests/remaining-slot-fixture-corrected-hob.json');
const {expandCommitments}=require('./master-wok-commitment-reader');
const {normalizeStagingOrders}=require('./staging-order-snapshot');
const {prepareStagingBasket}=require('./staging-canonical-basket');
const {relativePlacement}=require('./master-wok-clock');
const {createDeliveryCapacity}=require('./master-wok-delivery-capacity');
const items=[['veg-spring-rolls',3,null,0],['tom-yum',2,'prawn',2],['salt-chickenchips',2,null,1],['salt-chickenchips',4,null,1],['beef-salad',2,null,2]].map(([item_id,qty,p,spice])=>({item_id,qty,modifiers:p?[{id:p}]:[],spice}));
test('corrected hob baseline preserves proven later conflicts and keeps unresolved opening delivery unverified',async()=>{
 const model=globalThis.MasterWokModelV1,{serviceDate,now}=fixture,rows=expandCommitments(fixture.rows,serviceDate);
 const acceptedOrders=normalizeStagingOrders({rows,model,serviceDate}).map(o=>({...o,placedAt:relativePlacement(o.placedAt,serviceDate)}));
 let legSeconds=240;const capacity=createDeliveryCapacity({stagingSharedRings:true,quoteLeg:async()=>({durationSeconds:legSeconds})});
 const before=JSON.stringify(fixture);
 for(const [minute,seconds] of [[1020,240],[1020,360],[1160,240],[1165,240],[1170,240],[1020,420]]){
  legSeconds=seconds;
  const p=prepareStagingBasket({id:'candidate',createdAt:now,serviceDate,readyMinute:minute,items,model});
  const time=serviceDate+'T'+String(minute/60|0).padStart(2,'0')+':'+String(minute%60).padStart(2,'0')+':00Z';
  const result=await capacity.verify({serviceDate,acceptedOrders,rawRows:rows,state:{now,availability:{blackouts:[],serviceState:{mode:'normal',capacity_throttle:0}},previousPlan:fixture.plan},
   proposedOrder:{...p.candidate,placedAt:relativePlacement(now,serviceDate),rawRow:p.rawRow,validatedHeader:{order_type:minute===1020?'delivery':'collection',preferred_time:time,customer_lat:53.752,customer_lng:-1.58}}},{maxSearchNodes:1000,maxCompleteChecks:8,preserveOnly:true});
  assert.equal(result.bookingApprovalAllowed,false);
  if(minute===1020&&seconds===420)assert.equal(result.reason,'FRYER_WINDOW_CAPACITY_EXCEEDED');
  else if(minute===1020){assert.equal(result.status,'UNVERIFIED');assert.equal(result.reason,'SEARCH_LIMIT');}
  else assert.equal(result.reason,'FIXED_VESSEL_CAPACITY_EXCEEDED');
 }
 assert.equal(JSON.stringify(fixture),before);
});
