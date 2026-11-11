'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createReviewApproval,validApproval,hash}=require('./master-wok-review-approval');
const {planWithProtectedWork,protectStartedWork}=require('./master-wok-protected-plan');
const {validateKitchenTimeline}=require('./staging-kitchen-launch-validator');
const {remapPlanOrder}=require('./master-wok-service-plan-store');
const uuid='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const exception={approvalId:uuid,reviewId:uuid,maxMinutes:50,reason:'Customer agreed longer holding during phone discussion',staffActor:'staff@example.invalid',customerDiscussed:true,approvedAt:'2026-11-11T10:00:00Z'};
const options={serviceDate:'2026-11-28',sharedRings:true,stagingSharedRings:true,confirmedStarterRecipes:true,standaloneSpringRolls:true,now:'2026-11-11T10:00:00Z'};
const order={orderId:'a',readyMinute:1215,placedAt:new Date(2026,10,28,15)};
const row={id:'a',items:[{item_id:'pad-thai',qty:11,modifiers:[{id:'prawn'}],spice:null}]};
test('the actual eleven-noodle request fits only its explicit staff exception and persists through later bookings',()=>{
 const normal=planWithProtectedWork({...options,orders:[order],rows:[row]});assert.equal(normal.status,'UNVERIFIED');
 const accepted=planWithProtectedWork({...options,orders:[order],rows:[row],holdExceptions:{a:exception}});
 assert.equal(accepted.status,'VALIDATED_PROTECTED_PLAN',JSON.stringify(accepted));
 assert.ok(accepted.plan.wok.jobs.some(j=>j.readyMinute-j.finish>20));
 assert.ok(accepted.plan.wok.jobs.every(j=>j.readyMinute-j.finish<=50));
 const b={orderId:'b',readyMinute:1245,placedAt:order.placedAt},br={id:'b',items:[{item_id:'green-curry',qty:1,modifiers:[]}]};
 const later=planWithProtectedWork({...options,orders:[order,b],rows:[row,br],previousPlan:accepted.plan,newOrderId:'b'});
 assert.equal(later.status,'VALIDATED_PROTECTED_PLAN',JSON.stringify(later));
 assert.ok(later.plan.wok.jobs.filter(j=>j.orderIds.includes('b')).every(j=>j.readyMinute-j.finish<=20));
 const moved=remapPlanOrder(accepted.plan,'a','saved@2026-11-28T20:15:00Z');
 assert.deepEqual(moved.holdExceptions['saved@2026-11-28T20:15:00Z'],exception);assert.equal(moved.holdExceptions.a,undefined);
 assert.doesNotThrow(()=>protectStartedWork(moved,1200));
 const unapproved=structuredClone(accepted.plan);delete unapproved.holdExceptions;
 assert.throws(()=>protectStartedWork(unapproved,0),/INVALID_COMMITTED_PLAN/);
});
test('a larger hold does not bypass closures or vessel occupancy',()=>{
 const r=planWithProtectedWork({...options,orders:[order],rows:[row],holdExceptions:{a:exception},blackouts:[{start:990,finish:1320}]});
 assert.equal(r.status,'UNVERIFIED');
 const r2=planWithProtectedWork({...options,orders:[order],rows:[row],holdExceptions:{a:{...exception,customerDiscussed:false}}});
 assert.equal(r2.status,'UNVERIFIED');
});
const payload={reviewId:uuid,expectedStatus:'pending',agreedTime:'2026-11-28T20:15:00Z',maxHoldMinutes:50,reason:exception.reason,staffActor:exception.staffActor,customerDiscussed:true};
test('staff approval requires a recorded discussion, identity, bounded minutes and an exact current status',async()=>{
 for(const change of [{customerDiscussed:false},{reason:''},{staffActor:''},{maxHoldMinutes:331},{maxHoldMinutes:19},{expectedStatus:'closed'},{agreedTime:'not-a-time'}])assert.equal(validApproval({...payload,...change}),false);
 const calls=[];let release=false;
 const c={query:async(sql,args)=>{calls.push([sql,args]);if(sql.startsWith('SELECT *'))return {rows:[{id:uuid,status:'pending'}]};if(sql.startsWith('INSERT'))return {rows:[{id:uuid,expires_at:'2026-11-11T10:30:00Z'}]};return {rows:[]};},release(){release=true;}};
 const a=createReviewApproval({pool:{connect:async()=>c},assertWriteAllowed:async()=>{calls.push(['MODE_GATE']);}});
 const r=await a.approve(payload);assert.equal(r.success,true);assert.match(r.token,/^[a-f0-9]{64}$/);assert.equal(r.reservesCapacity,false);
 const insert=calls.find(([sql])=>sql.startsWith('INSERT'));assert.equal(insert[1][1],await hash(r.token));assert.ok(!JSON.stringify(calls).includes(r.token));
 assert.ok(calls.findIndex(([sql])=>sql==='MODE_GATE')<calls.findIndex(([sql])=>sql.startsWith('INSERT')));assert.equal(calls.at(-1)[0],'COMMIT');assert.ok(release);
});
test('checkout authorization rejects changed baskets, time, contact, address, expiry and missing customer acknowledgement',async()=>{
 const items=[{item_id:'pad-thai',qty:11,modifiers:[{id:'prawn'}]}];
 let stored={id:uuid,review_id:uuid,review_status:'approved',order_id:null,basket:items,order_type:'collection',customer_phone:'07700900982',agreed_time:payload.agreedTime,max_hold_minutes:50,reason:exception.reason,staff_actor:exception.staffActor,created_at:exception.approvedAt,expires_at:'2026-11-11T10:30:00Z'};
 const c={query:async sql=>({rows:sql.includes('clock_timestamp() AS now')?[{now:'2026-11-11T10:05:00Z'}]:[stored]})};
 const a=createReviewApproval({pool:{},assertWriteAllowed:async()=>{}});
 const request={items,orderType:'collection',preferredTime:payload.agreedTime,customer:{phone:'07700900982'},reviewApprovalToken:'a'.repeat(64),reviewHoldingAcknowledged:true};
 assert.equal((await a.authorize(c,request)).maxMinutes,50);
 for(const change of [{items:[{...items[0],qty:10}]},{preferredTime:'2026-11-28T20:20:00Z'},{customer:{phone:'07700900981'}},{reviewHoldingAcknowledged:false}])await assert.rejects(a.authorize(c,{...request,...change}),/MISMATCH/);
 for(const change of [{order_id:uuid},{review_status:'closed'},{expires_at:'2026-11-11T10:00:00Z'}]){
  const before=stored;stored={...stored,...change};await assert.rejects(a.authorize(c,request),/INVALID|EXPIRED/);stored=before;
 }
});
test('review checkout uses the existing booking transaction and atomically consumes the grant with the saved plan',async()=>{
 require('./master-wok-model-bundle');
 const {createAtomicCheckout}=require('./master-wok-atomic-checkout');
 const {verifyCombinedCapacity}=require('./master-wok-combined-assessment');
 const {priceBasket}=require('./master-wok-commercial');
 for(const consumeFails of [false,true]){
  const calls=[];let persistedPlan;
  const c={query:async sql=>{calls.push(sql);return {rows:sql==='SELECT clock_timestamp() AS now'?[{now:'2026-11-11T10:00:00Z'}]:[]};},release(){}};
  const checkout=createAtomicCheckout({pool:{connect:async()=>c},model:globalThis.MasterWokModelV1,mode:'MASTER_WOK',
   readOrders:async()=>[],readAvailability:async()=>({blackouts:[],serviceState:{mode:'normal',capacity_throttle:0}}),
   validateCommercialOrder:async(_c,input)=>({header:{preferred_time:input.preferredTime,order_type:'collection'},items:priceBasket(input.items).items}),
   assessBooking:ctx=>{const result=verifyCombinedCapacity(ctx,{sharedRings:true,stagingSharedRings:true});return {...result,status:result.status==='VERIFIED_KITCHEN_CAPACITY'?'GREEN':'UNVERIFIED',bookingApprovalAllowed:result.status==='VERIFIED_KITCHEN_CAPACITY'};},
   store:{lookupKey:async()=>null,persist:async()=>{calls.push('PERSIST_ORDER');return {orderId:uuid};}},
   planStore:{read:async()=>null,save:async(_c,_d,plan)=>{calls.push('SAVE_PLAN');persistedPlan=plan;}},
   reviewApproval:{authorize:async()=>{calls.push('AUTHORIZE_GRANT');return exception;},consume:async()=>{calls.push('CONSUME_GRANT');if(consumeFails)throw Error('REVIEW_APPROVAL_ALREADY_USED');}}});
  const result=await checkout({key:'review-checkout',preferredTime:payload.agreedTime,orderType:'collection',items:row.items,reviewApprovalToken:'a'.repeat(64)});
  assert.equal(result.committed,!consumeFails,JSON.stringify(result));
  assert.ok(calls.indexOf('AUTHORIZE_GRANT')<calls.indexOf('PERSIST_ORDER'));
  assert.ok(calls.indexOf('SAVE_PLAN')<calls.indexOf('CONSUME_GRANT'));
  assert.equal(calls.at(-1),consumeFails?'ROLLBACK':'COMMIT');
  assert.ok(persistedPlan.holdExceptions[uuid+'@'+new Date(payload.agreedTime).toISOString()]);
 }
});
