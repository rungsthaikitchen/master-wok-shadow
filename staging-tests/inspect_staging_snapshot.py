"""Read-only staging snapshot probe. No writes, no production credentials.
Run: python staging-tests/inspect_staging_snapshot.py
Requires psycopg and STAGING_DATABASE_URL in the current terminal.
"""
import os
import sys
import psycopg

SQL = """
select o.id, o.created_at, o.status,
       to_char(coalesce(o.confirmed_time,o.proposed_time,o.preferred_time)
         at time zone 'Europe/London','YYYY-MM-DD') as local_service_date,
       (extract(hour from coalesce(o.confirmed_time,o.proposed_time,o.preferred_time)
         at time zone 'Europe/London')::int * 60 +
        extract(minute from coalesce(o.confirmed_time,o.proposed_time,o.preferred_time)
         at time zone 'Europe/London')::int) as local_ready_minute,
       count(i.id) as item_count
from public.orders o
left join public.order_items i on i.order_id=o.id
where coalesce(o.confirmed_time,o.proposed_time,o.preferred_time)
      >= (%s::date::timestamp at time zone 'Europe/London')
  and coalesce(o.confirmed_time,o.proposed_time,o.preferred_time)
      < ((%s::date+1)::timestamp at time zone 'Europe/London')
  and lower(coalesce(o.status,'')) not in ('cancelled','declined','rejected')
  and (%s::boolean or coalesce(o.is_test,false)=false)
group by o.id,o.created_at,o.status,o.confirmed_time,o.proposed_time,o.preferred_time
order by o.created_at,o.id
"""

def main():
    url = os.environ.get("STAGING_DATABASE_URL")
    if not url:
        print("STAGING_DATABASE_URL not set. No connection attempted.")
        return 2
    day = sys.argv[1] if len(sys.argv) > 1 else "2026-10-30"
    include_test = len(sys.argv) == 3 and sys.argv[2] == "--include-test"
    if len(sys.argv) > 3 or (len(sys.argv) == 3 and not include_test):
        print("Usage: inspect_staging_snapshot.py YYYY-MM-DD [--include-test]")
        return 2
    import datetime
    try:
        datetime.date.fromisoformat(day)
    except ValueError:
        print("Provide a YYYY-MM-DD service date.")
        return 2
    with psycopg.connect(url, connect_timeout=10) as conn:
        with conn.cursor() as cur:
            cur.execute("BEGIN READ ONLY")
            cur.execute(SQL, (day, day, include_test))
            rows = cur.fetchall()
            print(f"STAGING READ-ONLY snapshot for {day} (include_test={include_test}): {len(rows)} orders")
            for _id, _created, status, local_date, minute, item_count in rows:
                # No customer or order identifiers printed.
                print(f"  status={status}, local_date={local_date}, minute={minute}, items={item_count}")
            print("PASS: staging query executed; no writes performed")
            conn.rollback()
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
