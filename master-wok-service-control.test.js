'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createServiceControlWriter}=require('./master-wok-service-control');
function setup(row,{gate=async()=>{},blackouts=[]}={}){
 const queries=[];let released=false;
 const connection={query:async sql=>{queries.push(sql);return {rows:sql.includes('server_now')?[row]:sql.includes('SELECT id,kind')?blackouts:[]};},release:()=>{released=true;}};
 return {queries,run:createServiceControlWriter({pool:{connect:async()=>connection},schema:'master_wok_rehearsal',assertWriteAllowed:gate}),released:()=>released};
}
test('expired service control returns effective normal without rewriting stored busy mode',async()=>{
 const stored={id:1,mode:'busy',capacity_throttle:'0.5',customer_message:'Slower',effective_until:'2026-11-02T07:00:00Z',server_now:'2026-11-02T07:30:00Z'};
 const s=setup(stored),r=await s.run({action:'get_service_state'});
 assert.equal(r.ok,true);assert.equal(r.committed,false);assert.equal(r.expired,true);
 assert.equal(r.service_state.mode,'busy');assert.equal(r.effective_service_state.mode,'normal');assert.equal(r.effective_service_state.customer_message,null);
 assert.ok(!s.queries.some(q=>/^(UPDATE|INSERT|DELETE)/.test(q)));assert.equal(s.released(),true);
});
test('active pause and future expiry remain authoritative in service-control reads',async()=>{
 const s=setup({id:1,mode:'paused',capacity_throttle:0,effective_until:'2026-11-02T08:00:00Z',server_now:'2026-11-02T07:30:00Z'});
 const r=await s.run({action:'get_service_state'});assert.equal(r.expired,false);assert.equal(r.effective_service_state.mode,'paused');
});
test('control reads cannot bypass a disabled writer gate or silently normalize corrupt state',async()=>{
 const denied=setup(null,{gate:async()=>{throw Error('AUTHORITATIVE_WRITER_DISABLED');}});
 assert.equal((await denied.run({action:'list_blackouts'})).statusCode,503);
 assert.ok(!denied.queries.some(q=>q.includes('SELECT id,kind')));assert.equal(denied.queries.at(-1),'ROLLBACK');
 const invalid=setup({mode:'busy',capacity_throttle:0.5,server_now:'2026-11-02T07:30:00Z',effective_until:'bad'});
 assert.equal((await invalid.run({action:'get_service_state'})).statusCode,503);
});
test('restriction list uses the same private schema and keeps the existing response contract',async()=>{
 const blackouts=[{id:'fixture',kind:'fully_booked',active:true}],s=setup(null,{blackouts});
 const r=await s.run({action:'list_blackouts'});assert.deepEqual(r.blackouts,blackouts);assert.equal(r.committed,false);
 assert.ok(s.queries.some(q=>q.includes('"master_wok_rehearsal".booking_blackouts')&&q.includes('end_at>=clock_timestamp()')));
});
