"""Complete default-off staging daemon; fixed synthetic capture only.

No source adapter, Google client or production activation path exists here.
"""
from datetime import datetime,timezone
import hashlib
import json
import os
from pathlib import Path
import signal
import threading
import time
from delivery_comparison_controller import ComparisonController
from delivery_comparison_journal import DeliveryComparisonJournal,ComparisonError
from delivery_comparison_worker import serve_health
from delivery_comparison_offvolume import ComparisonBackup
from delivery_evidence_backup import storage_configuration

DIRECTORY=Path('/data/master-wok-continuous-comparison-staging')
IDENTITY=hashlib.sha256(b'MASTER_WOK_CONTINUOUS_SYNTHETIC_COMPARISON_V1').hexdigest()

def configuration(env):
    if env.get('MASTER_WOK_CONTINUOUS_STAGING_ENABLED')!='true':return None
    required={'RAILWAY_PROJECT_ID':'7821ad5b-f5c2-4ab4-9206-c3d76eefd4c8',
        'RAILWAY_ENVIRONMENT_ID':'c1b8fad6-dbfc-4188-b4b5-a5dbfbf53279',
        'RAILWAY_ENVIRONMENT_NAME':'master-wok-staging',
        'RAILWAY_SERVICE_NAME':'master-wok-continuous-comparison-staging',
        'RAILWAY_VOLUME_MOUNT_PATH':'/data',
        'MASTER_WOK_CONTINUOUS_SCOPE':'FIXED_SYNTHETIC_CAPTURE_ONLY',
        'MASTER_WOK_CONTINUOUS_REQUEST_LIMIT':'2'}
    if any(env.get(k)!=v for k,v in required.items()):
        raise ComparisonError('CONTINUOUS_SYNTHETIC_STAGING_SCOPE_REQUIRED')
    if any(k in env for k in ('MASTER_WOK_STAGING_GOOGLE_ROUTES_KEY','MASTER_WOK_MANAGEMENT_READ_TOKEN',
        'SUPABASE_SERVICE_ROLE_KEY','DATABASE_URL','MASTER_WOK_SINGLE_DELIVERY_PRIVATE_INPUT')):
        raise ComparisonError('LIVE_INPUTS_REFUSED')
    token=env.get('MASTER_WOK_CONTINUOUS_HEALTH_TOKEN','')
    if len(token)<32:raise ComparisonError('PRIVATE_HEALTH_TOKEN_REQUIRED')
    port=int(env.get('PORT','8080'))
    if not 0<=port<=65535:raise ComparisonError('INVALID_HEALTH_PORT')
    return token,port,storage_configuration(env)

def fixture_capture(candidate,clock):
    # These provider-shaped fields are synthetic schema fixtures. No requests.
    return dict(capturedAt=datetime.fromtimestamp(clock(),timezone.utc).isoformat(),
        result=dict(status='SHADOW_RECOMMENDATION',reasonCode='SEPARATE_TRIPS_PREFERRED',
        networkRequests=2,verified=False,
        evidenceBasis='RETROSPECTIVE_CONDITIONAL_SCENARIO_NOT_DECISION_HISTORY',
        journeyBasis='CURRENT_ESTIMATES_APPLIED_RETROSPECTIVELY',
        clockMapping='DURATIONS_APPLIED_TO_HYPOTHETICAL_HISTORICAL_CLOCK_NOT_BACKDATED_MEASUREMENTS',
        serviceDate=candidate['serviceDate'],persistence='NONE',provider='GOOGLE_ROUTES',attribution='Google Maps'))

def run(env,*,stop=None,directory=DIRECTORY,clock=time.time,client_factory=None,
        emit=lambda r:print(json.dumps(r),flush=True),ready=lambda server:None):
    config=configuration(env)
    if config is None:
        emit(dict(status='DISABLED',verified=False,googleRequests=0));return
    token,port,storage=config
    if directory.is_symlink():raise ComparisonError('SYMLINK_DIRECTORY_REFUSED')
    stop=threading.Event() if stop is None else stop
    journal=DeliveryComparisonJournal(directory/'delivery-comparison.sqlite3',IDENTITY,
        'RETROSPECTIVE_CONDITIONAL',enabled=True)
    server=None
    try:
        controller=ComparisonController(journal,enabled=True,allow_capture=True,request_limit=2,clock=clock)
        kwargs={} if client_factory is None else dict(client_factory=client_factory)
        cloud=ComparisonBackup(storage,source=journal.path,identity=IDENTITY,
            scope='RETROSPECTIVE_CONDITIONAL',clock=clock,**kwargs)
        # Deliberately bounded synthetic rehearsal: at most two successful cloud
        # snapshots over this journal's lifetime. Not an unattended backup policy.
        with journal.db:
            journal.db.execute('CREATE TABLE IF NOT EXISTS continuous_backup_budget(id INTEGER PRIMARY KEY CHECK(id=1), attempts INTEGER NOT NULL)')
            journal.db.execute('INSERT OR IGNORE INTO continuous_backup_budget VALUES (1,0)')
        def verified_backup():
            if cloud.healthy():
                return dict(status='BACKUP_VERIFIED',verifiedRestore=True,verifiedAt=cloud.last_success)
            with journal.db:
                used=journal.db.execute('SELECT attempts FROM continuous_backup_budget WHERE id=1').fetchone()[0]
                if used>=2:return dict(status='BACKUP_FAILED',verifiedRestore=False)
                journal.db.execute('UPDATE continuous_backup_budget SET attempts=attempts+1 WHERE id=1')
            receipt=cloud.run_once()
            return dict(receipt,verifiedAt=cloud.last_success)
        build=hashlib.sha256()
        for name in ('continuous_comparison_staging.py','delivery_comparison_controller.py',
                     'delivery_comparison_journal.py','delivery_comparison_worker.py'):
            build.update(name.encode()+b'\0'+Path(__file__).with_name(name).read_bytes())
        candidate=dict(sourceIdentity=IDENTITY,sourceHash=hashlib.sha256(b'FIXED_SYNTHETIC_CANDIDATE').hexdigest(),
            buildHash=build.hexdigest(),observedStatus='completed',serviceDate='2026-10-17')
        server=serve_health(controller,token,port,data_origin='SYNTHETIC_STAGING')
        ready(server)
        def emit_cycle(result):
            emit(dict(result,dataOrigin='SYNTHETIC_REHEARSAL',googleRequests=0))
        controller.run(stop,lambda:dict(candidate),lambda c:fixture_capture(c,clock),verified_backup,emit_cycle)
    finally:
        if server:server.shutdown();server.server_close()
        journal.close()

def bootstrap(env):
    config=configuration(env)
    if config is None:return
    if os.geteuid()==0:
        if DIRECTORY.is_symlink():raise ComparisonError('SYMLINK_DIRECTORY_REFUSED')
        DIRECTORY.mkdir(mode=0o700,exist_ok=True)
        os.chown(DIRECTORY,10001,10001);os.chmod(DIRECTORY,0o700)
        os.setgroups([]);os.setgid(10001);os.setuid(10001)

def main():
    stop=threading.Event()
    for sig in (signal.SIGTERM,signal.SIGINT):signal.signal(sig,lambda *_:stop.set())
    try:
        bootstrap(os.environ);run(os.environ,stop=stop)
    except Exception:
        print(json.dumps(dict(status='UNVERIFIED',reasonCode='CONTINUOUS_STAGING_FAILED',
                              dataOrigin='SYNTHETIC_REHEARSAL',verified=False,googleRequests=0)),flush=True)
        raise SystemExit(1)

if __name__=='__main__':main()
