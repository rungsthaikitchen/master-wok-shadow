'use strict';
const {expandCommitments}=require('./master-wok-commitment-reader');
// A repeatable, read-only MVCC snapshot sees either side of an atomic booking
// commit, never half its order/plan writes. It needs no writer locks because
// hints cannot reserve or approve anything. Checkout still locks and rechecks.
async function beginHintSnapshot(connection,date){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date)
  throw Error('INVALID_SERVICE_DATE');
 await connection.query(`BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
  SET LOCAL lock_timeout = '10s';
  SET LOCAL statement_timeout = '15s'`);
}
function createHintSnapshotReader({schema='public'}={}){
 if(!['public','master_wok_rehearsal'].includes(schema))throw Error('INVALID_SNAPSHOT_SCHEMA');
 return async(connection,date)=>{
  const result=await connection.query(`SELECT clock_timestamp() AS now,
   (SELECT coalesce(jsonb_agg(to_jsonb(o)||jsonb_build_object('items',
    (SELECT coalesce(jsonb_agg(to_jsonb(i)),'[]'::jsonb) FROM ${schema}.order_items i WHERE i.order_id=o.id))
    ORDER BY o.created_at,o.id),'[]'::jsonb)
    FROM ${schema}.orders o WHERE o.is_test=false AND lower(o.status) NOT IN ('cancelled','declined','rejected') AND (
     (o.preferred_time AT TIME ZONE 'Europe/London')::date=$1::date OR
     (o.proposed_time AT TIME ZONE 'Europe/London')::date=$1::date OR
     (o.confirmed_time AT TIME ZONE 'Europe/London')::date=$1::date OR
     (coalesce(o.preferred_time,o.proposed_time,o.confirmed_time) IS NULL AND
      (o.created_at AT TIME ZONE 'Europe/London')::date=$1::date))) AS orders,
   (SELECT coalesce(jsonb_agg(jsonb_build_object('kind',kind,'start_at',start_at,'end_at',end_at,'active',active)),'[]'::jsonb)
    FROM ${schema}.booking_blackouts WHERE active=true
     AND start_at < (($1::date+1)::timestamp AT TIME ZONE 'Europe/London')
     AND end_at > ($1::date::timestamp AT TIME ZONE 'Europe/London')) AS blackouts,
   (SELECT jsonb_build_object('mode',mode,'capacity_throttle',capacity_throttle,'effective_until',effective_until)
    FROM ${schema}.service_state WHERE id=1) AS service_state,
   (SELECT plan FROM ${schema}.master_wok_service_plans WHERE service_date=$1) AS previous_plan`,[date]);
  const row=result.rows[0];
  if(!row?.now||!row.service_state||!Array.isArray(row.orders)||!Array.isArray(row.blackouts))throw Error('INVALID_HINT_SNAPSHOT');
  return {now:row.now,rows:expandCommitments(row.orders,date),previousPlan:row.previous_plan,
   availability:{blackouts:row.blackouts,serviceState:row.service_state,
    openDays:[3,4,5,6],closedDates:['2025-12-25','2025-12-26','2026-06-17']}};
 };
}
module.exports={beginHintSnapshot,createHintSnapshotReader};
