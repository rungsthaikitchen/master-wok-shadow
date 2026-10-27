// Isolated integration: trusted verifier stub -> authorization gate -> existing SQL candidate.
// This is not a live endpoint, real JWT test or actor-audit persistence implementation.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {database}=require('./command-route-test-helper.cjs');
const {createAdminAuthorizationGate,PROJECT,ISSUER}=require('./admin-authorization-gate.cjs');
const SUBJECT='12345678-1234-1234-1234-123456789abc';
test('authorization precedes SQL; current-offer reservation transitions stay atomic and idempotent',async()=>{
 const d=await database();const {db,fixture,scalar,call}=d;
 try{
  const f=await fixture();let callbacks=0;
  const gate=createAdminAuthorizationGate({enabled:true,project:PROJECT,allowedSubjects:[SUBJECT],nowSeconds:()=>1000,verifyClaims:async()=>({data:{claims:{sub:SUBJECT,iss:ISSUER,aud:'authenticated',role:'authenticated',exp:2000,is_anonymous:false}},error:null}),onAuthorized:async(req,actor)=>{
   callbacks++;assert.equal(actor.subject,SUBJECT);const body=await req.json();
   // Deliberately fixed fixture route and order; never accept a browser route/actor.
   if(Object.keys(body).some(k=>!['requestId','action','target'].includes(k))||!['offer','confirm','cancel','complete'].includes(body.action))throw Error('COMMAND_FIELDS_REFUSED');
   return call('routed_apply_booking',[f.route,body.requestId,'synthetic-route',body.action,body.target??null,null,null]);
  }});
  const request=(body,authorized=true)=>new Request('https://staging.invalid/admin',{method:'POST',headers:authorized?{Authorization:'Bearer synthetic.signed.token'}:{'x-admin-secret':'fake'},body:JSON.stringify(body)});
  // Separate trusted fixture for the existing proposal-response contract.
  // This does not authenticate a live customer or reuse admin authority.
  const response=body=>call('routed_apply_booking',[f.route,body.requestId,'synthetic-route',body.action,null,body.proposal,f.src]);
  const events=()=>scalar('SELECT event_count FROM master_wok_event_test.streams WHERE id=$1',[f.src]);
  const holds=()=>scalar('SELECT count(*)::int FROM master_wok_event_test.reservations WHERE stream_id=$1',[f.src]);
  assert.equal(await events(),2);await assert.rejects(gate(request({requestId:'b',action:'offer',target:f.day+'T19:30:00Z'},false)),/ADMIN_AUTHORIZATION_REFUSED/);assert.equal(callbacks,0);assert.equal(await events(),2);
  const offer={requestId:'offer-b',action:'offer',target:f.day+'T19:30:00Z'};
  assert.equal(await gate(request(offer)),'RECORDED');assert.equal(await holds(),1);assert.equal(await events(),3);
  assert.equal(await gate(request(offer)),'ALREADY_RECORDED');assert.equal(await events(),3);
  await assert.rejects(gate(request({requestId:'admin-response-forbidden',action:'accept',proposal:'offer-b'})),/COMMAND_FIELDS_REFUSED/);
  await assert.rejects(response({requestId:'stale-accept',action:'accept',proposal:'offer-a'}),/STALE_PROPOSAL_RESPONSE/);assert.equal(await holds(),1);assert.equal(await events(),3);
  const accept={requestId:'accept-b',action:'accept',proposal:'offer-b'};assert.equal(await response(accept),'RECORDED');assert.equal(await holds(),1);assert.equal(await events(),4);assert.equal(await response(accept),'ALREADY_RECORDED');assert.equal(await events(),4);
  assert.equal(await scalar('SELECT commitment FROM master_wok_event_test.reservations WHERE stream_id=$1',[f.src]),'CONFIRMED');
  assert.equal(await gate(request({requestId:'offer-c',action:'offer',target:f.day+'T20:00:00Z'})),'RECORDED');assert.equal(await holds(),1);
  assert.equal(await response({requestId:'reject-c',action:'reject',proposal:'offer-c'}),'RECORDED');assert.equal(await holds(),0);assert.equal(await events(),6);
  await assert.rejects(gate(request({requestId:'injection',action:'confirm',routeId:f.dst})),/COMMAND_FIELDS_REFUSED/);assert.equal(await events(),6);
 }finally{await db.close();}
});
