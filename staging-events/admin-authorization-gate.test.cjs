const {test}=require('node:test'),assert=require('node:assert/strict');
const {createAdminAuthorizationGate,PROJECT,ISSUER}=require('./admin-authorization-gate.cjs');
const A='12345678-1234-1234-1234-123456789abc',B='abcdefab-1234-1234-1234-abcdefabcdef';
const claims=()=>({sub:A,iss:ISSUER,aud:'authenticated',role:'authenticated',exp:2000,iat:900,is_anonymous:false});
const request=(headers={Authorization:'Bearer synthetic.signed.token'},method='POST')=>new Request('https://staging.invalid/admin',{method,headers});
function setup({c=claims(),verify,onAuthorized,nowSeconds=()=>1000,subjects=[A]}={}){
 const seen=[];let verifications=0;
 const gate=createAdminAuthorizationGate({enabled:true,project:PROJECT,allowedSubjects:subjects,nowSeconds,verifyClaims:verify|| (async token=>{verifications++;assert.equal(token,'synthetic.signed.token');return {data:{claims:c},error:null};}),onAuthorized:onAuthorized|| (async(req,actor)=>{seen.push(actor);return {status:'STAGING_CALLBACK_REACHED'};})});
 return {gate,seen,count:()=>verifications};
}
test('disabled gate touches no credentials, config, request or handler',async()=>{
 const gate=createAdminAuthorizationGate({get verifyClaims(){throw Error('read');}});
 assert.equal((await gate({get method(){throw Error('read');}})).sourceRequests,0);
});
test('enabled gate requires staging project, verifier, explicit subject allowlist and callback',()=>{
 const base={enabled:true,project:PROJECT,verifyClaims:async()=>{},allowedSubjects:[A],onAuthorized:()=>{}};
 for(const extra of [{project:'ubyjrrsvbbqomitpaidb'},{verifyClaims:null},{allowedSubjects:[]},{allowedSubjects:['email@example.invalid']},{onAuthorized:null}])assert.throws(()=>createAdminAuthorizationGate({...base,...extra}),/^Error: ADMIN_AUTH_CONFIGURATION_REQUIRED$/);
});
test('only verified allowlisted subject reaches callback; private claims and bearer do not',async()=>{
 const c={...claims(),email:'SYNTHETIC_PRIVATE',user_metadata:{admin:true},app_metadata:{unrelated:'PRIVATE'}};const {gate,seen}=setup({c});
 assert.equal((await gate(request())).status,'STAGING_CALLBACK_REACHED');assert.deepEqual(seen,[{subject:A,source:'VERIFIED_STAGING_ADMIN',authorizedAt:1000}]);assert.ok(Object.isFrozen(seen[0]));
 assert.equal(JSON.stringify(seen).includes('PRIVATE'),false);assert.equal(JSON.stringify(seen).includes('token'),false);
});
test('missing/malformed bearer, shared secrets, cookies and origin do not authorize or invoke verification',async()=>{
 const s=setup();for(const h of [{},{'x-admin-secret':'synthetic-secret'},{Cookie:'admin=true',Origin:'https://trusted.invalid'},{Authorization:'Basic dXNlcjpwYXNz'},{Authorization:'Bearer a b'},{Authorization:'Bearer '+ 'a'.repeat(8200)}])await assert.rejects(s.gate(request(h)),/^Error: ADMIN_AUTHORIZATION_REFUSED$/);
 assert.equal(s.count(),0);assert.equal(s.seen.length,0);
});
test('GET/OPTIONS never authorize or consume token verification',async()=>{
 const s=setup();for(const method of ['GET','OPTIONS'])await assert.rejects(s.gate(request(undefined,method)),/^Error: ADMIN_AUTHORIZATION_REFUSED$/);assert.equal(s.count(),0);
});
test('verifier errors/refusal/missing claims never reach mutation and private errors are sanitized',async()=>{
 for(const verify of [async()=>{throw Error('PRIVATE key');},async()=>({data:null,error:{message:'PRIVATE'}}),async()=>({data:{claims:claims()}}),async()=>({data:{claims:null},error:null})]){
  const s=setup({verify});await assert.rejects(s.gate(request()),/^Error: ADMIN_AUTHORIZATION_REFUSED$/);assert.equal(s.seen.length,0);
 }
});
test('claims require correct issuer, audience, role, expiry, nonanonymous identity and configured subject',async()=>{
 for(const delta of [{sub:B},{sub:null},{iss:'https://ubyjrrsvbbqomitpaidb.supabase.co/auth/v1'},{aud:'anon'},{aud:['authenticated','admin']},{role:'service_role'},{is_anonymous:true},{is_anonymous:undefined},{exp:1000},{exp:'2000'},{exp:Infinity},{nbf:1001},{iat:1001}]){
  const s=setup({c:{...claims(),...delta}});await assert.rejects(s.gate(request()),/^Error: ADMIN_AUTHORIZATION_REFUSED$/);assert.equal(s.seen.length,0);
 }
});
test('email and user-editable metadata cannot grant authority to an unapproved subject',async()=>{
 const s=setup({c:{...claims(),sub:B,email:'configured-admin@example.invalid',user_metadata:{admin:true,role:'admin'},app_metadata:{role:'admin'}}});await assert.rejects(s.gate(request()));assert.equal(s.seen.length,0);
});
test('allowlist is copied; expiry is checked after asynchronous verifier completes',async()=>{
 const subjects=[A],c=claims();const s=setup({subjects,c});assert.equal((await s.gate(request())).status,'STAGING_CALLBACK_REACHED');subjects.push(B);c.sub=B;await assert.rejects(s.gate(request()));assert.equal(s.seen.length,1);
 let now=1000;const expired=setup({nowSeconds:()=>now,verify:async()=>{now=2000;return {data:{claims:claims()},error:null};}});await assert.rejects(expired.gate(request()));assert.equal(expired.seen.length,0);
});
test('forged identity/body cannot bypass gate and unauthorized body is never read',async()=>{
 const s=setup();const req={method:'POST',headers:new Headers(),get json(){throw Error('private body read');},actor:{subject:A},authorized:true};await assert.rejects(s.gate(req));assert.equal(s.seen.length,0);
});
test('valid identity does not imply command validity or committed receipt',async()=>{
 const s=setup({onAuthorized:async()=>{throw Error('COMMAND_REVISION_REFUSED');}});await assert.rejects(s.gate(request()),/COMMAND_REVISION_REFUSED/);
});
