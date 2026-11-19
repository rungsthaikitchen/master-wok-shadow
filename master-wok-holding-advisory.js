'use strict';
const {AUXILIARY}=require('./master-wok-recipe-rules');
function validateAdvisories(map={}){
 if(!map||Array.isArray(map)||typeof map!=='object')throw Error('INVALID_HOLDING_ADVISORIES');
 for(const [id,a] of Object.entries(map))if(!id||!a||a.kind!=='staff_review_required'||!Number.isInteger(a.maxMinutes)||a.maxMinutes<20||a.maxMinutes>330)throw Error('INVALID_HOLDING_ADVISORY');
 return map;
}
function warnings(plan){
 const items=new Map(),advisories=validateAdvisories(plan?.holdingAdvisories||{});
 const jobs=[...(plan?.wok?.jobs||[]),...(plan?.fryer?.jobs||[]).filter(j=>j.standalone),...(plan?.auxiliary?.jobs||[]).filter(j=>!AUXILIARY[j.itemId]?.beforeMain)];
 for(const j of jobs)for(const id of j.orderIds||[]){
  if(!advisories[id])continue;
  const minutes=j.readyMinute-j.finish;if(!Number.isFinite(minutes)||minutes<=20)continue;
  if(!items.has(id))items.set(id,new Map());
  for(const itemId of j.itemIds||[j.itemId])if(itemId)items.get(id).set(itemId,Math.max(items.get(id).get(itemId)||0,minutes));
 }
 return [...items].map(([id,dishes])=>({id,orderId:id.split('@')[0],estimatedMinutes:Math.max(...dishes.values()),dishes:[...dishes].sort(([a],[b])=>a.localeCompare(b)).map(([itemId,minutes])=>({itemId,minutes}))})).sort((a,b)=>a.id.localeCompare(b.id));
}
function token(warning){return JSON.stringify([warning.id,warning.estimatedMinutes,warning.dishes]);}
function acknowledgementCovers(ack,warning){
 if(!ack)return false;
 try{const [id,minutes,dishes]=JSON.parse(ack.warningToken);return id===warning.id&&minutes>=warning.estimatedMinutes&&warning.dishes.every(d=>dishes.some(old=>old.itemId===d.itemId&&old.minutes>=d.minutes));}catch(_){return false;}
}
function clampAdvisory(plan,id){
 const list=warnings(plan),warning=list.find(w=>w.id===id);
 if(plan.holdingAdvisories?.[id]){
  if(warning)plan.holdingAdvisories[id].maxMinutes=warning.estimatedMinutes;
  else delete plan.holdingAdvisories[id];
 }
 for(const job of plan.wok?.jobs||[])if(job.orderIds?.includes(id))job.holdingLimitMinutes=require('./master-wok-hold-policy').holdFor(plan,job.orderIds,20);
 return plan;
}
function reviewPlans(plans,order,{staffActor,warningToken}={},now){
 const pending=[];
 for(const [date,plan] of Object.entries(plans))for(const warning of warnings(plan).filter(w=>w.orderId===String(order.id))){
  const key=token(warning),ack=plan.holdingAcknowledgements?.[warning.id];
  if(acknowledgementCovers(ack,warning))continue;
  pending.push({serviceDate:date,...warning,warningToken:key});
 }
 if(!pending.length)return {ok:true};
 const expected=JSON.stringify(pending.map(w=>[w.serviceDate,w.warningToken]));
 if(typeof staffActor!=='string'||!/^\S+@\S+\.\S+$/.test(staffActor)||staffActor.length>254||warningToken!==expected)
  return {ok:false,reason:'EXTENDED_HOLDING_REVIEW_REQUIRED',holdingWarnings:pending,warningToken:expected};
 for(const w of pending){const p=plans[w.serviceDate];p.holdingAcknowledgements={...p.holdingAcknowledgements,[w.id]:{warningToken:w.warningToken,staffActor:staffActor.toLowerCase(),acknowledgedAt:new Date(now).toISOString(),estimatedMinutes:w.estimatedMinutes}};}
 return {ok:true};
}
module.exports={validateAdvisories,warnings,token,clampAdvisory,reviewPlans,acknowledgementCovers};
