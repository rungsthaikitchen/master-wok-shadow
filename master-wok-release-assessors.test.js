'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createReleaseAssessors,validateCertificate,REQUIRED_CHECKS}=require('./master-wok-release-assessors');
const {createDeploymentRuntime}=require('./master-wok-deployment');
const {assessCombinedBooking}=require('./master-wok-combined-assessment');
const draft={...require('./master-wok-release-candidate.json'),status:'DRAFT'};
require('./master-wok-model-bundle');
const binding={releaseId:'staging-release-1',sourceSha256:'a'.repeat(64),projectRef:'hvrqgufqjslvgiohgkvu',schema:'master_wok_rehearsal'};
const certificate=()=>({schemaVersion:1,status:'CERTIFIED_FOR_STAGING',...binding,modelVersion:'combined-kitchen-protected-v3',checks:Object.fromEntries(REQUIRED_CHECKS.map(k=>[k,'PASS']))});
const context=()=>({serviceDate:'2026-11-04',acceptedOrders:[],rawRows:[],
 proposedOrder:{orderId:'candidate',placedAt:new Date(2026,10,4,16,0),readyMinute:1140,
  rawRow:{id:'candidate',items:[{item_id:'green-curry',qty:1,modifiers:[{id:'chicken'}],spice:1}]},
  validatedHeader:{preferred_time:'2026-11-04T19:00:00Z'}},
 state:{now:'2026-11-04T16:00:00Z',availability:{blackouts:[],serviceState:{mode:'normal',capacity_throttle:0}}}});
function assessors(c=certificate()){return createReleaseAssessors({...binding,certificate:c,model:globalThis.MasterWokModelV1,
 readOrders:async()=>[],readAvailability:async()=>({blackouts:[]}),planStore:{read:async()=>null}});}
test('a draft certificate cannot initialize a production booking runtime even with the matching source',()=>{
 assert.equal(draft.status,'DRAFT');
 assert.throws(()=>createDeploymentRuntime({pool:{connect:async()=>{throw Error('must not connect');}},model:globalThis.MasterWokModelV1,
  certificate:draft,releaseId:draft.releaseId,projectRef:draft.projectRef,sourceSha256:draft.sourceSha256,
  secret:'b'.repeat(64),notificationSecret:'c'.repeat(64),deliveryPublicKey:'sb_publishable_fixture'}),/CERTIFICATION_REQUIRED/);
});
test('certificate binds exact source, project, schema, model and release; every check required',()=>{
 assert.equal(validateCertificate(certificate(),binding),true);
 for(const change of [{sourceSha256:'b'.repeat(64)},{projectRef:'ubyjrrsvbbqomitpaidb'},{releaseId:'another-release'},
  {schema:'public'},{modelVersion:'old-model'},{status:'DRAFT'}])assert.throws(()=>validateCertificate({...certificate(),...change},binding),/CERTIFICATION_REQUIRED/);
 for(const key of REQUIRED_CHECKS){const c=certificate();delete c.checks[key];assert.throws(()=>validateCertificate(c,binding),/CERTIFICATION_REQUIRED/);}
 assert.throws(()=>validateCertificate(certificate(),{...binding,projectRef:'ubyjrrsvbbqomitpaidb',schema:'public'}),/CERTIFICATION_REQUIRED/);
});
test('prototype diagnostics remain non-authoritative; certified staging assessor uses complete validation',()=>{
 const c=context();assert.equal(assessCombinedBooking(c).bookingApprovalAllowed,false);
 const r=assessors().assessBooking(c);assert.equal(r.status,'GREEN');assert.equal(r.bookingApprovalAllowed,true);
 assert.equal(r.plan.modelVersion,certificate().modelVersion);
});
test('forged GREEN status cannot bypass missing state, pause, lead time or blackouts',()=>{
 const a=assessors();
 for(const change of [c=>{c.state=null;},c=>{c.state.availability.serviceState.mode='paused';},
  c=>{c.state.now='2026-11-04T18:55:00Z';},
  c=>{c.state.availability.blackouts=[{kind:'closed',start_at:'2026-11-04T16:30:00Z',end_at:'2026-11-04T22:00:00Z'}];}]){
  const c=context();change(c);c.status='GREEN';c.bookingApprovalAllowed=true;
  const r=a.assessBooking(c);assert.equal(r.status,'UNVERIFIED');assert.equal(r.bookingApprovalAllowed,false);
 }
});
test('notification and booking secrets must be distinct before deployment initialization',()=>{
 assert.throws(()=>createDeploymentRuntime({secret:'x'.repeat(64),notificationSecret:'x'.repeat(64)}),/DISTINCT_SERVER_SECRETS_REQUIRED/);
});

