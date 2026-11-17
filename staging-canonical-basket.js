'use strict';
// Staging-only canonical basket boundary. No database writes or booking authority.
// Converts checkout-shaped lines to the exact classifier and raw row shapes
// needed by the existing locked booking seam and physical prototype.
function prepareStagingBasket({id,createdAt,serviceDate,readyMinute,items,model}={}){
 const fail=reason=>({status:'UNVERIFIED',reason,bookingApprovalAllowed:false});
 if(typeof id!=='string'||!id.trim()||!model||
    typeof model.classifyBasket!=='function'||typeof model.hasItem!=='function'||
    typeof serviceDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)||
    !Number.isInteger(readyMinute)||readyMinute<0||readyMinute>=1440||
    !Array.isArray(items)||!items.length)return fail('INVALID_CANDIDATE');
 const placed=new Date(createdAt);
 if(!Number.isFinite(placed.getTime()))return fail('INVALID_PLACEMENT');
 const lines=[];
 for(const item of items){
  if(!item||typeof item.item_id!=='string'||!model.hasItem(item.item_id)||
     !Number.isInteger(item.qty)||item.qty<=0||item.qty>100||
     !Array.isArray(item.modifiers)||
     item.modifiers.some(m=>!m||typeof m.id!=='string'||!m.id.trim()))
   return fail('INVALID_BASKET_LINE');
  if(item.spice!=null&&(!Number.isInteger(item.spice)||item.spice<0||item.spice>3))
   return fail('INVALID_SPICE');
  if(item.item_note!=null&&typeof item.item_note!=='string')return fail('INVALID_ITEM_NOTE');
  lines.push({item_id:item.item_id,qty:item.qty,modifiers:item.modifiers.map(m=>({...m})),
   ...(item.spice!=null?{spice:item.spice}:{}),...(item.item_note!=null?{item_note:item.item_note}:{})});
 }
 try{
  // Bounded search must not depend on the customer's add-to-basket order.
  // Use stable production phases: independent mains, standalone starters,
  // cold preparation, then mains that need fryer prerequisites. Retain every
  // line, quantity, modifier, spice and note; this changes traversal only.
  const ranked=lines.map(line=>{
   const c=model.classifyBasket([{itemId:line.item_id,qty:line.qty,mods:line.modifiers}]);
   const dependent=Object.values(c.rungDependencies||{}).some(n=>n>0);
   const standalone=Array.isArray(c.productionLines)&&c.productionLines.every(p=>!p.production?.length);
   const phase=dependent?3:c.groups?.salad>0?2:standalone?1:0;
   const key=JSON.stringify([line.item_id,line.modifiers.map(m=>m.id).sort(),line.spice??null,line.item_note??null,line.qty]);
   return {line,phase,key};
  }).sort((a,b)=>a.phase-b.phase||(a.key<b.key?-1:a.key>b.key?1:0));
  lines.splice(0,lines.length,...ranked.map(r=>r.line));
  const classification=model.classifyBasket(lines.map(l=>({itemId:l.item_id,qty:l.qty,mods:l.modifiers})));
  if(!classification)return fail('UNCLASSIFIED_BASKET');
  return {status:'PREPARED',bookingApprovalAllowed:false,
   candidate:{orderId:id,placedAt:placed,readyMinute,classification},
   rawRow:{id,created_at:placed.toISOString(),local_service_date:serviceDate,
    local_ready_minute:readyMinute,status:'pending',items:lines}};
 }catch(_){return fail('CLASSIFICATION_FAILED');}
}
module.exports={prepareStagingBasket};

