'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
require('./master-wok-model-bundle');
const {prepareStagingBasket}=require('./staging-canonical-basket'),{priceBasket}=require('./master-wok-commercial'),{relativePlacement}=require('./master-wok-clock'),{createDeliveryCapacity}=require('./master-wok-delivery-capacity');
const date='2026-11-13',now=new Date(date+'T09:00:00Z'),availability={blackouts:[],serviceState:{mode:'normal',capacity_throttle:0}};
const line=(item_id,qty,mods=[],spice=1)=>({item_id,qty,modifiers:mods.map(id=>({id})),spice,item_note:null});
function prepare(id,items,ready){const p=prepareStagingBasket({id,createdAt:now,serviceDate:date,readyMinute:ready,items:priceBasket(items).items,model:globalThis.MasterWokModelV1});assert.equal(p.status,'PREPARED');return {...p.candidate,placedAt:relativePlacement(now,date),items:p.rawRow.items,rawRow:{...p.rawRow,order_type:'collection'},validatedHeader:{order_type:'collection',preferred_time:date+'T'+String(Math.floor(ready/60)).padStart(2,'0')+':'+String(ready%60).padStart(2,'0')+':00Z'}};}
test('exact £104.50 split-line basket verifies consistently and retains exact fryer coverage',async()=>{
 const capacity=createDeliveryCapacity({stagingSharedRings:true,quoteLeg:async()=>{throw Error('No external routes');}});
 const existing=prepare('existing-fixture',[line('green-curry',4,['tofu'])],1020),plan=await capacity.replan({orders:[existing],rows:[existing.rawRow],previousPlan:null,serviceDate:date,now,availability});assert.equal(plan.status,'VALIDATED_PROTECTED_PLAN');
 for(const beef of [2,0,1,2,3,4,8,9,2])for(const ready of [1020,1110]){
  const lines=[line('tom-yum',2,['prawn'],2),line('veg-spring-rolls',3,[],0),...(beef?[line('beef-salad',beef,[],2)]:[]),line('salt-chickenchips',2),line('salt-chickenchips',4)];
  if(beef===2)assert.equal(priceBasket(lines).subtotalCents,10450);
  const candidate=prepare('availability-candidate',lines,ready);
  const r=await capacity.verify({assessmentPurpose:'AVAILABILITY_HINT',serviceDate:date,acceptedOrders:[existing],rawRows:[existing.rawRow],state:{now,availability,previousPlan:plan.plan},proposedOrder:candidate},{maxSearchNodes:1000,maxCompleteChecks:8});
  if(beef===9){assert.equal(r.status,'UNVERIFIED');assert.equal(r.reason,'FIXED_COLD_PREP_WORKLOAD_EXCEEDS_WINDOW');continue;}
  if(beef===8&&ready===1020){assert.equal(r.status,'UNVERIFIED');continue;}
  assert.equal(r.status,'VERIFIED_KITCHEN_CAPACITY',JSON.stringify({beef,ready,reason:r.reason}));
  const totals={};for(const job of r.plan.fryer.jobs)for(const a of job.allocations||[])if(a.orderId===candidate.orderId)totals[a.type]=(totals[a.type]||0)+a.qty;
  assert.equal(totals.crispyChicken,6);assert.equal(totals.chips,6);
 }
});
