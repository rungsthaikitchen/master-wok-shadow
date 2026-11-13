'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createPaymentCompletion}=require('./master-wok-payment-completion');
const order={id:'00000000-0000-4000-8000-000000000001',status:'confirmed',preferred_time:'2026-11-13T18:00:00Z',is_test:false};
function fixture(assessment){const log=[];let settlements=0,plans=0;const connection={query:async(sql)=>{log.push(sql);return {rows:sql.startsWith('SELECT clock_timestamp')?[{now:'2026-11-13T18:05:00Z'}]:[]};}};const complete=createPaymentCompletion({assessMutation:async x=>{assert.equal(x.action,'complete');assert.equal(x.after.status,'completed');return assessment;},planStore:{save:async()=>plans++},settleLoyalty:async(c,o,options)=>{assert.equal(c,connection);assert.equal(options.allowLegacy,true);settlements++;return {handled:true,settled:true};}});return {complete,connection,log,counts:()=>({settlements,plans})};}
test('combined completion uses certified lifecycle assessment and settles on the same connection',async()=>{const f=fixture({status:'GREEN',bookingApprovalAllowed:true,plansByDate:{'2026-11-13':{}}});const result=await f.complete({connection:f.connection,order});assert.equal(result.status,'completed');assert.equal(result.loyalty_settled,true);assert.deepEqual(f.counts(),{settlements:1,plans:1});assert.ok(!f.log.includes('COMMIT'));});
test('already completed payment detail entry cannot replan or settle loyalty again',async()=>{const f=fixture();const result=await f.complete({connection:f.connection,order:{...order,status:'completed'}});assert.equal(result.alreadyCompleted,true);assert.deepEqual(f.log,[]);assert.deepEqual(f.counts(),{settlements:0,plans:0});});
test('uncertified or missing service plans refuse payment completion before loyalty',async()=>{for(const a of [{status:'GREEN',bookingApprovalAllowed:false},{status:'GREEN',bookingApprovalAllowed:true,plansByDate:{}}]){const f=fixture(a);await assert.rejects(()=>f.complete({connection:f.connection,order}),/PAYMENT_COMPLETION_NOT_VERIFIED/);assert.equal(f.counts().settlements,0);}});
test('unacknowledged proposals and cancelled orders cannot be silently completed via payment',async()=>{for(const status of ['proposed','customer_declined_time','cancelled']){const f=fixture();await assert.rejects(()=>f.complete({connection:f.connection,order:{...order,status}}),/PAYMENT_COMPLETION_STATE_REFUSED/);assert.deepEqual(f.log,[]);}});

test('known completion refusal is a definitive conflict, not an uncertain payment retry',async()=>{const {createPaymentWriter}=require('./master-wok-payments');const log=[];const c={query:async(sql)=>{log.push(sql);return {rows:sql.startsWith('SELECT * FROM')&&sql.includes('.orders ')?[{...order,total:'10.00'}]:[]};},release:()=>{}};const writer=createPaymentWriter({pool:{connect:async()=>c},assertWriteAllowed:async()=>{},completeOrder:async()=>{throw Error('PAYMENT_COMPLETION_NOT_VERIFIED');}});const result=await writer({action:'record_and_complete',orderId:order.id,staffActor:'staff@example.invalid',billAmount:'10.00',billMethod:'card',tipAmount:'0.00',idempotencyKey:'81af0025-b36d-4109-b8c0-bb50005856bd'});assert.equal(result.statusCode,409);assert.equal(result.committed,false);assert.equal(log.at(-1),'ROLLBACK');assert.equal(log.filter(s=>s.startsWith('INSERT')).length,0);});

test('previous-day legacy bookkeeping completion keeps its source and never touches plans or settled loyalty',async()=>{
 const log=[];let assessed=0,settled=0,saved=0;
 const c={query:async(sql)=>{log.push(sql);return {rows:sql.startsWith('SELECT clock_timestamp')?[{now:'2026-11-13T07:00:00Z'}]:[]};}};
 const complete=createPaymentCompletion({assessMutation:async()=>{assessed++;throw Error('must not replan');},planStore:{read:async()=>null,save:async()=>saved++},settleLoyalty:async()=>settled++});
 const r=await complete({connection:c,order:{...order,capacity_scheduler:'LEGACY',loyalty_settled:true,status:'customer_accepted_time',confirmed_time:'2026-10-31T17:30:00Z',preferred_time:'2026-10-31T17:20:00Z'}});
 assert.equal(r.historicalCompletion,true);assert.equal(r.loyalty_settled,true);assert.equal(assessed+settled+saved,0);assert.ok(log.some(s=>s.includes("SET status='completed' WHERE")));assert.ok(!log.some(s=>s.includes("SET status='completed',capacity_scheduler")));assert.ok(!log.includes('COMMIT'));
});
test('legacy source alone never exempts a current/future service or existing Master Wok plan/receipt',async()=>{
 for(const kind of ['current','future','receipt','plan','master-wok']){
  let assessments=0;const o={...order,capacity_scheduler:kind==='master-wok'?'MASTER_WOK':'LEGACY',loyalty_settled:true,preferred_time:kind==='current'?'2026-11-13T18:00:00Z':kind==='future'?'2026-11-14T18:00:00Z':'2026-10-31T17:30:00Z'};
  const c={query:async sql=>({rows:sql.startsWith('SELECT clock_timestamp')?[{now:'2026-11-13T07:00:00Z'}]:kind==='receipt'&&sql.startsWith('SELECT order_id')?[{order_id:o.id}]:[]})};
  const complete=createPaymentCompletion({assessMutation:async()=>{assessments++;return {status:'UNVERIFIED'};},planStore:{read:async()=>kind==='plan'?{}:null,save:async()=>{throw Error('no save');}}});
  await assert.rejects(()=>complete({connection:c,order:o}),/PAYMENT_COMPLETION_NOT_VERIFIED/);assert.equal(assessments,1,kind);
 }
});
test('unsettled historical loyalty needs review rather than guessing an old award',async()=>{
 const c={query:async sql=>({rows:sql.startsWith('SELECT clock_timestamp')?[{now:'2026-11-13T07:00:00Z'}]:[]})};
 const complete=createPaymentCompletion({assessMutation:async()=>{throw Error('must not assess');},planStore:{read:async()=>null}});
 await assert.rejects(()=>complete({connection:c,order:{...order,capacity_scheduler:'LEGACY',loyalty_settled:false,preferred_time:'2026-10-31T17:30:00Z'}}),/HISTORICAL_PAYMENT_LOYALTY_REVIEW_REQUIRED/);
});