test('an explicitly scoped staging candidate can be rehearsed without falsely certifying pending checks',()=>{
 const c={...certificate(),status:'CANDIDATE_FOR_STAGING',fixturePrefix:'release-fixture-',checks:Object.fromEntries(REQUIRED_CHECKS.map(k=>[k,'PENDING']))};
 assert.equal(validateCertificate(c,binding),true);
 assert.throws(()=>validateCertificate({...c,fixturePrefix:undefined},binding),/CERTIFICATION_REQUIRED/);
 assert.throws(()=>validateCertificate({...c,projectRef:'ubyjrrsvbbqomitpaidb',schema:'public'},
  {...binding,projectRef:'ubyjrrsvbbqomitpaidb',schema:'public'}),/CERTIFICATION_REQUIRED/);
});

test('delivery certification cannot initialize without its full driver component or driver checks',()=>{
 const c={...certificate(),deliveryScheduling:1};
 assert.throws(()=>assessors(c),/CERTIFICATION_REQUIRED/);
 for(const name of ['driverReservations','combinedTrips','deliveryCheckout','deliveryRollback'])c.checks[name]='PASS';
 assert.throws(()=>assessors(c),/CERTIFIED_DELIVERY_COMPONENT_REQUIRED/);
});

test('four-ring candidate stays private; certification binds the actual four-ring model',()=>{
 const c={...certificate(),status:'CANDIDATE_FOR_STAGING',fixturePrefix:'release-four-ring-',
  modelVersion:'combined-kitchen-four-ring-staging-v1',kitchenConfiguration:'FOUR_RING_ONE_PORTION_V1',
  checks:Object.fromEntries(REQUIRED_CHECKS.map(k=>[k,'PENDING']))};
 assert.equal(validateCertificate(c,binding),true);
 for(const patch of [{kitchenConfiguration:undefined},{kitchenConfiguration:'UNKNOWN'},
  {status:'CERTIFIED_FOR_STAGING'},{status:'CERTIFIED_FOR_PRODUCTION'}])
  assert.throws(()=>validateCertificate({...c,...patch},binding),/CERTIFICATION_REQUIRED/);
 const prod={...c,status:'CERTIFIED_FOR_PRODUCTION',projectRef:'ubyjrrsvbbqomitpaidb',schema:'public',fixturePrefix:undefined,
  checks:Object.fromEntries(REQUIRED_CHECKS.map(k=>[k,'PASS']))};
 const productionBinding={...binding,projectRef:prod.projectRef,schema:prod.schema};
 assert.equal(validateCertificate(prod,productionBinding),true);
 for(const patch of [{status:'DRAFT'},{status:'CANDIDATE_FOR_STAGING'},
  {fixturePrefix:'release-fixture-'},{kitchenConfiguration:undefined},{sourceSha256:'b'.repeat(64)}])
  assert.throws(()=>validateCertificate({...prod,...patch},productionBinding),/CERTIFICATION_REQUIRED/);
 for(const key of REQUIRED_CHECKS)
  assert.throws(()=>validateCertificate({...prod,checks:{...prod.checks,[key]:'PENDING'}},productionBinding),/CERTIFICATION_REQUIRED/);
 const certified=createReleaseAssessors({...productionBinding,certificate:prod,model:globalThis.MasterWokModelV1});
 const productionContext=context();productionContext.proposedOrder.rawRow.items[0].qty=4;
 const productionResult=certified.assessBooking(productionContext);
 assert.equal(productionResult.status,'GREEN');
 assert.equal(productionResult.plan.modelVersion,prod.modelVersion);
 assert.equal(productionResult.plan.wok.jobs.length,4);
 assert.ok(productionResult.plan.wok.jobs.every(j=>j.portions===1));
 const ctx=context();ctx.proposedOrder.rawRow.items[0].qty=4;
 const r=assessors(c).assessBooking(ctx);
 assert.equal(r.status,'GREEN');
 assert.equal(r.plan.modelVersion,c.modelVersion);
 assert.equal(r.plan.wok.jobs.length,4);
 assert.ok(r.plan.wok.jobs.every(j=>j.portions===1));
});

