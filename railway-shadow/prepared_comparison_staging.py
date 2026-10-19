"""Default-off, staging-only persistent PREPARE runtime. No route capture path."""
from datetime import date
import hashlib
import hmac
import json
import math
import os
from pathlib import Path
import signal
import threading
import time
from delivery_minimal_candidate import read, point, QUERY
from shadow_collector import ShadowError, ManagementReadOnlySource
from delivery_private_bridge import PrivateCandidateBridge
from delivery_comparison_journal import DeliveryComparisonJournal, ComparisonError
from delivery_comparison_worker import serve_health

PROJECT = 'hvrqgufqjslvgiohgkvu'
DIRECTORY = Path('/data/master-wok-prepared-staging')
SAFE_FAILURE_REASONS = frozenset({
    'SOURCE_COVERAGE_UNVERIFIED','FIRST_ORDER_COMMITMENT_UNVERIFIED',
    'SOURCE_READ_ONLY_PROOF_REQUIRED','SOURCE_CLOCK_UNVERIFIED',
    'SOURCE_HTTP_ERROR','SOURCE_RESPONSE_TOO_LARGE','ATOMIC_SOURCE_REQUIRED',
    'CUSTOMER_POINT_UNVERIFIED','SOURCE_ITEM_MEMBERSHIP_UNVERIFIED',
    'PRIVATE_BRIDGE_FAILED','MINIMAL_BRIDGE_BINDING_FAILED',
    'MINIMAL_READER_CONTRACT_REQUIRED','SERVICE_DATE_BINDING_REQUIRED',
    'BACKUP_UNVERIFIED','COMPARISON_SCOPE_MISMATCH'})


def configuration(env):
    if env.get('MASTER_WOK_PREPARED_STAGING_ENABLED') != 'true':
        return None
    required = {'RAILWAY_PROJECT_ID':'7821ad5b-f5c2-4ab4-9206-c3d76eefd4c8',
        'RAILWAY_ENVIRONMENT_ID':'c1b8fad6-dbfc-4188-b4b5-a5dbfbf53279',
        'RAILWAY_ENVIRONMENT_NAME':'master-wok-staging',
        'RAILWAY_SERVICE_NAME':'master-wok-continuous-comparison-staging',
        'RAILWAY_SERVICE_ID':'012e5ef6-6225-4ab3-95f5-894583db7e83',
        'RAILWAY_VOLUME_MOUNT_PATH':'/data'}
    if any(env.get(k) != v for k,v in required.items()):
        raise ComparisonError('EXPLICIT_STAGING_SCOPE_REQUIRED')
    if any(k in env for k in ('MASTER_WOK_STAGING_GOOGLE_ROUTES_KEY',
        'GOOGLE_MAPS_API_KEY','SUPABASE_SERVICE_ROLE_KEY','DATABASE_URL')):
        raise ComparisonError('LIVE_CAPTURE_INPUTS_REFUSED')
    origin = json.loads(env.get('MASTER_WOK_PRIVATE_PREFLIGHT_ORIGIN',''))
    if not point(origin):raise ComparisonError('VERIFIED_KITCHEN_ORIGIN_REQUIRED')
    secret = env.get('MASTER_WOK_PSEUDONYM_KEY','')
    token = env.get('MASTER_WOK_MANAGEMENT_READ_TOKEN','')
    health = env.get('MASTER_WOK_PREPARED_HEALTH_TOKEN','')
    day = env.get('MASTER_WOK_PREPARED_SERVICE_DATE','')
    if len(secret)<32 or not token or len(health)<32:
        raise ComparisonError('PRIVATE_CONFIGURATION_REQUIRED')
    if date.fromisoformat(day).isoformat()!=day:raise ComparisonError('SERVICE_DATE_REQUIRED')
    port = int(env.get('PORT','8080'))
    cycles = int(env.get('MASTER_WOK_PREPARED_MAX_CYCLES','0'))
    if not 0<=port<=65535 or not 1<=cycles<=120:
        raise ComparisonError('BOUNDED_STAGING_RUN_REQUIRED')
    basis = env.get('MASTER_WOK_PREPARED_INPUT_BASIS','SAVED_STATE')
    if basis not in {'SAVED_STATE','SYNTHETIC_SQL_FIXTURE'}:
        raise ComparisonError('EXPLICIT_INPUT_BASIS_REQUIRED')
    if basis=='SYNTHETIC_SQL_FIXTURE':
        if day!='2026-10-15':raise ComparisonError('FIXED_FIXTURE_DATE_REQUIRED')
        secret=hmac.new(secret.encode(),b'prepared-synthetic-sql-fixture-v1',hashlib.sha256).hexdigest()
    namespace = hmac.new(secret.encode(),('delivery-minimal-v1/'+PROJECT).encode(),hashlib.sha256).hexdigest()
    return dict(origin=dict(point=origin,verified=True,provenance='OWNER_VERIFIED_KITCHEN_ORIGIN'),
        identity=hashlib.sha256(namespace.encode()).hexdigest(),secret=secret,token=token,
        health=health,day=day,port=port,cycles=cycles,basis=basis)


