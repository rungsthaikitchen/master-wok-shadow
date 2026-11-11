'use strict';
// Must run on the connection holding the service-date transaction lock.
// Production activation additionally requires every blackout/service-control
// writer to participate in the same protocol; this reader cannot enforce that.
async function readBookingAvailability(connection,serviceDate){
 const blackouts=await connection.query(`SELECT kind,start_at,end_at,active
  FROM public.booking_blackouts WHERE active=true
   AND start_at < (($1::date+1)::timestamp AT TIME ZONE 'Europe/London')
   AND end_at > ($1::date::timestamp AT TIME ZONE 'Europe/London')`,[serviceDate]);
 const state=await connection.query(`SELECT mode,capacity_throttle,effective_until
  FROM public.service_state WHERE id=1`);
 if(state.rows.length!==1)throw Error('SERVICE_STATE_REQUIRED');
 return {blackouts:blackouts.rows,serviceState:state.rows[0],
  openDays:[3,4,5,6],closedDates:['2025-12-25','2025-12-26','2026-06-17']};
}
module.exports={readBookingAvailability};
