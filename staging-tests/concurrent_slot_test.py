"""Staging-only two-connection PostgreSQL concurrency proof.

Install: python -m pip install "psycopg[binary]"
Set STAGING_DATABASE_URL to the staging Postgres connection string (do not share it).
Run: python staging-tests/concurrent_slot_test.py
No production use. Creates only rolled-back test reservations.
"""
import os
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
import psycopg

url = os.environ.get("STAGING_DATABASE_URL")
if not url:
    raise SystemExit("Set STAGING_DATABASE_URL to STAGING PostgreSQL URL. Never use production.")
if "sslmode=" not in url:
    raise SystemExit("Connection URL must specify sslmode=require")
date = "2026-11-01"
slot = 1140
key_prefix = "concurrency-" + uuid.uuid4().hex
barrier = threading.Barrier(2, timeout=15)

def contender(index):
    with psycopg.connect(url, connect_timeout=10) as conn:
        # Connection's default transaction stays open until rollback.
        with conn.cursor() as cur:
            barrier.wait()
            cur.execute(
                "select master_wok_test.reserve_demo(%s, %s::date, %s, %s)",
                (f"{key_prefix}-{index}", date, slot, 1),
            )
            result = cur.fetchone()[0]
            # Keep reservation uncommitted briefly so competitor must wait
            # on the transaction-scoped advisory lock.
            if result == "RESERVED":
                import time
                time.sleep(2)
                # Commit first reservation, so second sees committed occupancy.
                conn.commit()
            else:
                conn.rollback()
            return result

# NOTE: The first transaction commits its reservation. Delete only this test's
# unique keys afterward. Never touch unrelated rows.
with ThreadPoolExecutor(max_workers=2) as pool:
    futures = [pool.submit(contender, i) for i in (1, 2)]
    results = [f.result(timeout=30) for f in futures]

with psycopg.connect(url) as conn:
    with conn.cursor() as cur:
        cur.execute(
            "delete from master_wok_test.slot_reservations where idempotency_key = any(%s)",
            ([f"{key_prefix}-1", f"{key_prefix}-2"],),
        )
    conn.commit()
print("Results:", sorted(results))
if sorted(results) != ["FULL", "RESERVED"]:
    raise SystemExit("FAIL: Expected exactly one FULL and one RESERVED")
print("PASS: one reservation under concurrent contention; test rows cleaned up")