class PreparedMonitor:
    def __init__(self,journal,bridge,backup,service_date,clock=time.time):
        if journal.scope not in {'PREPARED_ONLY','PREPARED_SYNTHETIC'}:raise ComparisonError('PREPARED_JOURNAL_REQUIRED')
        self.journal,self.bridge,self.backup,self.clock=journal,bridge,backup,clock
        self.day=service_date
        self.failed=True;self.last_success=None;self.last_backup=None

    def healthy(self):
        now=self.clock()
        return (not self.failed and math.isfinite(now) and self.last_success is not None and
            self.last_backup is not None and 0<=now-self.last_success<=180 and
            0<=now-self.last_backup<=7200)

    def cycle(self):
        self.failed=True
        stage='SOURCE_OR_PREPARE'
        try:
            candidate=self.bridge.read_candidate()
            stage='JOURNAL_WRITE'
            if candidate is None:
                # Do not retain an earlier prepared order as current on empty days.
                self.journal.append_prepared_empty(self.day,self.clock())
                state='NO_CANDIDATE'
            else:
                if candidate.get('serviceDate')!=self.day:raise ComparisonError('SERVICE_DATE_BINDING_REQUIRED')
                self.journal.append_prepared(candidate,self.clock());state='PREPARED'
            stage='BACKUP_VERIFY'
            receipt=self.backup()
            at=receipt.get('verifiedAt')
            if (receipt.get('status')!='BACKUP_VERIFIED' or receipt.get('verifiedRestore') is not True or
                type(at) not in (int,float) or not math.isfinite(at) or not 0<=self.clock()-at<=7200):
                raise ComparisonError('BACKUP_UNVERIFIED')
            self.last_backup=at;self.last_success=self.clock();self.failed=False
            return dict(status='OBSERVED',preparation=state,verified=False,
                googleRequests=0,prediction='UNVERIFIED')
        except Exception as error:
            if stage=='SOURCE_OR_PREPARE':
                stage=getattr(self.bridge,'last_stage','SOURCE_OR_PREPARE')
                if stage not in {'SOURCE_READ','NODE_PREPARE'}:stage='SOURCE_OR_PREPARE'
            reason=str(error) if isinstance(error,(ShadowError,ComparisonError)) and str(error) in SAFE_FAILURE_REASONS else 'DETAILS_REDACTED'
            return dict(status='UNVERIFIED',reasonCode='PREPARED_CYCLE_FAILED',
                failureStage=stage,failureReason=reason,verified=False,googleRequests=0)
        finally:
            self.bridge.prepared=None;self.bridge.candidate=None


