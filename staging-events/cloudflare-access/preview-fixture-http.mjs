// Server-supplied endpoint, fixed at build time. No browser-selected URL or retry.
import {readBounded} from './protected-proxy.mjs';
const conflicts=['STAFF_REVISION_CONFLICT','STAFF_COMMAND_ID_REUSED','STALE_PROPOSAL_RESPONSE','TERMINAL_ORDER'];
export function previewEndpoint(value){
 let u;try{u=new URL(value);}catch{throw Error('PREVIEW_ENDPOINT_REQUIRED');}
 if(u.protocol!=='https:'||! /^[a-z0-9][a-z0-9-]*\.up\.railway\.app$/.test(u.hostname)||u.port||u.username||u.password||u.pathname!=='/staging/preview-fixture-v1'||u.search||u.hash)throw Error('PREVIEW_ENDPOINT_REQUIRED');
 return u.href;
}
export function createPreviewFixtureHttp(options={}){
 if(options.enabled!==true)return async()=>{throw Error('PREVIEW_TRANSPORT_DISABLED');};
 const endpoint=previewEndpoint(options.endpoint),fetcher=options.fetcher??globalThis.fetch;
 if(typeof fetcher!=='function')throw Error('PREVIEW_TRANSPORT_REQUIRED');
 return async signed=>{
  const r=await fetcher(endpoint,{method:'POST',redirect:'manual',credentials:'omit',signal:AbortSignal.timeout(5000),headers:{'Content-Type':'application/json'},body:JSON.stringify(signed)});
  if(![200,409].includes(r.status)||r.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')throw Error('PREVIEW_TRANSPORT_FAILED');
  let result;try{result=JSON.parse(await readBounded(r.body,8192));}catch{throw Error('PREVIEW_TRANSPORT_FAILED');}
  if(r.status===409){if(result&&Object.keys(result).join()==='error'&&conflicts.includes(result.error))throw Error(result.error);throw Error('PREVIEW_TRANSPORT_FAILED');}
  return result;
 };
}
