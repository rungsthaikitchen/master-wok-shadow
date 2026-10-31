'use strict';
// Pure, offline comparison capture schema. No browser hooks, network, storage,
// customer data, checkout access or booking permissions.
function captureLegacySlotDecisions({serviceDate, slots, basketLines}={}) {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate||'') || !Array.isArray(slots) ||
    !Array.isArray(basketLines)) throw Error('INVALID_CAPTURE');
 if(slots.length>300 || basketLines.length>100)throw Error('CAPTURE_LIMIT');
 const lines=basketLines.map(line=>{
   if(!line || !/^[A-Za-z0-9_-]{1,80}$/.test(line.itemId||'') ||
      !Number.isInteger(line.qty)||line.qty<1||line.qty>100 ||
      !Array.isArray(line.mods)||line.mods.length>30 ||
      !line.mods.every(m=>m&&/^[A-Za-z0-9_-]{1,80}$/.test(m.id||'')))
     throw Error('INVALID_BASKET');
   return {itemId:line.itemId,qty:line.qty,mods:line.mods.map(m=>({id:m.id}))};
 });
 const decisions=slots.map(slot=>{
   if(!slot || !/^([01]\d|2[0-3]):[0-5]\d$/.test(slot.time||'') ||
      typeof slot.legacyAllowed!=='boolean' ||
      !['NORMAL','OVERRUN'].includes(slot.window))
     throw Error('INVALID_SLOT');
   return {time:slot.time,legacyAllowed:slot.legacyAllowed,window:slot.window};
 });
 return {schemaVersion:1,serviceDate,lines,decisions,
   masterWokStatus:'NOT_ASSESSED',comparisonVerified:false,
   bookingApprovalAllowed:false};
}
module.exports={captureLegacySlotDecisions};
