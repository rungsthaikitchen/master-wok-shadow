'use strict';
const {londonPlacement}=require('./staging-booking-integration');
function localDate(instant){
 const d=new Date(instant);if(!Number.isFinite(d.getTime()))throw Error('INVALID_TIMESTAMP');
 return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
}
function relativePlacement(instant,serviceDate){
 const date=localDate(instant);
 if(date>serviceDate)throw Error('ORDER_PLACED_AFTER_SERVICE_DATE');
 // Previous-day preorders must not inherit yesterday's clock as today's
 // release time. A local midnight release preserves production-start rules.
 return date<serviceDate?new Date(serviceDate+'T00:00:00'):londonPlacement(instant);
}
module.exports={localDate,relativePlacement};
