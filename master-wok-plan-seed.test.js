'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
require('./master-wok-model-bundle');
const {createPlanSeeder}=require('./master-wok-plan-seed');
const {expandCommitments}=require('./master-wok-commitment-reader');
function fixture({now='2026-11-04T16:00:00Z',mode='LEGACY',revision=6,previous=null,failSave=false,blackouts=[]}={}){
 const queries=[],saved=[];
 const c={query:async(sql,args)=>{queries.push(sql);if(sql.includes('approved_release_id'))return {rows:[{mode,revision,approved_release_id:"release-test-1"}]};
  if(sql.includes('clock_timestamp() AS now'))return {rows:[{now}]};return {rows:[]};},release(){queries.push('RELEASE');}};
 const rows=expandCommitments([{id:'legacy-fixture',status:'confirmed',is_test:false,created_at:'2026-11-03T18:00:00Z',
  confirmed_time:'2026-11-04T18:30:00Z',items:[{item_id:'stir-crispy',qty:1,modifiers:[],spice:1},
   {item_id:'jasmine-rice',qty:1,modifiers:[],spice:0},{item_id:'veg-spring-rolls',qty:1,modifiers:[],spice:0}]}],'2026-11-04');
 const seed=createPlanSeeder({pool:{connect:async()=>c},model:globalThis.MasterWokModelV1,releaseId:'release-test-1',
  readOrders:async()=>rows,readAvailability:async()=>({blackouts}),
  planStore:{read:async()=>previous,save:async(_c,_date,p)=>{if(failSave)throw Error('private connection detail');saved.push(p);}}});
 return {seed,queries,saved};
}
test('seed previews actual mixed legacy basket without saving or booking approval',async()=>{
 const f=fixture(),r=await f.seed({serviceDate:'2026-11-04',expectedRevision:6});
 assert.equal(r.ok,true);assert.equal(r.committed,false);assert.equal(r.bookingApprovalAllowed,false);
 assert.equal(r.commitments,1);assert.ok(r.jobs.wok>0&&r.jobs.fryer>0&&r.jobs.auxiliary>0);
 assert.equal(f.saved.length,0);assert.ok(f.queries.includes('ROLLBACK'));
 assert.ok(f.queries.indexOf('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 47824))')<f.queries.findIndex(s=>s.includes('approved_release_id')));
});
test('explicit operator commit saves once on the locked dedicated connection',async()=>{
 const f=fixture(),r=await f.seed({serviceDate:'2026-11-04',expectedRevision:6,commit:true});
 assert.equal(r.committed,true);assert.equal(f.saved.length,1);assert.ok(f.queries.includes('COMMIT'));
 assert.equal(f.queries.at(-1),'RELEASE');
});
test('seed refuses running service, existing plan, changed revision and active writer',async()=>{
 for(const [options,reason] of [[{now:'2026-11-04T16:30:00Z'},'SEED_REQUIRES_PRE_SERVICE_WINDOW'],
  [{previous:{}},'SERVICE_PLAN_ALREADY_EXISTS'],[{revision:7},'SEED_REQUIRES_EXPECTED_LEGACY_REVISION'],
  [{mode:'MASTER_WOK'},'SEED_REQUIRES_EXPECTED_LEGACY_REVISION'],[{mode:'DRAINING'},'SEED_REQUIRES_EXPECTED_LEGACY_REVISION']]){
  const f=fixture(options),r=await f.seed({serviceDate:'2026-11-04',expectedRevision:6,commit:true});
  assert.equal(r.reason,reason);assert.equal(f.saved.length,0);assert.ok(f.queries.includes('ROLLBACK'));
 }
});
test('closed production time cannot be used to seed an apparently feasible promise',async()=>{
 const f=fixture({blackouts:[{kind:'closed',start_at:'2026-11-04T16:30:00Z',end_at:'2026-11-04T22:00:00Z'}]});
 const r=await f.seed({serviceDate:'2026-11-04',expectedRevision:6,commit:true});
 assert.equal(r.reason,'SEED_PLAN_NOT_VALIDATED');assert.equal(f.saved.length,0);
});
test('failed persistence rolls back and does not disclose database errors',async()=>{
 const f=fixture({failSave:true}),r=await f.seed({serviceDate:'2026-11-04',expectedRevision:6,commit:true});
 assert.equal(r.reason,'SEED_UNAVAILABLE');assert.ok(f.queries.includes('ROLLBACK'));assert.equal(r.committed,false);
});
test('invalid operator requests never acquire a connection',async()=>{
 for(const input of [{serviceDate:'2026-11-04',expectedRevision:6,commit:'true'},
  {serviceDate:'2026-02-30',expectedRevision:6},{serviceDate:'2026-11-04',expectedRevision:'6'}]){
  const f=fixture(),r=await f.seed(input);assert.equal(r.committed,false);assert.equal(f.saved.length,0);
 }
});
