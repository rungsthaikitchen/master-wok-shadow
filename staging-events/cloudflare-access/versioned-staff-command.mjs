// Synthetic-only v1 candidate. Separate contract: never imported by a live route.
import {createAccessAdminGate,PROJECT} from './access-gate.mjs';
import {readBounded} from './protected-proxy.mjs';
import {STAGING_ORIGIN,STAGING_ISSUER} from './staging-pages-action.mjs';
import {validateStaffCommand} from './staff-command-format.mjs';
export {validateStaffCommand} from './staff-command-format.mjs';
const enc=new TextEncoder();
const response=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const fail=code=>{throw Error(code);};
function secret(s){if(typeof s!=='string'||!/^synthetic-[A-Za-z0-9_-]{16,100}$/.test(s))fail('SYNTHETIC_KEY_REQUIRED');return enc.encode(s);}
const hmac=s=>crypto.subtle.importKey('raw',secret(s),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
const hex=b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
export function createSyntheticStaffReceiver(options={}){
 if(options.enabled!==true)return async()=>fail('STAFF_RECEIVER_DISABLED');
 const key=hmac(options.hopKey),clock=options.nowSeconds??(()=>Date.now()/1000);
 if(typeof options.applyCommand!=='function')fail('STAFF_TRANSACTION_REQUIRED');
 return async signed=>{
  if(!signed||Object.keys(signed).sort().join()!=='body,tag'||typeof signed.body!=='string'||enc.encode(signed.body).length>8192||typeof signed.tag!=='string'||!/^[a-f0-9]{64}$/.test(signed.tag))fail('STAFF_ENVELOPE_REFUSED');
  const tag=Uint8Array.from(signed.tag.match(/../g),v=>parseInt(v,16));
  if(!await crypto.subtle.verify('HMAC',await key,tag,enc.encode(signed.body)))fail('STAFF_ENVELOPE_REFUSED');
  let e;try{e=JSON.parse(signed.body);}catch{fail('STAFF_ENVELOPE_REFUSED');}
  const now=clock();
  if(!e||Object.keys(e).sort().join()!=='actorId,command,issuedAt,version'||e.version!==1||typeof e.actorId!=='string'||!/^[a-f0-9]{64}$/.test(e.actorId)||!Number.isSafeInteger(e.issuedAt)||!Number.isFinite(now)||e.issuedAt>now||now-e.issuedAt>=30)fail('STAFF_ENVELOPE_REFUSED');
  return options.applyCommand({actorId:e.actorId,command:validateStaffCommand(e.command)});
 };
}
export function createVersionedStaffHandler(options={}){
 if(options.enabled!==true)return async()=>response(503,{error:'STAFF_COMMAND_DISABLED'});
 const hop=hmac(options.hopKey),actor=hmac(options.actorKey),clock=options.nowSeconds??(()=>Date.now()/1000);
 if(options.hopKey===options.actorKey||typeof options.sendEnvelope!=='function')fail('STAFF_TRANSPORT_REQUIRED');
 const gate=createAccessAdminGate({enabled:true,project:PROJECT,teamDomain:STAGING_ISSUER,requestOrigin:STAGING_ORIGIN,audience:options.audience,requestPath:options.requestPath,nowSeconds:clock,fetcher:options.fetcher,onAuthorized:async(request,identity)=>{
  let c;try{c=validateStaffCommand(JSON.parse(await readBounded(request.body,8192)));}catch{fail('STAFF_COMMAND_REQUIRED');}
  const actorId=hex(await crypto.subtle.sign('HMAC',await actor,enc.encode(JSON.stringify([STAGING_ISSUER,options.audience,identity.subject]))));
  const issuedAt=Math.floor(clock());if(!Number.isSafeInteger(issuedAt)||issuedAt-identity.authorizedAt>=30)fail('STAFF_ENVELOPE_REFUSED');
  const body=JSON.stringify({version:1,issuedAt,actorId,command:c});
  const result=await options.sendEnvelope({body,tag:hex(await crypto.subtle.sign('HMAC',await hop,enc.encode(body)))});
  if(!result||!['RECORDED','ALREADY_RECORDED'].includes(result.status)||!Number.isSafeInteger(result.revision)||result.revision<1)fail('STAFF_TRANSACTION_FAILED');
  return response(200,result);
 }});
 return async request=>{try{return await gate(request);}catch(e){
  const code=e?.message;
  if(code==='CLOUDFLARE_ACCESS_REFUSED')return response(403,{error:'STAFF_ACCESS_REFUSED'});
  if(code==='STAFF_COMMAND_REQUIRED')return response(400,{error:code});
  if(['STAFF_REVISION_CONFLICT','STAFF_COMMAND_ID_REUSED','STALE_PROPOSAL_RESPONSE','TERMINAL_ORDER'].includes(code))return response(409,{error:code});
  return response(502,{error:'STAFF_TRANSACTION_FAILED'});
 }};
}
