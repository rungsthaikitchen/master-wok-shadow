"""Default-off, six-read, ten-minute maximum synthetic staging soak."""
import json
import os
from pathlib import Path
import re
import signal
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
from event_capture_journal import EventCaptureJournal, EventCaptureError, digest
from event_runtime_staging import Monitor, cycle, probe_health
from event_runtime_transport import DatabaseTransport
from event_runtime_http import serve_api
from event_postgres_export import source_identity
from delivery_evidence_backup import storage_configuration, s3_client

STREAM='25891531-e7da-462b-aee2-16a2dd9115db'
DIRECTORY=Path('/data/event-soak-2026-10-19-v1')
RECEIPT=Path('/data/event-runtime-acceptance-25891531/cloud-recovery-receipt.json')

class SoakBudget:
 def __init__(self,path,identity,end,clock=time.time):
  self.path=Path(path);self.clock=clock
  if self.path.is_symlink():raise EventCaptureError('SOAK_PATH_REFUSED')
  with sqlite3.connect(self.path) as db:
   db.execute('CREATE TABLE IF NOT EXISTS soak(identity TEXT,end REAL,reads INTEGER CHECK(reads BETWEEN 0 AND 6),recovery INTEGER CHECK(recovery BETWEEN 0 AND 1))')
   rows=db.execute('SELECT identity,end FROM soak').fetchall()
   if rows and rows!=[(identity,end)]:raise EventCaptureError('SOAK_IDENTITY_MISMATCH')
   if not rows:db.execute('INSERT INTO soak VALUES (?,?,0,0)',(identity,end))
  self.path.chmod(0o600)
 def take(self,kind):
  if kind not in ('reads','recovery'):raise EventCaptureError('SOAK_WRITE_REFUSED')
  with sqlite3.connect(self.path,timeout=5) as db:
   db.execute('BEGIN IMMEDIATE')
   end,used=db.execute('SELECT end,'+kind+' FROM soak').fetchone()
   if self.clock()>=end or used>=(6 if kind=='reads' else 1):raise EventCaptureError('SOAK_BUDGET_EXHAUSTED')
   db.execute('UPDATE soak SET '+kind+'='+kind+'+1')
 def count(self):
  with sqlite3.connect(self.path) as db:return db.execute('SELECT reads FROM soak').fetchone()[0]

def recover(config,budget,receipt_path=RECEIPT,client_factory=s3_client):
 receipt=json.loads(Path(receipt_path).read_text())
 if receipt.get('proofHash')!=digest({k:v for k,v in receipt.items() if k!='proofHash'}) or receipt.get('identity')!=source_identity(STREAM):raise EventCaptureError('SOAK_RECEIPT_REFUSED')
 key=receipt.get('key','')
 if not re.fullmatch('master-wok-events/v1/'+source_identity(STREAM)+r'/[a-f0-9]{32}\.sqlite3',key):raise EventCaptureError('SOAK_KEY_REFUSED')
 budget.take('recovery');client=client_factory(config)
 try:
  with tempfile.TemporaryDirectory(prefix='mw-independent-cloud-') as tmp:
   root=Path(tmp)
   for suffix,limit,name in [('.json',8192,'manifest.json'),('',5_000_000,'snapshot.sqlite3')]:
    body=client.get_object(Bucket=config.bucket,Key=key+suffix)['Body']
    try:data=body.read(limit+1)
    finally:body.close()
    if len(data)>limit:raise EventCaptureError('SOAK_DOWNLOAD_LIMIT')
    (root/name).write_bytes(data)
   manifest=json.loads((root/'manifest.json').read_text())
   if manifest!={k:v for k,v in receipt.items() if k not in ('proofHash','restored')}:raise EventCaptureError('SOAK_MANIFEST_MISMATCH')
   # No source, writer, operator, management or cloud credentials reach the child.
   result=subprocess.run([sys.executable,str(Path(__file__).with_name('event_recovery_check.py')),str(root/'snapshot.sqlite3'),str(root/'manifest.json'),str(root/'event-capture.sqlite3')],
     env={k:v for k,v in os.environ.items() if k in ('PATH','LANG')},capture_output=True,text=True,timeout=30)
   if result.returncode or json.loads(result.stdout).get('status')!='OFFLINE_RECOVERY_VERIFIED':raise EventCaptureError('SOAK_RECOVERY_FAILED')
   return dict(status='INDEPENDENT_CLOUD_RECOVERY_VERIFIED',sourceRequests=0,verified=False)
 finally:client.close()

