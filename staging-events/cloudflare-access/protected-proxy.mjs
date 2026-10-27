// Staging-only HTTP adapter candidate. No live file imports it; no destination
// or secret is embedded. forwardAction is a trusted server-side dependency.
import {createAccessAdminGate} from './access-gate.mjs';
const json=(status,error)=>new Response(JSON.stringify({error}),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
class Refusal extends Error{constructor(code,status){super(code);this.status=status;}}
async function readBounded(body,maximum){
 if(!body)return '';
 const reader=body.getReader(),chunks=[];let length=0;
 try{
  while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>maximum)throw new Refusal('ADMIN_PROXY_BODY_TOO_LARGE',413);chunks.push(value);}
 }catch(e){reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}
 const bytes=new Uint8Array(length);let offset=0;for(const b of chunks){bytes.set(b,offset);offset+=b.byteLength;}
 try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new Refusal('ADMIN_PROXY_JSON_REQUIRED',400);}
}
function actionPayload(v){
 if(!v||typeof v!=='object'||Array.isArray(v)||typeof v.orderId!=='string'||!UUID.test(v.orderId))throw new Refusal('ADMIN_PROXY_COMMAND_REQUIRED',400);
 const shapes={accept:['action','orderId'],decline:['action','orderId','reason'],suggest_time:['action','orderId','proposedTime'],mark_paid:['action','orderId'],complete:['action','orderId']};
 const fields=typeof v.action==='string'&&Object.hasOwn(shapes,v.action)?shapes[v.action]:null;
 if(!fields||Object.keys(v).sort().join(',')!==[...fields].sort().join(','))throw new Refusal('ADMIN_PROXY_COMMAND_REQUIRED',400);
 if(v.action==='decline'&&(typeof v.reason!=='string'||!v.reason.length||v.reason.length>2000))throw new Refusal('ADMIN_PROXY_COMMAND_REQUIRED',400);
 if(v.action==='suggest_time'){
  const t=v.proposedTime;
  if(typeof t!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.test(t)||!Number.isFinite(Date.parse(t)))throw new Refusal('ADMIN_PROXY_COMMAND_REQUIRED',400);
  const date=new Date(t.slice(0,19)+'Z');if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,19)!==t.slice(0,19))throw new Refusal('ADMIN_PROXY_COMMAND_REQUIRED',400);
 }
 return v;
}
export function createProtectedActionProxy(options={}){
 if(options.enabled!==true)return async()=>json(503,'ADMIN_PROXY_DISABLED');
 const forwardAction=options.forwardAction;
 if(typeof forwardAction!=='function')throw Error('ADMIN_PROXY_FORWARDER_REQUIRED');
 const gate=createAccessAdminGate({...options,onAuthorized:async request=>{
  let body;try{body=JSON.parse(await readBounded(request.body,65536));}catch(e){if(e instanceof Refusal)throw e;throw new Refusal('ADMIN_PROXY_JSON_REQUIRED',400);}
  const payload=actionPayload(body);
  // Only the canonical action payload reaches the existing service-hop adapter.
  // No request headers, Access JWT, cookies, private actor, URL or body identity.
  let upstream;try{upstream=await forwardAction(payload);}catch{throw new Refusal('ADMIN_PROXY_UPSTREAM_FAILED',502);}
  if(!(upstream instanceof Response)||upstream.status<200||upstream.status>=300&&upstream.status<400)throw new Refusal('ADMIN_PROXY_UPSTREAM_FAILED',502);
  let responseBody;try{responseBody=await readBounded(upstream.body,131072);}catch{throw new Refusal('ADMIN_PROXY_UPSTREAM_FAILED',502);}
  return new Response(upstream.status===204||upstream.status===205?null:responseBody,{status:upstream.status,headers:{'Content-Type':upstream.headers.get('Content-Type')||'application/json','Cache-Control':'no-store'}});
 }});
 return async request=>{
  try{return await gate(request);}catch(e){
   if(e instanceof Refusal)return json(e.status,e.message);
   return json(e?.message==='CLOUDFLARE_ACCESS_REFUSED'?403:502,e?.message==='CLOUDFLARE_ACCESS_REFUSED'?'ADMIN_PROXY_ACCESS_REFUSED':'ADMIN_PROXY_FAILED');
  }
 };
}
