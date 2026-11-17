'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {beginHintSnapshot,createHintSnapshotReader}=require('./master-wok-hint-snapshot');
test('hint snapshot is repeatable and read-only without acquiring writer locks or enabling writes',async()=>{
 const queries=[];await beginHintSnapshot({query:async(sql,args)=>queries.push({sql,args})},'2026-11-21');
 assert.equal(queries.length,1);assert.match(queries[0].sql,/REPEATABLE READ READ ONLY/);
 assert.ok(!queries.some(q=>/advisory|set_config|\bCOMMIT\b/.test(q.sql)));
 await assert.rejects(beginHintSnapshot({query:()=>assert.fail('invalid date must not query')},'2026-02-30'));
});
test('one snapshot query retains both proposal commitments, service controls and the previous plan',async()=>{
 let queries=0;const plan={fixture:true};
 const read=createHintSnapshotReader({schema:'master_wok_rehearsal'});
 const result=await read({query:async(sql,args)=>{
  queries++;assert.deepEqual(args,['2026-11-21']);assert.match(sql,/master_wok_rehearsal.orders/);assert.doesNotMatch(sql,/FOR UPDATE/);
  return {rows:[{now:'2026-11-17T12:00:00Z',orders:[{id:'existing',is_test:false,status:'proposed',created_at:'2026-11-17T08:00:00Z',preferred_time:'2026-11-21T18:00:00Z',proposed_time:'2026-11-21T18:15:00Z',items:[]}],
   blackouts:[{kind:'closed'}],service_state:{mode:'busy',capacity_throttle:1},previous_plan:plan}]};
 }},'2026-11-21');
 assert.equal(queries,1);assert.equal(result.rows.length,2);assert.deepEqual(result.rows.map(r=>r.local_ready_minute),[1080,1095]);
 assert.equal(result.previousPlan,plan);assert.equal(result.availability.serviceState.mode,'busy');assert.equal(result.availability.blackouts.length,1);
});
test('snapshot reader rejects missing service state and arbitrary schemas',async()=>{
 assert.throws(()=>createHintSnapshotReader({schema:'other'}),/INVALID_SNAPSHOT_SCHEMA/);
 await assert.rejects(createHintSnapshotReader()({query:async()=>({rows:[{now:'2026-11-17',orders:[],blackouts:[]}]})},'2026-11-21'),/INVALID_HINT_SNAPSHOT/);
});
