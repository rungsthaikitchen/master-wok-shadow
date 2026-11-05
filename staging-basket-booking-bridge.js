'use strict';
// Staging-only bridge from validated raw basket to the locked booking seam.
// This does not install a server endpoint, change checkout, or grant booking rights.
const {prepareStagingBasket}=require('./staging-canonical-basket');
const {bookStagingCandidate}=require('./staging-booking-integration');
async function bookStagingBasket({connection,serviceDate,key,basket,model,engine,lookupKey,persist,bookingMode='LEGACY',masterWokAssess}={}){
 const fail=reason=>({status:'UNVERIFIED',committed:false,reason});
 if(!basket||!model||typeof key!=='string'||!key.trim())return fail('INVALID_REQUEST');
 const prepared=prepareStagingBasket({...basket,serviceDate,model});
 if(prepared.status!=='PREPARED')return fail(prepared.reason);
 // Validate the supplied service date against the promised local clock.
 // Caller must derive the actual service date from a trusted ready-at timestamp.
 const candidate={...prepared.candidate,items:prepared.rawRow.items};
 return bookStagingCandidate({connection,serviceDate,key,candidate,model,engine,
  lookupKey,persist,bookingMode,masterWokAssess});
}
module.exports={bookStagingBasket};

