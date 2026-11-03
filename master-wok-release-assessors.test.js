'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createReleaseAssessors,validateCertificate,REQUIRED_CHECKS}=require('./master-wok-release-assessors');
const {createDeploymentRuntime}=require('./master-wok-deployment');
const {assessCombinedBooking}=require('./master-wok-combined-assessment');
const draft=require('./master-wok-release-candidate.json');
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
test('committed draft cannot initialize a production booking runtime',()=>{
 assert.equal(draft.status,'DRAFT');
 assert.throws(()=>createDeploymentRuntime({pool:{connect:async()=>{throw Error('must not connect');}},model:globalThis.MasterWokModelV1,
  certificate:draft,releaseId:draft.releaseId,projectRef:draft.projectRef,sourceSha256:'a'.repeat(64),
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
