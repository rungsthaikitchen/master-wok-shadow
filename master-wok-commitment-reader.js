'use strict';
const {localDate}=require('./master-wok-clock');
// While a new time awaits acknowledgement, hold both the original commitment
// and the proposal. This avoids freeing a customer's confirmed time silently.
function commitmentTimes(order){
 const original=order.confirmed_time||order.preferred_time;
 const effective=order.confirmed_time||order.proposed_time||order.preferred_time;
 if(order.status==='proposed')return [...new Set([original,order.proposed_time].filter(Boolean)
  .map(t=>new Date(t).toISOString()))];
 if(order.status==='customer_declined_time')return original?[new Date(original).toISOString()]:[];
 return effective?[new Date(effective).toISOString()]:[];
}
function expandCommitments(rows,serviceDate){
 const expanded=[];
 for(const row of rows){
  if(row.is_test||['cancelled','declined','rejected'].includes(row.status))continue;
  const times=commitmentTimes(row);
  if(!times.length)throw Error('UNTIMED_LIVE_ORDER');
  for(const time of times){
   if(localDate(time)!==serviceDate)continue;
   const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',
    hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(time))
    .filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
   expanded.push({...row,id:String(row.id)+'@'+time,source_order_id:String(row.id),
    confirmed_time:time,local_service_date:serviceDate,local_ready_minute:parts.hour*60+parts.minute});
  }
 }
 return expanded;
}
async function readCapacityCommitments(connection,serviceDate){
 const result=await connection.query(`SELECT o.*,
  COALESCE(jsonb_agg(to_jsonb(i)) FILTER(WHERE i.id IS NOT NULL),'[]'::jsonb) AS items
  FROM public.orders o LEFT JOIN public.order_items i ON i.order_id=o.id
  WHERE o.is_test=false AND lower(o.status) NOT IN ('cancelled','declined','rejected') AND (
   (o.preferred_time AT TIME ZONE 'Europe/London')::date=$1::date OR
   (o.proposed_time AT TIME ZONE 'Europe/London')::date=$1::date OR
   (o.confirmed_time AT TIME ZONE 'Europe/London')::date=$1::date OR
   (coalesce(o.preferred_time,o.proposed_time,o.confirmed_time) IS NULL AND
    (o.created_at AT TIME ZONE 'Europe/London')::date=$1::date))
  GROUP BY o.id ORDER BY o.created_at,o.id`,[serviceDate]);
 return expandCommitments(result.rows,serviceDate);
}
module.exports={commitmentTimes,expandCommitments,readCapacityCommitments};
