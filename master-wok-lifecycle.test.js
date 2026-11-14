'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {actionPatch,createLifecycleWriter}=require('./master-wok-lifecycle');
const {commitmentTimes,expandCommitments}=require('./master-wok-commitment-reader');
const {demands}=require('./master-wok-mutation-assessment');
const id='00000000-0000-4000-8000-000000000001',token='a'.repeat(32);
const order=()=>({id,status:'confirmed',preferred_time:'2026-11-04T18:00:00Z',
 confirmed_time:'2026-11-04T18:00:00Z',proposed_time:null,is_test:false});
const admin={actor:'admin',now:'2026-11-01T12:00:00Z',tokenFactory:()=>token};
test('a proposal holds both original and new times until customer acknowledgement',()=>{
 const o=order(),p={...o,...actionPatch(o,{action:'suggest_time',proposedTime:'2026-11-05T19:00:00Z'},admin)};
 assert.equal(p.status,'proposed');assert.equal(commitmentTimes(p).length,2);
 assert.equal(expandCommitments([p],'2026-11-04').length,1);
 assert.equal(expandCommitments([p],'2026-11-05').length,1);
 const accepted={...p,...actionPatch(p,{action:'customer_accept',token},{actor:'customer'})};
 assert.deepEqual(commitmentTimes(accepted),['2026-11-05T19:00:00.000Z']);
 assert.equal(accepted.preferred_time,o.preferred_time);
});
test('declining a proposal retains the original commitment for staff resolution',()=>{
 const p={...order(),status:'proposed',proposed_time:'2026-11-04T19:00:00Z',confirm_token:token};
 const declined={...p,...actionPatch(p,{action:'customer_decline',token},{actor:'customer'})};
 assert.deepEqual(commitmentTimes(declined),['2026-11-04T18:00:00.000Z']);
});
test('staff acceptance and generic status changes cannot manufacture acknowledgement',()=>{
 const p={...order(),status:'proposed',proposed_time:'2026-11-04T19:00:00Z',confirm_token:token};
 assert.throws(()=>actionPatch(p,{action:'accept'},admin),/ACKNOWLEDGEMENT/);
 assert.throws(()=>actionPatch(p,{action:'set_status',status:'confirmed'},admin),/ACKNOWLEDGEMENT/);
 assert.throws(()=>actionPatch(p,{action:'customer_accept',token:'b'.repeat(32)},{actor:'customer'}));
});
test('payment action preserves status and does not fall through into completion',()=>{
 const patch=actionPatch(order(),{action:'mark_paid'},admin);
 assert.equal(patch.paid,true);assert.equal(patch.payment_status,'paid');assert.equal(patch.status,undefined);
});
test('test/cancellation exclusions and untimed active orders fail safely',()=>{
 assert.deepEqual(demands({...order(),is_test:true}),[]);
 assert.deepEqual(expandCommitments([{...order(),status:'cancelled'}],'2026-11-04'),[]);
 assert.throws(()=>expandCommitments([{id,status:'pending',preferred_time:null}],'2026-11-04'),/UNTIMED/);
});
test('tentative lifecycle update rolls back when assessor has no booking authority',async()=>{
 const log=[];let released=false;
 const c={query:async(sql)=>{log.push(sql);return {rows:sql.includes('FOR UPDATE')?[order()]:sql.includes('clock_timestamp')?[{now:admin.now}]:[]};},
  release:()=>{released=true;}};
 const writer=createLifecycleWriter({pool:{connect:async()=>c},mode:'MASTER_WOK',
  assessMutation:async()=>({status:'GREEN',bookingApprovalAllowed:false})});
 const result=await writer.adminAction({orderId:id,action:'suggest_time',proposedTime:'2026-11-04T19:00:00Z'});
 assert.equal(result.committed,false);assert.ok(log.some(s=>s.startsWith('UPDATE')));
 assert.equal(log.at(-1),'ROLLBACK');assert.equal(released,true);
});
test('lifecycle default does not acquire a connection or change production state',async()=>{
 const writer=createLifecycleWriter({pool:{connect:async()=>{throw Error('NO_ACCESS');}},assessMutation:async()=>{}});
 assert.equal((await writer.adminAction({orderId:id,action:'accept'})).reason,'USE_EXISTING_LIFECYCLE');
});

test('ordinary Accept cannot restore the original time after a declined proposal',()=>{assert.throws(()=>actionPatch({...order(),status:'customer_declined_time',proposed_time:'2026-11-04T19:00:00Z'},{action:'accept'},admin),/ACKNOWLEDGEMENT/);});
