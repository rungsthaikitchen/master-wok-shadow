import {createStaffIntentStore} from './staff-command-outbox.mjs';
const orderId=document.body.dataset.orderId,store=createStaffIntentStore(localStorage);
const $=id=>document.getElementById(id),message=$('message'),actions=[...document.querySelectorAll('[data-action]')];
const labels={pending:'Pending',proposed:'Time offered',confirmed:'Confirmed',customer_accepted_time:'Time accepted',customer_declined_time:'Time declined',cancelled:'Cancelled',completed:'Completed'};
const format=t=>new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(t));
let state=null,busy=false,conflict=false,storageFailed=false;
function pending(){try{return store.resume();}catch{storageFailed=true;return null;}}
function render(){
 const p=pending(),closed=state&&['cancelled','completed'].includes(state.status);
 for(const button of actions)button.disabled=busy||storageFailed||!state||!!p||closed;
 $('retry').hidden=!p||conflict;$('retry').disabled=busy||storageFailed;
 $('review').hidden=!p||!conflict;$('review').disabled=busy||storageFailed;
 $('refresh').disabled=busy||!!p||storageFailed;$('target').disabled=busy||!!p||closed||storageFailed;
 if(state){$('status').textContent=labels[state.status];$('current-target').textContent=format(state.target);}
 if(storageFailed)message.textContent='Saved action could not be read. Stop here and ask for help.';
}
async function post(path,body){
 const r=await fetch(path,{method:'POST',credentials:'same-origin',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000),headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const b=await r.json();if(!r.ok){const e=Error('REQUEST_FAILED');e.status=r.status;e.code=b.error;throw e;}return b;
}
async function refresh(){
 state=null;render();const s=await post('/admin-api/staff-state-v1',{orderId});
 if(!s||s.orderId!==orderId||!Number.isSafeInteger(s.revision)||s.revision<1||!Object.hasOwn(labels,s.status)||typeof s.target!=='string'||!Number.isFinite(Date.parse(s.target))||!Array.isArray(s.proposalTargets)||s.proposalTargets.length>8||!s.proposalTargets.every(t=>typeof t==='string'&&Number.isFinite(Date.parse(t))))throw Error('STATE_REQUIRED');
 state=s;$('target').replaceChildren(...s.proposalTargets.map(t=>{const o=document.createElement('option');o.value=t;o.textContent=format(t);return o;}));render();
}
async function send(c){
 try{const result=await post('/admin-api/staff-command-v1',c);store.acknowledge(c.commandId,result);conflict=false;await refresh();message.textContent='Action saved. Latest order details loaded.';}
 catch(e){
  if(e.code==='STAFF_REVISION_CONFLICT'){conflict=true;message.textContent='Order changed. Review the latest details before trying again.';}
  else if(e.status===401||e.status===403)message.textContent='Sign in again before retrying the saved action.';
  else message.textContent=pending()?'We could not confirm the result. Retry the same saved action.':'Action saved, but latest details could not load. Refresh before another action.';
 }
}
async function run(fn){if(busy)return;busy=true;message.textContent='Working…';render();try{await fn();}catch(e){message.textContent=e.code==='STAFF_BROWSER_STAGING_DISABLED'?'Staging route is disabled. No action has been sent.':e.status===403?'Sign in before loading staging details.':'Could not load staging details. Refresh to try again.';}finally{busy=false;render();}}
for(const button of actions)button.addEventListener('click',()=>run(async()=>{
 if(!state||pending()||storageFailed)return;
 const action=button.dataset.action;let c;try{c=store.begin({orderId,expectedRevision:state.revision,action,...(action==='offer'?{target:$('target').value}:{})});}catch{storageFailed=true;return;}await send(c);
}));
$('retry').addEventListener('click',()=>run(async()=>{const c=pending();if(c&&c.orderId===orderId)await send(c);}));
$('review').addEventListener('click',()=>run(async()=>{const c=pending();if(c)store.discardRefused(c.commandId,'STAFF_REVISION_CONFLICT');conflict=false;await refresh();message.textContent='Latest details loaded. Choose a new action if needed.';}));
$('refresh').addEventListener('click',()=>run(async()=>{await refresh();message.textContent='Latest order details loaded.';}));
run(async()=>{const p=pending();if(p&&p.orderId!==orderId){storageFailed=true;return;}await refresh();message.textContent=p?'Unfinished test action found. Retry to check its result.':'Ready for a test action.';});
