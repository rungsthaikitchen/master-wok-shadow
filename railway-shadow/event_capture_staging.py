"""Fixed synthetic local integration runner. Not a production capture endpoint."""
import json
import os
from pathlib import Path
import uuid
from event_capture_journal import EventCaptureJournal,EventCaptureError,ROOT,SCOPE,digest,snapshot


def run(env):
    if env.get('MASTER_WOK_EVENT_CAPTURE_FIXTURE_ENABLED')!='true':
        return dict(status='DISABLED',networkRequests=0,verified=False)
    if env.get('MASTER_WOK_EVENT_CAPTURE_SCOPE')!='LOCAL_FIXED_SYNTHETIC_FIXTURE':
        raise EventCaptureError('FIXED_SYNTHETIC_SCOPE_REQUIRED')
    if any(k in env for k in ['RAILWAY_PROJECT_ID','MASTER_WOK_MANAGEMENT_READ_TOKEN',
        'SUPABASE_SERVICE_ROLE_KEY','DATABASE_URL','MASTER_WOK_STAGING_GOOGLE_ROUTES_KEY']):
        raise EventCaptureError('REMOTE_OR_LIVE_INPUTS_REFUSED')
    directory=Path(env.get('MASTER_WOK_EVENT_CAPTURE_DIRECTORY',''))
    if not directory.is_absolute() or directory.is_symlink():raise EventCaptureError('DEDICATED_LOCAL_DIRECTORY_REQUIRED')
    batch=json.loads((ROOT/'fixtures/chronological-synthetic-service.json').read_text())
    identity=digest(dict(scope=SCOPE,fixture=batch))
    journal=EventCaptureJournal(directory/'event-capture.sqlite3',identity,enabled=True)
    try:
        capture=journal.enqueue(batch)
        result=journal.run_once(enabled=True)
        receipt=snapshot(journal,directory/('snapshot-'+uuid.uuid4().hex+'.sqlite3'))
        summary=journal.summary()
        okay=result['status'] in {'RECORDED','IDLE'} and not summary['failed'] and not any(summary['batchStates'].get(s,0) for s in ['PENDING','LEASED'])
        return dict(status='OBSERVED' if okay else 'UNVERIFIED',
            capture=capture['status'],worker=result['status'],backup=receipt['status'],
            summary=summary,networkRequests=0,verified=False)
    finally:journal.close()

if __name__=='__main__':
    try:print(json.dumps(run(os.environ)),flush=True)
    except Exception:
        print(json.dumps(dict(status='UNVERIFIED',reasonCode='EVENT_CAPTURE_STAGING_FAILED',networkRequests=0,verified=False)),flush=True)
        raise SystemExit(1)