def main(env=None):
 env=os.environ if env is None else env
 if env.get('MASTER_WOK_EVENT_SOAK_ENABLED')!='true':print(json.dumps(dict(status='DISABLED',sourceRequests=0,verified=False)),flush=True);return
 expected={'RAILWAY_PROJECT_ID':'7821ad5b-f5c2-4ab4-9206-c3d76eefd4c8','RAILWAY_ENVIRONMENT_ID':'c1b8fad6-dbfc-4188-b4b5-a5dbfbf53279','RAILWAY_SERVICE_ID':'012e5ef6-6225-4ab3-95f5-894583db7e83','MASTER_WOK_EVENT_RUNTIME_SCOPE':'SYNTHETIC_STAGING_EVENTS','MASTER_WOK_EVENT_RUNTIME_ENABLED':'false','MASTER_WOK_EVENT_RUNTIME_TRIAL_ENABLED':'false','MASTER_WOK_EVENT_CLOUD_BACKUP_ENABLED':'false'}
 if any(env.get(k)!=v for k,v in expected.items()):raise EventCaptureError('SOAK_SCOPE_REFUSED')
 end=float(env['MASTER_WOK_EVENT_SOAK_END_EPOCH'])
 if not time.time()<end<=time.time()+600:raise EventCaptureError('SOAK_DEADLINE_REFUSED')
 if any(p.is_symlink() for p in (DIRECTORY,*DIRECTORY.parents)):raise EventCaptureError('SOAK_PATH_REFUSED')
 DIRECTORY.mkdir(mode=0o700,parents=True,exist_ok=True)
 budget=SoakBudget(DIRECTORY/'soak-budget.sqlite3',source_identity(STREAM),end)
 print(json.dumps(recover(storage_configuration(env),budget)),flush=True)
 reader=DatabaseTransport(env.get('MASTER_WOK_EVENT_READER_DSN'),'reader')
 def read(payload):budget.take('reads');return reader(payload)
 def deny(_):raise EventCaptureError('SOAK_WRITE_REFUSED')
 tokens=[env.get('MASTER_WOK_EVENT_OPERATOR_TOKEN',''),env.get('MASTER_WOK_EVENT_HEALTH_TOKEN','')]
 if any(len(t)<32 for t in tokens) or tokens[0]==tokens[1]:raise EventCaptureError('SOAK_TOKENS_REFUSED')
 monitor=Monitor();stop=threading.Event()
 for sig in (signal.SIGTERM,signal.SIGINT):signal.signal(sig,lambda *_:stop.set())
 journal=EventCaptureJournal(DIRECTORY/'event-capture.sqlite3',source_identity(STREAM),enabled=True)
 server,thread=serve_api(STREAM,*tokens,deny,monitor.healthy,host='0.0.0.0',port=int(env.get('PORT','8080')))
 try:
  for _ in range(6):
   if stop.is_set() or time.time()>=end:break
   result=cycle(journal,STREAM,read,monitor,DIRECTORY)
   result.update(exportAttempts=budget.count(),mutationAttempts=0)
   if result['status']=='OBSERVED':result.update(authenticatedHealth=probe_health(server,tokens[1],200),unauthenticatedHealth=probe_health(server,'invalid',401))
   print(json.dumps(result),flush=True)
   if result['status']!='OBSERVED':raise EventCaptureError('SOAK_CYCLE_FAILED')
   if budget.count()<6:stop.wait(min(60,max(0,end-time.time())))
  print(json.dumps(dict(status='SOAK_FINISHED',exportAttempts=budget.count(),mutationAttempts=0,verified=False)),flush=True)
 finally:
  monitor.failed=True;server.shutdown();server.server_close();thread.join(timeout=2);journal.close()

if __name__=='__main__':
 try:main()
 except Exception:
  print(json.dumps(dict(status='UNVERIFIED',reasonCode='SOAK_FAILED',verified=False)),flush=True)
  raise SystemExit(1)
