// Private synthetic browser rehearsal API. No production transport or database credentials.
import {createAccessAdminGate,PROJECT} from './access-gate.mjs';
import {createVersionedStaffHandler} from './versioned-staff-command.mjs';
import {readBounded} from './protected-proxy.mjs';
import {STAGING_ORIGIN,STAGING_ISSUER} from './staging-pages-action.mjs';
const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const statuses=['pending','proposed','confirmed','customer_accepted_time','customer_declined_time','cancelled','completed'];
const utc=t=>typeof t==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(t)&&Number.isFinite(Date.parse(t))&&new Date(t).toISOString().replace('.000Z','Z')===t;
export function createStagingBrowserApi(options={}){
 if(options.enabled!==true)return async()=>reply(503,{error:'STAFF_BROWSER_STAGING_DISABLED'});
 if(typeof options.readState!=='function')throw Error('STAGING_STATE_READER_REQUIRED');
 const commands=createVersionedStaffHandler({...options,requestPath:'/admin-api/staff-command-v1'});
 const state=createAccessAdminGate({enabled:true,project:PROJECT,teamDomain:STAGING_ISSUER,requestOrigin:STAGING_ORIGIN,audience:options.audience,nowSeconds:options.nowSeconds,fetcher:options.fetcher,requestPath:'/admin-api/staff-state-v1',onAuthorized:async request=>{
  let input;try{input=JSON.parse(await readBounded(request.body,1024));}catch{return reply(400,{error:'STAFF_STATE_REQUEST_REQUIRED'});}
  if(!input||Object.keys(input).join()!=='orderId'||typeof input.orderId!=='string'||!uuid.test(input.orderId))return reply(400,{error:'STAFF_STATE_REQUEST_REQUIRED'});
  const s=await options.readState(input.orderId);
  if(!s||Object.keys(s).sort().join()!=='orderId,proposalTargets,revision,status,target'||s.orderId!==input.orderId||!Number.isSafeInteger(s.revision)||s.revision<1||!statuses.includes(s.status)||!utc(s.target)||!Array.isArray(s.proposalTargets)||s.proposalTargets.length>8||!s.proposalTargets.every(utc))throw Error('STAGING_STATE_UNVERIFIED');
  return reply(200,s);
 }});
 return async request=>{
  try{const p=new URL(request.url).pathname;if(p==='/admin-api/staff-command-v1')return await commands(request);if(p==='/admin-api/staff-state-v1')return await state(request);return reply(404,{error:'STAGING_ROUTE_NOT_FOUND'});}
  catch(e){return reply(e?.message==='CLOUDFLARE_ACCESS_REFUSED'?403:502,{error:e?.message==='CLOUDFLARE_ACCESS_REFUSED'?'STAFF_ACCESS_REFUSED':'STAGING_STATE_UNVERIFIED'});}
 };
}
