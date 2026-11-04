"""Read-only staging-to-Node Master Wok replay.
Usage: python staging-tests/replay_staging_day.py 2026-10-17
Requires STAGING_DATABASE_URL, psycopg and Node 22.
"""
import datetime
import json
import os
import subprocess
import sys
from pathlib import Path
import psycopg

SQL = """
select o.id::text, o.created_at, o.preferred_time, o.proposed_time,
       o.confirmed_time, o.status,
       to_char(coalesce(o.confirmed_time,o.proposed_time,o.preferred_time)
         at time zone 'Europe/London','YYYY-MM-DD') as local_service_date,
       (extract(hour from coalesce(o.confirmed_time,o.proposed_time,o.preferred_time)
         at time zone 'Europe/London')::int*60 +
        extract(minute from coalesce(o.confirmed_time,o.proposed_time,o.preferred_time)
         at time zone 'Europe/London')::int) as local_ready_minute,
       coalesce(jsonb_agg(jsonb_build_object(
         'item_id',i.item_id,'qty',i.qty,'modifiers',i.modifiers
       )) filter(where i.id is not null),'[]'::jsonb) as items
from public.orders o left join public.order_items i on i.order_id=o.id
where coalesce(o.confirmed_time,o.proposed_time,o.preferred_time)
      >= (%s::date::timestamp at time zone 'Europe/London')
  and coalesce(o.confirmed_time,o.proposed_time,o.preferred_time)
      < ((%s::date+1)::timestamp at time zone 'Europe/London')
  and lower(coalesce(o.status,'')) not in ('cancelled','declined','rejected')
group by o.id,o.created_at,o.preferred_time,o.proposed_time,
         o.confirmed_time,o.status
order by o.created_at,o.id
"""

def main():
    if len(sys.argv)!=2:
        print("Usage: python staging-tests/replay_staging_day.py YYYY-MM-DD")
        return 2
    day=sys.argv[1]
    try:
        if datetime.date.fromisoformat(day).isoformat()!=day:
            raise ValueError()
    except ValueError:
        print("Invalid YYYY-MM-DD date")
        return 2
    url=os.getenv("STAGING_DATABASE_URL")
    if not url:
        print("STAGING_DATABASE_URL is not set")
        return 2
    with psycopg.connect(url,connect_timeout=10) as conn:
        with conn.cursor() as cur:
            cur.execute("BEGIN READ ONLY")
            cur.execute(SQL,(day,day))
            columns=[c.name for c in cur.description]
            orders=[]
            for values in cur.fetchall():
                row=dict(zip(columns,values))
                for field in ("created_at","preferred_time","proposed_time","confirmed_time"):
                    if row[field] is not None:
                        row[field]=row[field].isoformat()
                orders.append(row)
            conn.rollback()
    script=Path(__file__).resolve().parent.parent/"staging-readonly-replay.js"
    result=subprocess.run(["node",str(script)],input=json.dumps({
        "serviceDate":day,"orders":orders
    }),text=True,capture_output=True,timeout=60)
    if result.returncode:
        print(result.stderr.strip())
        return result.returncode
    print(f"READ-ONLY STAGING REPLAY: {len(orders)} orders fetched")
    print(result.stdout.strip())
    return 0

if __name__=="__main__":
    raise SystemExit(main())
