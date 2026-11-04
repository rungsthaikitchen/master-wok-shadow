"""Read-only multi-day staging replay summary. Usage:
python staging-tests/replay_staging_range.py 2026-10-01 2026-10-29
No writes. Uses existing single-day replay and its read-only database connection.
"""
import datetime
import json
import subprocess
import sys
from pathlib import Path

def main():
    if len(sys.argv)!=3:
        print("Usage: python staging-tests/replay_staging_range.py YYYY-MM-DD YYYY-MM-DD")
        return 2
    try:
        start=datetime.date.fromisoformat(sys.argv[1])
        end=datetime.date.fromisoformat(sys.argv[2])
    except ValueError:
        print("Invalid date")
        return 2
    if end<start or (end-start).days>60:
        print("Date range must be 0-60 days")
        return 2
    script=Path(__file__).with_name("replay_staging_day.py")
    print("date       fetched committed scheduled original raw    cross-order           batches nodes  note",flush=True)
    scanned=0
    populated=0
    errors=0
    for offset in range((end-start).days+1):
        scanned+=1
        day=(start+datetime.timedelta(days=offset)).isoformat()
        result=subprocess.run([sys.executable,str(script),day],capture_output=True,text=True,timeout=90)
        if result.returncode:
            errors+=1
            print(f"{day} ERROR {result.stderr.strip() or result.stdout.strip()}",flush=True)
            continue
        try:
            payload=json.loads(result.stdout[result.stdout.index("{"):])
        except (ValueError,json.JSONDecodeError) as exc:
            errors+=1
            print(f"{day} PARSE_ERROR {exc}",flush=True)
            continue
        proto=payload.get("crossOrderPrototype") or {}
        fetched=payload["committed"]+payload["excluded"]
        if not fetched:
            continue
        populated+=1
        print(f"{day} {fetched:7d} {payload['committed']:9d} {payload['scheduled']:9d} "
              f"{str(payload['feasible']):8s} {str(payload['rawFeasible']):6s} "
              f"{proto.get('status','?'):21s} {str(proto.get('productionBatches','-')):7s} "
              f"{str(proto.get('nodes','-')):5s} {proto.get('reason','')}",flush=True)
    print(f"COMPLETE: {scanned} dates scanned, {populated} with staging orders, {errors} errors.",flush=True)
    return 1 if errors else 0

if __name__=="__main__":
    raise SystemExit(main())
