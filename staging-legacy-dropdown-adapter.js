'use strict';
// Staging-only, manual DOM adapter for the RTK customer time dropdown.
// Invoke AFTER populatePreferredTimeSelect has completed. No monkey-patching,
// event listeners, network calls, persistence, or changes to slot availability.
// This captures displayed legacy decisions, including lead-time/blackout effects.
// Load alongside staging-legacy-slot-capture.js in a local test harness.
const {captureLegacySlotDecisions}=require('./staging-legacy-slot-capture');
function captureDisplayedLegacySlots({document,serviceDate,basketLines}={}){
 if(!document || typeof document.getElementById!=='function')
   throw Error('DOCUMENT_REQUIRED');
 const select=document.getElementById('cust-preferred-time-select');
 if(!select || !select.options)throw Error('TIME_DROPDOWN_UNAVAILABLE');
 const slots=[];
 for(const option of Array.from(select.options)){
   const time=String(option.value||'');
   if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))continue;
   const [hour,minute]=time.split(':').map(Number);
   slots.push({time,legacyAllowed:!option.disabled,
     window:(hour>21 || (hour===21 && minute>0))?'OVERRUN':'NORMAL'});
 }
 return captureLegacySlotDecisions({serviceDate,slots,basketLines});
}
module.exports={captureDisplayedLegacySlots};
