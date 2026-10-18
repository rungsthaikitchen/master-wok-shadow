"""Default-off synthetic staging worker. Only network listener is private health.

No source database, provider requests or cloud backup credentials are required.
"""
import hashlib
import hmac
import json
import os
from pathlib import Path
import signal
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from delivery_comparison_journal import DeliveryComparisonJournal, ComparisonError
from delivery_comparison_backup import backup
from delivery_staging_worker import compare, ROOT, verify_private_health

IDENTITY=hashlib.sha256(b'master-wok-offline-synthetic-comparison-v1').hexdigest()


def configuration(env):
    if env.get('MASTER_WOK_COMPARISON_STAGING_ENABLED')!='true':return None
    path=Path(env.get('MASTER_WOK_COMPARISON_JOURNAL',''))
    token=env.get('MASTER_WOK_COMPARISON_HEALTH_TOKEN','')
    if (env.get('RAILWAY_ENVIRONMENT_NAME')!='master-wok-staging' or
        not path.is_absolute() or path.name!='delivery-comparison.sqlite3' or len(token)<32):
        raise ComparisonError('ISOLATED_STAGING_CONFIGURATION_REQUIRED')
    # An isolated rehearsal must not inherit source/provider secrets.
    if any(k in env for k in ('MASTER_WOK_STAGING_GOOGLE_ROUTES_KEY','MASTER_WOK_MANAGEMENT_READ_TOKEN','SUPABASE_SERVICE_ROLE_KEY','DATABASE_URL')):
        raise ComparisonError('SOURCE_CREDENTIALS_REFUSED')
    return path,token


def fixture_batch():
    source=json.loads(subprocess.check_output(['node','-e',
        "process.stdout.write(JSON.stringify({cases:require('./staging-delivery/test_cases').makeCases()}))"],
        cwd=ROOT,timeout=15,env={k:v for k,v in os.environ.items() if k in ('PATH','TZ','LANG')}))
    return compare(source)


class Monitor:
    def __init__(self):self.last_success=None;self.failed=True
    def healthy(self,at=None):
        age=(time.time() if at is None else at)-(self.last_success or 0)
        return not self.failed and self.last_success is not None and 0<=age<=180


def run_once(journal,monitor,*,assessor=fixture_batch,snapshot=backup,clock=time.time):
    monitor.failed=True
    try:
        previous=journal.db.execute('SELECT count(*) FROM observation_events').fetchone()[0]
        at=clock();journal.append_synthetic(assessor(),at)
        # Always verify a local snapshot before reporting success. This is on-volume
        # recovery only: it is NOT an off-volume disaster recovery backup.
        destination=journal.path.parent/'comparison-latest-backup.sqlite3'
        pending=journal.path.parent/'comparison-pending-backup.sqlite3'
        if pending.exists() or pending.is_symlink():pending.unlink()
        snapshot(journal,pending)
        os.replace(pending,destination)
        fd=os.open(destination.parent,os.O_RDONLY)
        try:os.fsync(fd)
        finally:os.close(fd)
        summary=journal.summary()  # Detect corrupt persisted comparison payloads.
        monitor.last_success=clock();monitor.failed=False
        return {'status':'OBSERVED','verified':False,'backup':'LOCAL_VERIFIED','dataOrigin':'SYNTHETIC_STAGING','previousEvents':previous,
                'eventRecords':journal.db.execute('SELECT count(*) FROM observation_events').fetchone()[0],
                'latestRecords':summary['latestRecords']}
    except Exception:
        return {'status':'UNVERIFIED','reasonCode':'COMPARISON_CYCLE_FAILED','verified':False}


def serve_health(monitor,token,port,extra_health=lambda:True):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def do_GET(self):
            if self.path!='/healthz':self.send_error(404);return
            if not hmac.compare_digest(self.headers.get('Authorization','').encode(),('Bearer '+token).encode()):
                self.send_error(401);return
            okay=monitor.healthy() and extra_health()
            body=json.dumps({'status':'HEALTHY' if okay else 'UNHEALTHY','verified':False,'dataOrigin':'SYNTHETIC_STAGING'}).encode()
            self.send_response(200 if okay else 503);self.send_header('Content-Type','application/json')
            self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
    server=ThreadingHTTPServer(('0.0.0.0',port),Handler);server.daemon_threads=True
    threading.Thread(target=server.serve_forever,daemon=True).start()
    return server


def main():
    config=configuration(os.environ)
    if config is None:
        print(json.dumps({'status':'DISABLED','verified':False,'networkRequests':0}),flush=True);return
    path,token=config
    journal=DeliveryComparisonJournal(path,IDENTITY,'SYNTHETIC_STAGING',enabled=True)
    monitor=Monitor();server=None;remote=None;stop=threading.Event()
    from delivery_comparison_offvolume import configuration as backup_configuration, ComparisonBackup
    backup_config=backup_configuration(os.environ)
    if backup_config is not None:remote=ComparisonBackup(backup_config)
    backup_started=False
    for sig in (signal.SIGTERM,signal.SIGINT):signal.signal(sig,lambda *_:stop.set())
    try:
        server=serve_health(monitor,token,int(os.environ.get('PORT','8080')),
                            extra_health=(remote.healthy if remote else lambda:True))
        while not stop.is_set():
            result=run_once(journal,monitor)
            if result['status']=='OBSERVED' and remote and not backup_started:
                remote.start(lambda event:print(json.dumps(event),flush=True));backup_started=True
            if result['status']=='OBSERVED' and (not remote or remote.healthy()):
                try:result.update(verify_private_health(server,token))
                except Exception:
                    monitor.failed=True
                    result={'status':'UNVERIFIED','reasonCode':'PRIVATE_HEALTH_FAILED','verified':False}
            print(json.dumps(result),flush=True)
            stop.wait(60)
    finally:
        if remote:remote.close()
        if server:server.shutdown();server.server_close()
        journal.close()

if __name__=='__main__':main()
