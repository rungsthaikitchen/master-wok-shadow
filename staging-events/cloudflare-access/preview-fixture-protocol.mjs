// Server-only, bounded synthetic fixture protocol. No database/network implementation.
import {validateStaffCommand} from './staff-command-format.mjs';
const enc=new TextEncoder(),uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const hex=b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
const fail=()=>{throw Error('PREVIEW_FIXTURE_REFUSED');};
export function fixtureScope(options){
 const clock=options.nowSeconds??(()=>Date.now()/1000),end=options.endEpoch,f=options.fixture;
 const utc=t=>typeof t==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(t)&&Number.isFinite(Date.parse(t))&&new Date(t).toISOString().replace('.000Z','Z')===t;
 if(typeof clock!=='function'||!Number.isSafeInteger(end)||!f||Object.keys(f).sort().join()!=='orderId,targets'||!uuid.test(f.orderId)||!Array.isArray(f.targets)||f.targets.length<1||f.targets.length>8||!f.targets.every(utc)||new Set(f.targets).size!==f.targets.length)fail();
 const now=clock();if(!Number.isFinite(now)||!(now<end&&end<=now+600))fail();
 const orderId=f.orderId,targets=Object.freeze([...f.targets]);
 return Object.freeze({orderId,targets,clock,active(){const n=clock();if(!Number.isFinite(n)||n>=end)throw Error('PREVIEW_TRIAL_EXPIRED');return n;}});
}
export function previewHmac(value){
 if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))throw Error('PREVIEW_SERVER_KEY_REQUIRED');
 return crypto.subtle.importKey('raw',Uint8Array.from(value.match(/../g),x=>parseInt(x,16)),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
}
export async function signPreview(key,body){return {body,tag:hex(await crypto.subtle.sign('HMAC',await key,enc.encode(body)))};}
export async function previewActor(key,binding){return hex(await crypto.subtle.sign('HMAC',await key,enc.encode(JSON.stringify(binding))));}
export function fixtureInput(scope,operation,input){
 if(operation==='command'){
  const c=validateStaffCommand(input);if(c.orderId!==scope.orderId||(c.action==='offer'&&!scope.targets.includes(c.target)))fail();return c;
 }
 if(operation!=='state'||!input||Object.keys(input).join()!=='orderId'||input.orderId!==scope.orderId)fail();return input;
}
export function fixtureResult(scope,operation,r){
 if(operation==='command'){
  if(!r||Object.keys(r).sort().join()!=='revision,status'||!['RECORDED','ALREADY_RECORDED'].includes(r.status)||!Number.isSafeInteger(r.revision)||r.revision<1)fail();
 }else{
  if(!r||Object.keys(r).sort().join()!=='orderId,proposalTargets,revision,status,target'||r.orderId!==scope.orderId||!Number.isSafeInteger(r.revision)||r.revision<1||!['pending','proposed','confirmed','customer_accepted_time','customer_declined_time','cancelled','completed'].includes(r.status)||!scope.targets.includes(r.target)||!Array.isArray(r.proposalTargets)||r.proposalTargets.length>8||!r.proposalTargets.every(t=>scope.targets.includes(t))||new Set(r.proposalTargets).size!==r.proposalTargets.length)fail();
 }
 return r;
}
export function createPreviewFixtureReceiver(options={}){
 if(options.enabled!==true)return async()=>{throw Error('PREVIEW_RECEIVER_DISABLED');};
 const scope=fixtureScope(options);
 if(typeof options.takeBudget!=='function'||typeof options.readState!=='function'||typeof options.applyCommand!=='function')throw Error('PREVIEW_PERSISTENT_ADAPTER_REQUIRED');
 // Import synchronously validates key format; import result is a promise.
 const key=previewHmac(options.hopKey);
 return async signed=>{
  scope.active();
  if(!signed||Object.keys(signed).sort().join()!=='body,tag'||typeof signed.body!=='string'||enc.encode(signed.body).length>8192||typeof signed.tag!=='string'||!/^[a-f0-9]{64}$/.test(signed.tag))fail();
  if(!await crypto.subtle.verify('HMAC',await key,Uint8Array.from(signed.tag.match(/../g),x=>parseInt(x,16)),enc.encode(signed.body)))fail();
  let e;try{e=JSON.parse(signed.body);}catch{fail();}
  const now=scope.active();
  if(!e||Object.keys(e).sort().join()!=='actorId,input,issuedAt,operation,version'||e.version!==1||typeof e.actorId!=='string'||!/^[a-f0-9]{64}$/.test(e.actorId)||!Number.isSafeInteger(e.issuedAt)||e.issuedAt>now||now-e.issuedAt>=30)fail();
  const input=fixtureInput(scope,e.operation,e.input);
  // Hosting must persist this budget across requests, workers and restarts.
  await options.takeBudget(e.operation);scope.active();
  const r=await(e.operation==='state'?options.readState(input.orderId):options.applyCommand({actorId:e.actorId,command:input}));
  // A commit can succeed before expiry while the response is lost. Never retry
  // automatically: the UI preserves the same command ID for a later receipt.
  scope.active();return fixtureResult(scope,e.operation,r);
 };
}
