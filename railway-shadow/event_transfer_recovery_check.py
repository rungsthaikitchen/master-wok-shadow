"""Independent offline paired-evidence restore. Never connects to source or cloud."""
import argparse
import json
from pathlib import Path
from event_transfer_recovery import restore
if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('snapshot');parser.add_argument('manifest');parser.add_argument('destination');args=parser.parse_args()
 try:result=restore(args.snapshot,json.loads(Path(args.manifest).read_text()),args.destination)
 except Exception:print(json.dumps(dict(status='PAIR_RECOVERY_FAILED',sourceRequests=0,verified=False)));raise SystemExit(1)
 print(json.dumps(result))
