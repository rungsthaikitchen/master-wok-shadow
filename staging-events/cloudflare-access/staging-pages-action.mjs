// Rehearsal adapter only. Fixed .invalid destinations cannot target live services.
import {createProtectedActionProxy} from './protected-proxy.mjs';
import {PROJECT} from './access-gate.mjs';
export const STAGING_ORIGIN='https://synthetic-admin.invalid';
export const STAGING_ISSUER='https://synthetic-team.cloudflareaccess.com';
export const STAGING_DESTINATION='https://synthetic-railway.invalid/admin-order-action';
export function createStagingPagesAction(options={}){
 if(options.enabled!==true)return createProtectedActionProxy();
 const {serviceSecret,fetcher=globalThis.fetch,audience,nowSeconds}=options;
 if(typeof serviceSecret!=='string'||!/^synthetic-[A-Za-z0-9_-]{16,100}$/.test(serviceSecret)||typeof fetcher!=='function')throw Error('SYNTHETIC_SERVICE_CONFIGURATION_REQUIRED');
 return createProtectedActionProxy({enabled:true,project:PROJECT,teamDomain:STAGING_ISSUER,requestOrigin:STAGING_ORIGIN,audience,nowSeconds,fetcher,
  forwardAction:payload=>fetcher(STAGING_DESTINATION,{
   method:'POST',redirect:'manual',credentials:'omit',signal:AbortSignal.timeout(5000),
   headers:{'Content-Type':'application/json','x-rtk-proxy-secret':serviceSecret},body:JSON.stringify(payload)
  })
 });
}
