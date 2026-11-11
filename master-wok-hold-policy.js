'use strict';
// Inputs come from locked grant rows or server-persisted plans, never a request
// field. The most restrictive member of a shared batch governs that batch.
function validateExceptions(map={}){
 if(!map||Array.isArray(map)||typeof map!=='object')throw Error('INVALID_HOLD_EXCEPTIONS');
 for(const [id,x] of Object.entries(map))if(!id||!x||!Number.isInteger(x.maxMinutes)||x.maxMinutes<20||x.maxMinutes>330||
  x.customerDiscussed!==true||typeof x.reviewId!=='string'||typeof x.approvalId!=='string'||
  typeof x.reason!=='string'||x.reason.trim().length<5||typeof x.staffActor!=='string'||!x.staffActor.trim()||
  !Number.isFinite(Date.parse(x.approvedAt)))throw Error('INVALID_HOLD_EXCEPTION');
 return map;
}
function holdFor(options,ids,fallback=20){
 const map=validateExceptions(options?.holdExceptions||{});
 if(!Array.isArray(ids)||!ids.length)return fallback;
 return Math.min(...ids.map(id=>map[String(id)]?.maxMinutes??fallback));
}
module.exports={validateExceptions,holdFor};
