// Read-only identity check. No database, booking transport or provider code.
import {createRemoteJWKSet,customFetch,jwtVerify} from 'jose';
const SCOPE='ACCESS_READ_ONLY_PROBE';
function reply(status,state){return new Response(JSON.stringify({status:state,scope:SCOPE,bookingRequests:0,databaseRequests:0,notifications:0}),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});}
export function createReadProbe(options={}){
 if(options.enabled!==true)return async()=>reply(503,'DISABLED');
 const {teamDomain,audience,requestOrigin,endEpoch}=options;
 const clock=options.nowSeconds===undefined?()=>Date.now()/1000:options.nowSeconds;
 const fetcher=options.fetcher===undefined?globalThis.fetch:options.fetcher;
 let issuer,origin;
 try{issuer=new URL(teamDomain);origin=new URL(requestOrigin);}catch{throw Error('ACCESS_PROBE_CONFIGURATION_REQUIRED');}
 if(typeof audience!=='string'||! /^[a-f0-9]{64}$/.test(audience)||issuer.protocol!=='https:'||! /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/.test(issuer.hostname)||issuer.port||issuer.username||issuer.password||issuer.pathname!=='/'||issuer.search||issuer.hash||origin.protocol!=='https:'||origin.port||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash||typeof clock!=='function'||typeof fetcher!=='function'||!Number.isSafeInteger(endEpoch))throw Error('ACCESS_PROBE_CONFIGURATION_REQUIRED');
 const initial=clock();if(!Number.isFinite(initial)||endEpoch>initial+7200)throw Error('ACCESS_PROBE_DEADLINE_REFUSED');
 const jwks=createRemoteJWKSet(new URL(issuer.origin+'/cdn-cgi/access/certs'),{timeoutDuration:5000,cooldownDuration:30000,cacheMaxAge:300000,[customFetch]:(url,init)=>fetcher(url,{...init,redirect:'error',credentials:'omit'})});
 return async request=>{
  try{
   const at=clock();if(!Number.isFinite(at)||at>=endEpoch)return reply(410,'EXPIRED');
   const u=new URL(request.url);
   if(u.origin!==origin.origin||u.pathname!=='/admin-api/access-check'||u.search||u.hash)return reply(403,'REFUSED');
   if(request.method!=='GET')return reply(405,'GET_REQUIRED');
   const token=request.headers.get('cf-access-jwt-assertion');
   if(typeof token!=='string'||token.length>8192||! /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))return reply(403,'MISSING_OR_INVALID_ASSERTION');
   const {payload:p}=await jwtVerify(token,jwks,{issuer:issuer.origin,audience,algorithms:['RS256'],requiredClaims:['iss','aud','exp','iat','nbf','sub','type'],currentDate:new Date(at*1000),clockTolerance:0});
   const after=clock();if(!Number.isFinite(after)||after>=endEpoch)return reply(410,'EXPIRED');
   if(p.type!=='app'||typeof p.sub!=='string'||! /^[A-Za-z0-9_-]{1,200}$/.test(p.sub)||Object.hasOwn(p,'common_name')||Object.hasOwn(p,'service_token_id')||p.service_token_status===true||!Array.isArray(p.aud)||p.aud.length!==1||p.aud[0]!==audience||![p.exp,p.iat,p.nbf].every(Number.isSafeInteger)||p.exp<=after||p.iat>after||p.nbf>after)return reply(403,'REFUSED');
   return reply(200,'VERIFIED');
  }catch{return reply(403,'REFUSED');}
 };
}