def run(env,*,stop=None,directory=DIRECTORY,transport=None,invoke=None,
        backup_factory=None,clock=time.time,ready=lambda server:None,
        emit=lambda event:print(json.dumps(event),flush=True)):
    config=configuration(env)
    if config is None:
        emit(dict(status='DISABLED',verified=False,googleRequests=0));return
    if directory.is_symlink():raise ComparisonError('SYMLINK_DIRECTORY_REFUSED')
    if config['basis']=='SYNTHETIC_SQL_FIXTURE':directory=directory/'synthetic-sql-fixture-v1'
    if directory.is_symlink():raise ComparisonError('SYMLINK_DIRECTORY_REFUSED')
    stop=threading.Event() if stop is None else stop
    journal=DeliveryComparisonJournal(directory/'delivery-comparison.sqlite3',
        config['identity'],'PREPARED_SYNTHETIC' if config['basis']=='SYNTHETIC_SQL_FIXTURE' else 'PREPARED_ONLY',enabled=True)
    server=None
    try:
        actual=ManagementReadOnlySource('https://'+PROJECT+'.supabase.co',config['token'],transport=transport)
        requests=[0]
        def selected_transport(payload):
            if payload['query']!=QUERY:raise ComparisonError('FIXED_QUERY_REQUIRED')
            query=QUERY
            if config['basis']=='SYNTHETIC_SQL_FIXTURE':
                from private_source_preflight import SYNTHETIC_QUERY
                query=SYNTHETIC_QUERY
            requests[0]+=1
            return actual.transport(dict(payload,query=query))
        def reader():
            return read('https://'+PROJECT+'.supabase.co',config['token'],config['day'],
                config['secret'],config['origin'],enabled=True,approved_project=PROJECT,
                transport=selected_transport,clock=clock)
        bridge=PrivateCandidateBridge(reader,enabled=True,invoke=invoke)
        if backup_factory is None:
            from delivery_comparison_offvolume import ComparisonBackup
            from delivery_evidence_backup import storage_configuration
            cloud=ComparisonBackup(storage_configuration(env),source=journal.path,
                identity=config['identity'],scope=journal.scope,clock=clock)
            def verified_backup():
                if not cloud.healthy():cloud.run_once()
                return dict(status='BACKUP_VERIFIED' if cloud.healthy() else 'BACKUP_FAILED',
                    verifiedRestore=cloud.healthy(),verifiedAt=cloud.last_success)
        else:verified_backup=backup_factory(journal)
        monitor=PreparedMonitor(journal,bridge,verified_backup,config['day'],clock)
        server=serve_health(monitor,config['health'],config['port'],data_origin='PREPARED_SYNTHETIC_SQL' if config['basis']=='SYNTHETIC_SQL_FIXTURE' else 'PREPARED_SAVED_STATE')
        ready(server)
        with journal.db:
            journal.db.execute('CREATE TABLE IF NOT EXISTS prepared_runtime_budget(id INTEGER PRIMARY KEY CHECK(id=1), max_cycles INTEGER NOT NULL, attempts INTEGER NOT NULL)')
            journal.db.execute('INSERT OR IGNORE INTO prepared_runtime_budget VALUES (1,?,0)',(config['cycles'],))
            if journal.db.execute('SELECT max_cycles FROM prepared_runtime_budget').fetchone()[0]!=config['cycles']:
                raise ComparisonError('PERSISTED_CYCLE_LIMIT_MISMATCH')
        for _ in range(config['cycles']):
            if stop.is_set():break
            with journal.db:
                attempts=journal.db.execute('SELECT attempts FROM prepared_runtime_budget').fetchone()[0]
                if attempts>=config['cycles']:
                    emit(dict(status='UNVERIFIED',reasonCode='STAGING_CYCLE_BUDGET_EXHAUSTED',verified=False,googleRequests=0))
                    break
                journal.db.execute('UPDATE prepared_runtime_budget SET attempts=attempts+1')
            result=monitor.cycle()
            emit(dict(result,inputBasis=config['basis'],sourceRequests=requests[0]))
            if _+1<config['cycles']:stop.wait(60)
    finally:
        if server:server.shutdown();server.server_close()
        journal.close()


def bootstrap(env):
    if configuration(env) is None:return
    if os.geteuid()==0:
        if DIRECTORY.is_symlink():raise ComparisonError('SYMLINK_DIRECTORY_REFUSED')
        DIRECTORY.mkdir(mode=0o700,parents=True,exist_ok=True)
        os.chown(DIRECTORY,10001,10001);os.chmod(DIRECTORY,0o700)
        os.setgroups([]);os.setgid(10001);os.setuid(10001)


def main():
    stop=threading.Event()
    for sig in (signal.SIGTERM,signal.SIGINT):signal.signal(sig,lambda *_:stop.set())
    try:
        bootstrap(os.environ)
        run(os.environ,stop=stop)
    except Exception:
        print(json.dumps(dict(status='UNVERIFIED',reasonCode='PREPARED_STAGING_FAILED',
            verified=False,googleRequests=0)),flush=True)
        raise SystemExit(1)

if __name__=='__main__':main()
