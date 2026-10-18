"""Offline aggregate import; no provider calls or source database access."""
import json
import os
import sys
import time
from delivery_comparison_journal import DeliveryComparisonJournal, ComparisonError

def run(env, read_input, *, clock=time.time):
    if env.get('MASTER_WOK_RETROSPECTIVE_IMPORT_ENABLED') != 'true':
        return {'status':'DISABLED','verified':False,'networkRequests':0}
    if (env.get('RAILWAY_PROJECT_ID') != '7821ad5b-f5c2-4ab4-9206-c3d76eefd4c8' or
        env.get('RAILWAY_ENVIRONMENT_ID') != 'c1b8fad6-dbfc-4188-b4b5-a5dbfbf53279'):
        raise ComparisonError('EXPLICIT_STAGING_SCOPE_REQUIRED')
    raw=read_input(16385)
    if len(raw.encode('utf-8'))>16384:
        raise ComparisonError('AGGREGATE_INPUT_TOO_LARGE')
    data=json.loads(raw)
    if not isinstance(data,dict) or set(data)!={'result','sourceHash','buildHash','sourceIdentity','observedStatus','capturedAt'}:
        raise ComparisonError('AGGREGATE_ENVELOPE_REQUIRED')
    journal=DeliveryComparisonJournal(env.get('MASTER_WOK_RETROSPECTIVE_DB',''),
        data['sourceIdentity'],'RETROSPECTIVE_CONDITIONAL',enabled=True)
    try:
        result=journal.append_retrospective(data['result'],source_hash=data['sourceHash'],
            build_hash=data['buildHash'],observed_status=data['observedStatus'],
            captured_at=data['capturedAt'],at=clock())
        return dict(result,networkRequests=0)
    finally:
        journal.close()

if __name__=='__main__':
    try:
        print(json.dumps(run(os.environ,sys.stdin.read)))
    except Exception:
        print(json.dumps({'status':'UNVERIFIED','reasonCode':'RETROSPECTIVE_IMPORT_REFUSED',
                          'verified':False,'networkRequests':0}))
        sys.exit(1)
