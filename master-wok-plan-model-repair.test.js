'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
require('./master-wok-model-bundle');
const {prepareStagingBasket}=require('./staging-canonical-basket');
const {priceBasket}=require('./master-wok-commercial');
const {relativePlacement}=require('./master-wok-clock');
const {createDeliveryCapacity}=require('./master-wok-delivery-capacity');
const date='2026-11-13',now=new Date(date+'T08:00:00Z'),availability={blackouts:[],serviceState:{mode:'normal',capacity_throttle:0}};
function prepare(id,item,qty,modifier,ready){const p=prepareStagingBasket({id,createdAt:now,serviceDate:date,readyMinute:ready,items:priceBasket([{item_id:item,qty,modifiers:[{id:modifier}],spice:1}]).items,model:globalThis.MasterWokModelV1});assert.equal(p.status,'PREPARED');return {...p.candidate,placedAt:relativePlacement(now,date),items:p.rawRow.items,rawRow:{...p.rawRow,order_type:'collection'},validatedHeader:{order_type:'collection',preferred_time:date+'T'+String(Math.floor(ready/60)).padStart(2,'0')+':00:00Z'}};}
test('an incompatible old-model fixture plan blocks hints; a validated four-ring replan restores them without dropping the existing commitment',async()=>{
 const existing=prepare('existing-fixture','green-curry',4,'tofu',1020),candidate=prepare('availability-candidate','stir-pepper',1,'chicken',1140);
 const quoteLeg=async()=>{throw Error('No external routes');};
 const old=await createDeliveryCapacity({quoteLeg}).replan({orders:[existing],rows:[existing.rawRow],previousPlan:null,serviceDate:date,now,availability});assert.equal(old.status,'VALIDATED_PROTECTED_PLAN');
 const capacity=createDeliveryCapacity({quoteLeg,stagingSharedRings:true});
 const context={assessmentPurpose:'AVAILABILITY_HINT',serviceDate:date,acceptedOrders:[existing],rawRows:[existing.rawRow],state:{now,availability,previousPlan:old.plan},proposedOrder:candidate};
 const blocked=await capacity.verify(context,{maxSearchNodes:1000,maxCompleteChecks:8});assert.equal(blocked.reason,'SCHEDULER_MODEL_CHANGE_REQUIRES_DRAIN');
 const upgraded=await capacity.replan({orders:[existing],rows:[existing.rawRow],previousPlan:null,serviceDate:date,now,availability});assert.equal(upgraded.status,'VALIDATED_PROTECTED_PLAN');assert.equal(upgraded.plan.modelVersion,'combined-kitchen-four-ring-staging-v1');
 assert.ok(upgraded.plan.wok.jobs.some(job=>job.orderIds.includes(existing.orderId)));
 const restored=await capacity.verify({...context,state:{...context.state,previousPlan:upgraded.plan}},{maxSearchNodes:1000,maxCompleteChecks:8});assert.equal(restored.status,'VERIFIED_KITCHEN_CAPACITY');
});
