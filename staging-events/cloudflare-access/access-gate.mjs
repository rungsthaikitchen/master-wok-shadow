// Offline/default-off candidate. No production or Railway runtime imports this file.
import {createRemoteJWKSet,customFetch,jwtVerify} from 'jose';
export const PROJECT='hvrqgufqjslvgiohgkvu';
const refuse=(code='CLOUDFLARE_ACCESS_REFUSED')=>{throw Error(code);};
function configuration(o){
 if(o.project!==PROJECT||typeof o.onAuthorized!=='function'||typeof o.audience!=='string'||! /^[a-f0-9]{64}$/.test(o.audience))refuse('CLOUDFLARE_ACCESS_CONFIGURATION_REQUIRED');
 let issuer,origin;
 try{issuer=new URL(o.teamDomain);origin=new URL(o.requestOrigin);}catch{refuse('CLOUDFLARE_ACCESS_CONFIGURATION_REQUIRED');}
 if(issuer.protocol!=='https:'||! /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/.test(issuer.hostname)||issuer.port||issuer.username||issuer.password||issuer.pathname!=='/'||issuer.search||issuer.hash||
    origin.protocol!=='https:'||origin.port||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)refuse('CLOUDFLARE_ACCESS_CONFIGURATION_REQUIRED');
 const requestPath=o.requestPath??'/admin-api/order-action';
 if(!['/admin-api/order-action','/admin-api/staff-command-v1','/admin-api/staff-state-v1'].includes(requestPath))refuse('CLOUDFLARE_ACCESS_CONFIGURATION_REQUIRED');
 const clock=o.nowSeconds===undefined?()=>Date.now()/1000:o.nowSeconds;
 const fetcher=o.fetcher===undefined?globalThis.fetch:o.fetcher;
 if(typeof clock!=='function'||typeof fetcher!=='function')refuse('CLOUDFLARE_ACCESS_CONFIGURATION_REQUIRED');
 return {issuer:issuer.origin,origin:origin.origin,audience:o.audience,requestPath,clock,fetcher,onAuthorized:o.onAuthorized};
}
export function createAccessAdminGate(options={}){
 if(options.enabled!==true)return async()=>({status:'DISABLED',sourceRequests:0,verified:false});
 const c=configuration(options);
 const fetcher=c.fetcher; // Native Workers fetch must be invoked without an object receiver.
 // The destination comes only from fixed server configuration, never iss/jku/x5u
 // in an untrusted JWT. No redirect or browser credentials on key requests.
 const jwks=createRemoteJWKSet(new URL(c.issuer+'/cdn-cgi/access/certs'),{
  timeoutDuration:5000,cooldownDuration:30000,cacheMaxAge:300000,
  [customFetch]:(url,init)=>fetcher(url,{...init,redirect:'manual',credentials:'omit'})
 });
 function now(){const n=c.clock();if(!Number.isFinite(n)||n<0)refuse();return n;}
 return async request=>{
  let token;
  try{
   const u=new URL(request.url);
   if(request.method!=='POST'||u.origin!==c.origin||u.pathname!==c.requestPath||u.search||u.hash||
      request.headers.get('origin')!==c.origin||request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')refuse();
   token=request.headers.get('cf-access-jwt-assertion');
   if(typeof token!=='string'||token.length>8192||! /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))refuse();
  }catch{refuse();}
  let p,at;
  try{
   const r=await jwtVerify(token,jwks,{issuer:c.issuer,audience:c.audience,algorithms:['RS256'],requiredClaims:['iss','aud','exp','iat','nbf','sub','type'],currentDate:new Date(now()*1000),clockTolerance:0});
   p=r.payload;at=now();
   if(p.type!=='app'||typeof p.sub!=='string'||! /^[A-Za-z0-9_-]{1,200}$/.test(p.sub)||
      Object.hasOwn(p,'common_name')||Object.hasOwn(p,'service_token_id')||p.service_token_status===true||
      !Array.isArray(p.aud)||p.aud.length!==1||p.aud[0]!==c.audience||
      ![p.exp,p.iat,p.nbf].every(Number.isSafeInteger)||p.exp<=at||p.iat>at||p.nbf>at)refuse();
  }catch{refuse();}
  // Access application policy is the authority for allowed human identities.
  // Preserve its configured issuer/AUD binding; do not copy email/IP/cookie/JWT.
  const actor=Object.freeze({subject:p.sub,source:'VERIFIED_CLOUDFLARE_ACCESS',authorizedAt:at});
  return c.onAuthorized(request,actor);
 };
}
