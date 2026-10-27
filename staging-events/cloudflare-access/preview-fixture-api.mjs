// Pinned real-preview identity; synthetic fixture adapters only, default off.
import {createPreviewAccessGate,PREVIEW_ACCESS} from './preview-access-profile.mjs';
import {readBounded} from './protected-proxy.mjs';
import {fixtureScope,fixtureInput,fixtureResult,previewHmac,previewActor,signPreview} from './preview-fixture-protocol.mjs';
const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export function createPreviewFixtureApi(options={}){
 if(options.enabled!==true)return async()=>reply(503,{error:'STAFF_BROWSER_STAGING_DISABLED'});
 const scope=fixtureScope(options);
 if(options.hopKey===options.actorKey||typeof options.sendEnvelope!=='function')throw Error('PREVIEW_PRIVATE_TRANSPORT_REQUIRED');
 const hop=previewHmac(options.hopKey),actor=previewHmac(options.actorKey);
 const route=operation=>createPreviewAccessGate({enabled:true,nowSeconds:scope.clock,fetcher:options.fetcher,requestPath:operation==='state'?'/admin-api/staff-state-v1':'/admin-api/staff-command-v1',onAuthorized:async(request,identity)=>{
  scope.active();let input;try{input=JSON.parse(await readBounded(request.body,operation==='state'?1024:4096));}catch{throw Error('PREVIEW_INPUT_REQUIRED');}
  input=fixtureInput(scope,operation,input);
  const actorId=await previewActor(actor,[PREVIEW_ACCESS.teamDomain,PREVIEW_ACCESS.audience,identity.subject]);
  const issuedAt=Math.floor(scope.active());if(issuedAt-identity.authorizedAt>=30)throw Error('PREVIEW_IDENTITY_EXPIRED');
  const signed=await signPreview(hop,JSON.stringify({version:1,issuedAt,actorId,operation,input}));
  scope.active();const result=await options.sendEnvelope(signed);scope.active();
  return reply(200,fixtureResult(scope,operation,result));
 }});
 const state=route('state'),command=route('command');
 return async request=>{
  try{
   scope.active();const path=new URL(request.url).pathname;
   if(path==='/admin-api/staff-state-v1')return await state(request);
   if(path==='/admin-api/staff-command-v1')return await command(request);
   return reply(404,{error:'STAGING_ROUTE_NOT_FOUND'});
  }catch(e){
   if(e?.message==='CLOUDFLARE_ACCESS_REFUSED')return reply(403,{error:'STAFF_ACCESS_REFUSED'});
   if(e?.message==='PREVIEW_TRIAL_EXPIRED')return reply(503,{error:'STAFF_BROWSER_STAGING_DISABLED'});
   if(['STAFF_REVISION_CONFLICT','STAFF_COMMAND_ID_REUSED','STALE_PROPOSAL_RESPONSE','TERMINAL_ORDER'].includes(e?.message))return reply(409,{error:e.message});
   if(['PREVIEW_INPUT_REQUIRED','PREVIEW_FIXTURE_REFUSED','STAFF_COMMAND_REQUIRED'].includes(e?.message))return reply(400,{error:'STAFF_COMMAND_REQUIRED'});
   return reply(502,{error:'STAFF_TRANSACTION_FAILED'});
  }
 };
}