test('four-ring staging release rejects a single-wok delivery component',()=>{
 const c={...certificate(),status:'CANDIDATE_FOR_STAGING',fixturePrefix:'release-four-ring-',
  modelVersion:'combined-kitchen-four-ring-staging-v1',kitchenConfiguration:'FOUR_RING_ONE_PORTION_V1',deliveryScheduling:1};
 for(const name of ['driverReservations','combinedTrips','deliveryCheckout','deliveryRollback'])c.checks[name]='PENDING';
 assert.throws(()=>createReleaseAssessors({...binding,certificate:c,model:globalThis.MasterWokModelV1,
  deliveryCapacity:{verify:()=>{},replan:()=>{},kitchenModelVersion:'combined-kitchen-protected-v3'}}),/MODEL_MISMATCH/);
});

test('availability hints, checkout and basket review all retain the full search',async()=>{
 const c={...certificate(),status:'CANDIDATE_FOR_STAGING',fixturePrefix:'release-four-ring-',
  modelVersion:'combined-kitchen-four-ring-staging-v1',kitchenConfiguration:'FOUR_RING_ONE_PORTION_V1',deliveryScheduling:1};
 for(const name of ['driverReservations','combinedTrips','deliveryCheckout','deliveryRollback'])c.checks[name]='PENDING';
 const calls=[];
 const a=createReleaseAssessors({...binding,certificate:c,model:globalThis.MasterWokModelV1,
  deliveryCapacity:{kitchenModelVersion:c.modelVersion,replan:async()=>{},verify:async(ctx,options)=>{
   calls.push(options);return {status:'UNVERIFIED'};
  }}});
 for(const purpose of ['AVAILABILITY_HINT','BASKET_REVIEW',undefined]){
  const result=await a.assessBooking({...context(),assessmentPurpose:purpose});
  assert.equal(result.bookingApprovalAllowed,false);
 }
 assert.deepEqual(calls,[{},{},{}]);
});


test('four-ring production draft cannot initialize a writer or connect to its database',()=>{
 const c=require('./master-wok-release-candidate.four-ring.production.json');
 assert.equal(c.status,'DRAFT');assert.ok(Object.values(c.checks).every(v=>v==='PENDING'));
 assert.throws(()=>createDeploymentRuntime({pool:{connect:async()=>{throw Error('must not connect');}},
  model:globalThis.MasterWokModelV1,certificate:c,releaseId:c.releaseId,sourceSha256:c.sourceSha256,
  projectRef:c.projectRef,deliveryProjectRef:c.deliveryProjectRef,secret:'b'.repeat(64),
  notificationSecret:'c'.repeat(64),deliveryPublicKey:'sb_publishable_fixture'}),/CERTIFICATION_REQUIRED/);
});

test('certified four-ring delivery bootstrap selects the same kitchen model without opening a connection',()=>{
 const draft=require('./master-wok-release-candidate.four-ring.production.json');
 const c={...draft,status:'CERTIFIED_FOR_PRODUCTION',checks:Object.fromEntries(Object.keys(draft.checks).map(k=>[k,'PASS']))};
 assert.doesNotThrow(()=>createDeploymentRuntime({pool:{connect:async()=>{throw Error('must not connect');}},
  model:globalThis.MasterWokModelV1,certificate:c,releaseId:c.releaseId,sourceSha256:c.sourceSha256,
  projectRef:c.projectRef,deliveryProjectRef:c.deliveryProjectRef,secret:'b'.repeat(64),
  notificationSecret:'c'.repeat(64),deliveryPublicKey:'sb_publishable_fixture'}));
});
