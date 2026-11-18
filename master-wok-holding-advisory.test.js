'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
require('./master-wok-model-bundle');
const {createDeliveryCapacity}=require('./master-wok-delivery-capacity');
const {prepareStagingBasket}=require('./staging-canonical-basket');
const {warnings,reviewPlans,token}=require('./master-wok-holding-advisory');
const {remapPlanOrder}=require('./master-wok-service-plan-store');
const {protectStartedWork}=require('./master-wok-protected-plan');
const {createMutationAssessment}=require('./master-wok-mutation-assessment');
const date='2026-11-28',now='2026-11-18T07:30:00Z',id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
function context(type='collection',qty=11){
 const prepared=prepareStagingBasket({id,createdAt:now,serviceDate:date,readyMinute:1215,model:globalThis.MasterWokModelV1,items:[{item_id:'pad-thai',qty,modifiers:[{id:'prawn'}],spice:0}]});
 return {serviceDate:date,state:{now,availability:{blackouts:[],serviceState:{mode:'normal',capacity_throttle:0}},previousPlan:null},acceptedOrders:[],rawRows:[],proposedOrder:{...prepared.candidate,rawRow:prepared.rawRow,validatedHeader:{order_type:type,preferred_time:date+'T20:15:00Z',customer_lat:53.752,customer_lng:-1.58}}};
}
const capacity=(enabled=true)=>createDeliveryCapacity({stagingSharedRings:true,advisoryHolding:enabled,quoteLeg:async()=>({durationSeconds:480})});
const search={maxSearchNodes:1000,maxCompleteChecks:8,preserveOnly:true};
test('a verified long kitchen hold can reserve a pending collection or delivery without a customer approval link',async()=>{
 for(const type of ['collection','delivery']){
  const c=context(type),strict=await capacity(false).verify(c,search);assert.equal(strict.status,'UNVERIFIED');
  const r=await capacity().verify(c,search);assert.equal(r.status,'VERIFIED_KITCHEN_CAPACITY',r.reason);assert.equal(r.bookingApprovalAllowed,false);
  const w=warnings(r.plan);assert.equal(w.length,1);assert.ok(w[0].estimatedMinutes>20);assert.equal(w[0].dishes[0].itemId,'pad-thai');
  assert.equal(r.plan.holdingAdvisories[id].maxMinutes,w[0].estimatedMinutes);assert.deepEqual(r.plan.holdExceptions,{});
  assert.doesNotThrow(()=>protectStartedWork(r.plan,0));
  const saved=remapPlanOrder(r.plan,id,id+'@'+date+'T20:15:00.000Z');assert.equal(warnings(saved)[0].orderId,id);assert.doesNotThrow(()=>protectStartedWork(saved,0));
 }
});
test('advisory holding cannot bypass a closure, late arrival, driver conflict or an unverified search',async()=>{
 const c=context();c.state.availability.blackouts=[{active:true,kind:'closed',start_at:date+'T16:30:00Z',end_at:date+'T22:00:00Z'}];
 assert.equal((await capacity().verify(c,search)).reason,'BLACKOUT');
 const early=context('delivery');early.proposedOrder.validatedHeader.preferred_time=date+'T16:00:00Z';early.proposedOrder.readyMinute=960;
 assert.notEqual((await capacity().verify(early,search)).status,'VERIFIED_KITCHEN_CAPACITY');
 assert.equal((await capacity().verify(context('collection',100),search)).status,'UNVERIFIED');
});
test('warnings require the exact current staff review and remain auditable after acceptance',async()=>{
 const r=await capacity().verify(context(),search),plans={[date]:r.plan};
 const required=reviewPlans(plans,{id},{},now);assert.equal(required.reason,'EXTENDED_HOLDING_REVIEW_REQUIRED');
 assert.equal(reviewPlans(plans,{id},{staffActor:'staff@example.invalid',warningToken:'stale'},now).ok,false);
 assert.equal(reviewPlans(plans,{id},{staffActor:'staff@example.invalid',warningToken:required.warningToken},now).ok,true);
 const w=warnings(r.plan)[0];assert.equal(r.plan.holdingAcknowledgements[id].staffActor,'staff@example.invalid');assert.equal(r.plan.holdingAcknowledgements[id].warningToken,token(w));
 assert.equal(reviewPlans(plans,{id},{},now).ok,true);
 r.plan.wok.jobs.find(j=>j.holdingMinutes>20).finish--;
 assert.equal(reviewPlans(plans,{id},{},now).ok,false);
});
test('ordinary baskets keep the normal target and need no holding acknowledgement',async()=>{
 const r=await capacity().verify(context('collection',1),search);assert.equal(r.status,'VERIFIED_KITCHEN_CAPACITY');assert.deepEqual(warnings(r.plan),[]);
 assert.equal(reviewPlans({[date]:r.plan},{id},{},now).ok,true);
});
test('lifecycle assessment blocks confirmation and payment completion until the staff warning is acknowledged',async()=>{
 const c=context(),r=await capacity().verify(c,search);const source={...c.proposedOrder.rawRow,id,source_order_id:id,confirmed_time:date+'T20:15:00Z',preferred_time:date+'T20:15:00Z',capacity_scheduler:'MASTER_WOK',is_test:false};
 const previous=remapPlanOrder(r.plan,id,id+'@'+date+'T20:15:00.000Z');source.id=id+'@'+date+'T20:15:00.000Z';
 const assess=createMutationAssessment({model:globalThis.MasterWokModelV1,readOrders:async()=>[source],readAvailability:async()=>c.state.availability,planStore:{read:async()=>previous},deliveryCapacity:capacity(),stagingSharedRings:true});
 const before={id,status:'pending',preferred_time:date+'T20:15:00Z',capacity_scheduler:'MASTER_WOK'},after={...before,status:'confirmed',confirmed_time:date+'T20:15:00Z'};
 const input={connection:{},before,after,dates:[date],now,action:'accept'};
 const first=await assess(input);assert.equal(first.reason,'EXTENDED_HOLDING_REVIEW_REQUIRED');
 const accepted=await assess({...input,holdingAuthorization:{staffActor:'staff@example.invalid',warningToken:first.warningToken}});assert.equal(accepted.status,'VALIDATED_LIFECYCLE_ASSESSMENT');
 const paid=await assess({...input,after:{...after,status:'completed'},action:'record_and_complete'});assert.equal(paid.reason,'EXTENDED_HOLDING_REVIEW_REQUIRED');
});
