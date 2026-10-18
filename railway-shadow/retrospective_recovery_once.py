"""Default-off one-shot Railway rehearsal; fixed synthetic aggregates only."""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import tempfile
import time
from delivery_comparison_journal import DeliveryComparisonJournal, ComparisonError
from delivery_comparison_backup import backup,restore
from delivery_comparison_offvolume import ComparisonBackup
from delivery_evidence_backup import storage_configuration

DIRECTORY=Path('/data/master-wok-retrospective-recovery')
IDENTITY=hashlib.sha256(b'MASTER_WOK_SYNTHETIC_RETROSPECTIVE_RECOVERY_V1').hexdigest()
SCOPE='RETROSPECTIVE_CONDITIONAL'

def configuration(env):
    if env.get('MASTER_WOK_RETROSPECTIVE_RECOVERY_ENABLED')!='true':return None
    required={'RAILWAY_PROJECT_ID':'7821ad5b-f5c2-4ab4-9206-c3d76eefd4c8',
        'RAILWAY_ENVIRONMENT_ID':'c1b8fad6-dbfc-4188-b4b5-a5dbfbf53279',
        'RAILWAY_ENVIRONMENT_NAME':'master-wok-staging',
        'RAILWAY_SERVICE_NAME':'master-wok-retrospective-recovery',
        'RAILWAY_VOLUME_MOUNT_PATH':'/data',
        'MASTER_WOK_RETROSPECTIVE_RECOVERY_SCOPE':'SYNTHETIC_AGGREGATES_ONLY'}
    if any(env.get(k)!=v for k,v in required.items()):
        raise ComparisonError('EXPLICIT_RECOVERY_STAGING_SCOPE_REQUIRED')
    return storage_configuration(env)

def run(env,*,clock=time.time,directory=DIRECTORY,client_factory=None):
    config=configuration(env)
    if config is None:return {'status':'DISABLED','networkRequests':0,'verified':False}
    if directory.is_symlink():raise ComparisonError('SYMLINK_DIRECTORY_REFUSED')
    now=clock();capture=datetime.fromtimestamp(now,timezone.utc).isoformat()
    result=dict(status='SHADOW_RECOMMENDATION',reasonCode='SEPARATE_TRIPS_PREFERRED',
        networkRequests=2,verified=False,
        evidenceBasis='RETROSPECTIVE_CONDITIONAL_SCENARIO_NOT_DECISION_HISTORY',
        journeyBasis='CURRENT_ESTIMATES_APPLIED_RETROSPECTIVELY',
        clockMapping='DURATIONS_APPLIED_TO_HYPOTHETICAL_HISTORICAL_CLOCK_NOT_BACKDATED_MEASUREMENTS',
        serviceDate='2026-10-17',persistence='NONE',provider='GOOGLE_ROUTES',attribution='Google Maps')
    # Contract-shaped synthetic aggregate: the two-request field is fixture data.
    # This runner never invokes Google and has no route or source API credentials.
    journal=DeliveryComparisonJournal(directory/'delivery-comparison.sqlite3',IDENTITY,SCOPE,enabled=True)
    try:
        before=journal.db.execute('SELECT count(*) FROM observation_events').fetchone()[0]
        build=hashlib.sha256()
        for filename in ['retrospective_recovery_once.py','delivery_comparison_journal.py','delivery_comparison_backup.py','delivery_comparison_offvolume.py']:
            build.update(filename.encode()+b'\0'+Path(__file__).with_name(filename).read_bytes())
        journal.append_retrospective(result,source_hash=hashlib.sha256(b'FIXED_SYNTHETIC_AGGREGATE').hexdigest(),
            build_hash=build.hexdigest(),observed_status='completed',captured_at=capture,at=now)
        after=journal.db.execute('SELECT count(*) FROM observation_events').fetchone()[0]
        with tempfile.TemporaryDirectory(prefix='mw-retrospective-restore-') as folder:
            local=Path(folder)/'backup.sqlite3';meta=backup(journal,local)
            counts=restore(local,Path(folder)/'restored.sqlite3',IDENTITY,SCOPE,meta['sha256'])
            if counts!=meta['counts']:raise ComparisonError('LOCAL_RESTORE_COUNTS_MISMATCH')
        kwargs={} if client_factory is None else {'client_factory':client_factory}
        job=ComparisonBackup(config,source=journal.path,identity=IDENTITY,scope=SCOPE,clock=clock,**kwargs)
        uploaded=job.run_once()
        if uploaded['status']!='BACKUP_VERIFIED' or not job.healthy():
            raise ComparisonError('OFFVOLUME_RECOVERY_UNVERIFIED')
        return dict(status='RECOVERY_REHEARSAL_PASSED',dataOrigin='SYNTHETIC_REHEARSAL',
            beforeEvents=before,afterEvents=after,priorVolumeDataPresent=before>0,
            localRestoreVerified=True,cloudReadbackVerified=True,googleRequests=0,
            verified=False,bytes=uploaded['bytes'])
    finally:journal.close()

def bootstrap(env):
    config=configuration(env)
    if os.geteuid()==0:
        if config:
            if DIRECTORY.is_symlink():raise ComparisonError('SYMLINK_DIRECTORY_REFUSED')
            DIRECTORY.mkdir(mode=0o700,exist_ok=True)
            os.chown(DIRECTORY,10001,10001);os.chmod(DIRECTORY,0o700)
        os.setgroups([]);os.setgid(10001);os.setuid(10001)

if __name__=='__main__':
    try:
        bootstrap(os.environ)
        print(json.dumps(run(os.environ)))
    except Exception:
        print(json.dumps({'status':'UNVERIFIED','reasonCode':'RECOVERY_REHEARSAL_FAILED',
                          'googleRequests':0,'verified':False}))
        raise SystemExit(1)
