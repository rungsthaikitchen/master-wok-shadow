// OFFLINE/default-off staging candidate. Not imported by any live or trial route.
// verifyClaims MUST call a server-side cryptographic verifier (e.g. getClaims).
// A decoded token or browser-provided claims object is not a verifier.
const PROJECT='hvrqgufqjslvgiohgkvu';
const ISSUER='https://'+PROJECT+'.supabase.co/auth/v1';
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
function refuse(code='ADMIN_AUTHORIZATION_REFUSED'){throw Error(code);}
function createAdminAuthorizationGate(options={}){
 if(options.enabled!==true)return async()=>({status:'DISABLED',sourceRequests:0,verified:false});
 const {project,verifyClaims,onAuthorized,allowedSubjects}=options;
 if(project!==PROJECT||typeof verifyClaims!=='function'||typeof onAuthorized!=='function'||!Array.isArray(allowedSubjects)||!allowedSubjects.length||allowedSubjects.some(x=>!uuid(x)))refuse('ADMIN_AUTH_CONFIGURATION_REQUIRED');
 // Copy server configuration so later caller mutation cannot grant an identity.
 const allowed=new Set(allowedSubjects.map(x=>x.toLowerCase()));
 const clock=options.nowSeconds===undefined?(()=>Date.now()/1000):options.nowSeconds;
 if(typeof clock!=='function')refuse('ADMIN_AUTH_CONFIGURATION_REQUIRED');
 return async request=>{
  // No preflight/GET request is a mutation. An outer HTTP layer handles CORS.
  if(!request||request.method!=='POST')refuse();
  let token;
  try{
   const value=request.headers.get('authorization');
   if(typeof value!=='string'||value.length>8192||!/^Bearer [A-Za-z0-9._~+/-]+=*$/.test(value))refuse();
   token=value.slice(7);
  }catch{refuse();}
  let result;
  try{result=await verifyClaims(token);}catch{refuse();}
  // Validate verified claims, never user_metadata or the request body.
  const c=result?.data?.claims;let now;
  try{now=clock();}catch{refuse();}
  if(result?.error!==null||!c||typeof c!=='object'||Array.isArray(c)||!Number.isFinite(now)||
     c.iss!==ISSUER||c.aud!=='authenticated'||c.role!=='authenticated'||c.is_anonymous!==false||
     !uuid(c.sub)||!allowed.has(c.sub.toLowerCase())||!Number.isSafeInteger(c.exp)||c.exp<=now||
     (c.nbf!==undefined&&(!Number.isSafeInteger(c.nbf)||c.nbf>now))||
     (c.iat!==undefined&&(!Number.isSafeInteger(c.iat)||c.iat>now)))refuse();
  // Token, email, metadata and claims are not forwarded to the command handler.
  const actor=Object.freeze({subject:c.sub.toLowerCase(),source:'VERIFIED_STAGING_ADMIN',authorizedAt:now});
  return onAuthorized(request,actor);
 };
}
module.exports={createAdminAuthorizationGate,PROJECT,ISSUER};
