// Read-only identity check. No database, booking transport or provider code.
import {createRemoteJWKSet,customFetch,jwtVerify} from 'jose';
const SCOPE='ACCESS_READ_ONLY_PROBE';
function reply(status,state,reasonCode){return new Response(JSON.stringify({status:state,scope:SCOPE,bookingRequests:0,databaseRequests:0,notifications:0,...(reasonCode?{reasonCode}:{})}),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});}
const claims=new Set(['iss','aud','exp','iat','nbf','sub','type']);
function diagnostic(e){
 if(e?.code==='ACCESS_PROBE_KEY_FETCH_FAILED')return 'KEY_FETCH_FAILED';
 if(e?.code==='ERR_JWKS_TIMEOUT')return 'KEY_FETCH_TIMEOUT';
 if(['ERR_JWKS_INVALID','ERR_JWKS_NO_MATCHING_KEY','ERR_JWKS_MULTIPLE_MATCHING_KEYS'].includes(e?.code))return 'SIGNING_KEY_UNAVAILABLE';
 if(e?.code==='ERR_JWT_EXPIRED')return 'TOKEN_EXPIRED';
 if(e?.code==='ERR_JWT_CLAIM_VALIDATION_FAILED'){
  if(e.reason==='missing'&&claims.has(e.claim))return 'MISSING_'+e.claim.toUpperCase()+'_CLAIM';
  if(e.claim==='iss')return 'ISSUER_MISMATCH';
  if(e.claim==='aud')return 'APPLICATION_AUD_MISMATCH';
  if(e.claim==='nbf')return 'TOKEN_NOT_YET_VALID';
  return 'TOKEN_CLAIM_REFUSED';
 }
 if(['ERR_JWS_SIGNATURE_VERIFICATION_FAILED','ERR_JOSE_ALG_NOT_ALLOWED','ERR_JWS_INVALID','ERR_JWT_INVALID'].includes(e?.code))return 'SIGNATURE_OR_FORMAT_REFUSED';
 return 'VERIFIER_RUNTIME_ERROR';
}
export function createReadProbe(options={}){
 if(options.enabled!==true)return async()=>reply(503,'DISABLED');
 const {teamDomain,audience,requestOrigin,endEpoch}=options;
 const clock=options.nowSeconds===undefined?()=>Date.now()/1000:options.nowSeconds;
 const fetcher=options.fetcher===undefined?globalThis.fetch:options.fetcher;
 let issuer,origin;
 try{issuer=new URL(teamDomain);origin=new URL(requestOrigin);}catch{throw Error('ACCESS_PROBE_CONFIGURATION_REQUIRED');}
 if(typeof audience!=='string'||! /^[a-f0-9]{64}$/.test(audience)||issuer.protocol!=='https:'||! /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/.test(issuer.hostname)||issuer.port||issuer.username||issuer.password||issuer.pathname!=='/'||issuer.search||issuer.hash||origin.protocol!=='https:'||origin.port||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash||typeof clock!=='function'||typeof fetcher!=='function'||!Number.isSafeInteger(endEpoch))throw Error('ACCESS_PROBE_CONFIGURATION_REQUIRED');
 const initial=clock();if(!Number.isFinite(initial)||endEpoch>initial+7200)throw Error('ACCESS_PROBE_DEADLINE_REFUSED');
 const jwks=createRemoteJWKSet(new URL(issuer.origin+'/cdn-cgi/access/certs'),{timeoutDuration:5000,cooldownDuration:30000,cacheMaxAge:300000,[customFetch]:async(url,init)=>{try{const r=await fetcher(url,{...init,redirect:'manual',credentials:'omit'});if(r.status!==200)throw Error();return r;}catch{const e=Error('ACCESS_PROBE_KEY_FETCH_FAILED');e.code='ACCESS_PROBE_KEY_FETCH_FAILED';throw e;}}});
 return async request=>{
  try{
   const at=clock();if(!Number.isFinite(at)||at>=endEpoch)return reply(410,'EXPIRED');
   const u=new URL(request.url);
   if(u.origin!==origin.origin||u.pathname!=='/admin-api/access-check'||u.search||u.hash)return reply(403,'REFUSED','REQUEST_BINDING_MISMATCH');
   if(request.method!=='GET')return reply(405,'GET_REQUIRED');
   const token=request.headers.get('cf-access-jwt-assertion');
   if(typeof token!=='string'||token.length>8192||! /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))return reply(403,'MISSING_OR_INVALID_ASSERTION');
   const {payload:p}=await jwtVerify(token,jwks,{issuer:issuer.origin,audience,algorithms:['RS256'],requiredClaims:['iss','aud','exp','iat','nbf','sub','type'],currentDate:new Date(at*1000),clockTolerance:0});
   const after=clock();if(!Number.isFinite(after)||after>=endEpoch)return reply(410,'EXPIRED');
   if(p.type!=='app')return reply(403,'REFUSED','APPLICATION_TOKEN_REQUIRED');
   if(typeof p.sub!=='string'||! /^[A-Za-z0-9_-]{1,200}$/.test(p.sub)||Object.hasOwn(p,'common_name')||Object.hasOwn(p,'service_token_id')||p.service_token_status===true)return reply(403,'REFUSED','HUMAN_IDENTITY_REQUIRED');
   if(!Array.isArray(p.aud)||p.aud.length!==1||p.aud[0]!==audience)return reply(403,'REFUSED','APPLICATION_AUD_SHAPE_REFUSED');
   if(![p.exp,p.iat,p.nbf].every(Number.isSafeInteger)||p.exp<=after||p.iat>after||p.nbf>after)return reply(403,'REFUSED','TIME_CLAIMS_REFUSED');
   return reply(200,'VERIFIED');
  }catch(e){return reply(403,'REFUSED',diagnostic(e));}
 };
}
