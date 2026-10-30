'use strict';
// PostgreSQL staging snapshot reader. Must be invoked on the SAME connection
// while the transaction writer holds its per-date advisory lock.
// This reader does NOT book orders or write to Supabase.
async function readStagingOrders(connection, serviceDate) {
  if (!connection || typeof connection.query !== 'function' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(serviceDate || '')) throw Error('INVALID_READ_REQUEST');
  const sql = `
    select o.id, o.created_at, o.preferred_time, o.proposed_time,
           o.confirmed_time, o.status,
           to_char(
             coalesce(o.confirmed_time, o.proposed_time, o.preferred_time)
             at time zone 'Europe/London', 'YYYY-MM-DD'
           ) as local_service_date,
           (
             extract(hour from coalesce(o.confirmed_time, o.proposed_time, o.preferred_time)
               at time zone 'Europe/London')::integer * 60 +
             extract(minute from coalesce(o.confirmed_time, o.proposed_time, o.preferred_time)
               at time zone 'Europe/London')::integer
           ) as local_ready_minute,
           coalesce(jsonb_agg(jsonb_build_object(
             'item_id', i.item_id, 'qty', i.qty, 'modifiers', i.modifiers
           )) filter (where i.id is not null), '[]'::jsonb) as items
      from public.orders o
      left join public.order_items i on i.order_id = o.id
     where coalesce(o.confirmed_time, o.proposed_time, o.preferred_time)
           >= ($1::date::timestamp at time zone 'Europe/London')
       and coalesce(o.confirmed_time, o.proposed_time, o.preferred_time)
           < (($1::date + 1)::timestamp at time zone 'Europe/London')
       and lower(coalesce(o.status,'')) not in ('cancelled','declined','rejected')
       and coalesce(o.is_test,false) = false
     group by o.id, o.created_at, o.preferred_time, o.proposed_time,
              o.confirmed_time, o.status
     order by o.created_at, o.id
  `;
  const result=await connection.query(sql,[serviceDate]);
  if (!result || !Array.isArray(result.rows)) throw Error('INVALID_QUERY_RESULT');
  return result.rows;
}
module.exports={readStagingOrders};
