"""Bounded private staging API and poll rehearsal. Disabled by default."""
import json
import os
from pathlib import Path
import signal
import sqlite3
import threading
import time
import uuid
from urllib.request import Request,urlopen
from urllib.error import HTTPError
from event_capture_journal import EventCaptureJournal,EventCaptureError,snapshot
from event_postgres_export import poll,source_identity
from event_runtime_transport import DatabaseTransport
from event_runtime_http import serve_api

class Budget:
 def __init__(self,path,identity):
  self.path=Path(path)
  if self.path.is_symlink():raise EventCaptureError('BUDGET_PATH_REFUSED')
  with sqlite3.connect(self.path) as db:
   db.execute('CREATE TABLE IF NOT EXISTS budget(identity TEXT PRIMARY KEY,reads INTEGER CHECK(reads BETWEEN 0 AND 2),writes INTEGER CHECK(writes BETWEEN 0 AND 3))')
   rows=db.execute('SELECT identity FROM budget').fetchall()
   if rows and rows!=[(identity,)]:raise EventCaptureError('BUDGET_IDENTITY_MISMATCH')
   db.execute('INSERT OR IGNORE INTO budget VALUES (?,0,0)',(identity,))
  os.chmod(self.path,0o600)
 def summary(self):
  with sqlite3.connect(self.path) as db:
   reads,writes=db.execute('SELECT reads,writes FROM budget').fetchone()
   return dict(exportAttempts=reads,mutationAttempts=writes)
 def take(self,kind):
  column,limit=('reads',2) if kind=='reader' else ('writes',3)
  with sqlite3.connect(self.path,timeout=5) as db:
   db.execute('BEGIN IMMEDIATE')
   used=db.execute('SELECT '+column+' FROM budget').fetchone()[0]
   if used>=limit:raise EventCaptureError('STAGING_REQUEST_BUDGET_EXHAUSTED')
   db.execute('UPDATE budget SET '+column+'='+column+'+1')
 def transport(self,kind,transport):
  def invoke(payload):self.take(kind);return transport(payload)
  return invoke

class Monitor:
 def __init__(self,clock=time.monotonic):self.clock=clock;self.last=None;self.failed=True
 def healthy(self):return not self.failed and self.last is not None and 0<=self.clock()-self.last<=180

def cycle(journal,stream_id,reader,monitor,directory):
 try:
  intake=poll(journal,stream_id,enabled=True,transport=reader)
  result=journal.run_once(enabled=True);summary=journal.summary()
  if result['status'] not in ('RECORDED','IDLE') or summary['failed'] or any(summary['batchStates'].get(k,0) for k in ('PENDING','LEASED')):raise EventCaptureError('COMPARISON_INCOMPLETE')
  snapshot(journal,Path(directory)/('event-snapshot-'+uuid.uuid4().hex+'.sqlite3'))
  monitor.last=monitor.clock();monitor.failed=False
  return dict(status='OBSERVED',intake=intake['status'],worker=result['status'],observations=summary['counts']['observations'],verified=False)
 except Exception:
  monitor.failed=True
  return dict(status='UNVERIFIED',reasonCode='EVENT_RUNTIME_CYCLE_FAILED',verified=False)

def configuration(env):
 if env.get('MASTER_WOK_EVENT_RUNTIME_ENABLED')!='true':return None
 expected={'RAILWAY_PROJECT_ID':'7821ad5b-f5c2-4ab4-9206-c3d76eefd4c8','RAILWAY_ENVIRONMENT_ID':'c1b8fad6-dbfc-4188-b4b5-a5dbfbf53279','RAILWAY_SERVICE_ID':'012e5ef6-6225-4ab3-95f5-894583db7e83','MASTER_WOK_EVENT_RUNTIME_SCOPE':'SYNTHETIC_STAGING_EVENTS'}
 if any(env.get(k)!=v for k,v in expected.items()):raise EventCaptureError('EXPLICIT_STAGING_RUNTIME_REQUIRED')
 directory=Path(env.get('MASTER_WOK_EVENT_RUNTIME_DIRECTORY',''))
 if not directory.is_absolute() or any(p.is_symlink() for p in [directory,*directory.parents]):raise EventCaptureError('DEDICATED_EVENT_DIRECTORY_REQUIRED')
 stream=env.get('MASTER_WOK_EVENT_STREAM_ID');source_identity(stream)
 tokens=[env.get('MASTER_WOK_EVENT_OPERATOR_TOKEN'),env.get('MASTER_WOK_EVENT_HEALTH_TOKEN')]
 if any(not isinstance(t,str) or len(t)<32 for t in tokens) or tokens[0]==tokens[1]:raise EventCaptureError('DISTINCT_STAGING_TOKENS_REQUIRED')
 reader=DatabaseTransport(env.get('MASTER_WOK_EVENT_READER_DSN'),'reader')
 writer=DatabaseTransport(env.get('MASTER_WOK_EVENT_WRITER_DSN'),'writer')
 return directory,stream,tokens,reader,writer

def probe_health(server,token,expected):
 try:
  with urlopen(Request('http://127.0.0.1:'+str(server.server_port)+'/healthz',headers={'Authorization':'Bearer '+token}),timeout=5) as response:code=response.status
 except HTTPError as error:code=error.code
 if code!=expected:raise EventCaptureError('PRIVATE_RUNTIME_HEALTH_FAILED')
 return code

def trial_commands(server,token,target,*,offer_only=False):
 # Fixed synthetic case, fixed IDs: never accepts arbitrary orders or baskets.
 commands=[('/staging/admin-action',dict(requestId='runtime-offer-v1',orderId='synthetic-runtime',action='offer',targetAt=target)),
           ('/staging/customer-response',dict(requestId='runtime-accept-v1',orderId='synthetic-runtime',response='accept',proposalEventId='runtime-offer-v1'))]
 for path,body in commands[:1] if offer_only else commands:
  try:
   response=urlopen(Request('http://127.0.0.1:'+str(server.server_port)+path,data=json.dumps(body).encode(),headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'}),timeout=20)
  except HTTPError as error:
   result=json.loads(error.read(4096))
   safe={'DATABASE_AUTH_REFUSED','DATABASE_PERMISSION_REFUSED','DATABASE_READ_ONLY_REFUSED','DATABASE_TIMEOUT','DATABASE_LOCK_TIMEOUT','DATABASE_TLS_CERTIFICATE_UNVERIFIED','DATABASE_DNS_UNVERIFIED','DATABASE_NETWORK_UNREACHABLE','DATABASE_CONNECTION_UNVERIFIED','STAGING_DATABASE_REQUEST_FAILED','DATABASE_ROLE_UNPROVEN','STAGING_REQUEST_BUDGET_EXHAUSTED'}
   raise EventCaptureError(result.get('reasonCode') if result.get('reasonCode') in safe else 'PRIVATE_RUNTIME_TRIAL_FAILED') from None
  with response:
   result=json.loads(response.read(4096))
   if response.status!=200 or result.get('status') not in ('RECORDED','ALREADY_RECORDED'):raise EventCaptureError('PRIVATE_RUNTIME_TRIAL_FAILED')

def main(env=None):
 env=os.environ if env is None else env
 config=configuration(env)
 if config is None:print(json.dumps(dict(status='DISABLED',verified=False,sourceRequests=0)),flush=True);return
 directory,stream,tokens,reader,writer=config
 directory.mkdir(parents=True,exist_ok=True,mode=0o700)
 journal=EventCaptureJournal(directory/'event-capture.sqlite3',source_identity(stream),enabled=True)
 server=None;stop=threading.Event();monitor=Monitor()
 try:
  budget=Budget(directory/'runtime-budget.sqlite3',source_identity(stream))
  print(json.dumps(dict(status='BUDGET',**budget.summary(),verified=False)),flush=True)
  reader=budget.transport('reader',reader);writer=budget.transport('writer',writer)
  server,thread=serve_api(stream,*tokens,writer,monitor.healthy,host='0.0.0.0',port=int(env.get('PORT','8080')))
  for sig in (signal.SIGTERM,signal.SIGINT):signal.signal(sig,lambda *_:stop.set())
  probe_health(server,tokens[1],503);probe_health(server,'invalid-token',401)
  if env.get('MASTER_WOK_EVENT_RUNTIME_TRIAL_ENABLED')=='true':
   trial_commands(server,tokens[0],env.get('MASTER_WOK_EVENT_RUNTIME_TRIAL_TARGET'),offer_only=env.get('MASTER_WOK_EVENT_RUNTIME_TRIAL_OFFER_ONLY')=='true')
  for index in range(2):
   if stop.is_set():break
   result=cycle(journal,stream,reader,monitor,directory)
   if result['status']=='OBSERVED':
    result.update(authenticatedHealth=probe_health(server,tokens[1],200),unauthenticatedHealth=probe_health(server,'invalid-token',401),**budget.summary())
   print(json.dumps(result),flush=True)
   if result['status']!='OBSERVED':break
   if index==0:stop.wait(60)
 finally:
  monitor.failed=True
  if server:server.shutdown();server.server_close();thread.join(timeout=2)
  journal.close()

if __name__=='__main__':
 try:main()
 except Exception as error:
  safe={'EXPLICIT_STAGING_RUNTIME_REQUIRED','DEDICATED_EVENT_DIRECTORY_REQUIRED','STREAM_ID_REQUIRED','DISTINCT_STAGING_TOKENS_REQUIRED','STAGING_DATABASE_CONNECTION_REQUIRED','BUDGET_PATH_REFUSED','BUDGET_IDENTITY_MISMATCH','DATABASE_AUTH_REFUSED','DATABASE_PERMISSION_REFUSED','DATABASE_READ_ONLY_REFUSED','DATABASE_TIMEOUT','DATABASE_LOCK_TIMEOUT','DATABASE_TLS_CERTIFICATE_UNVERIFIED','DATABASE_DNS_UNVERIFIED','DATABASE_NETWORK_UNREACHABLE','DATABASE_CONNECTION_UNVERIFIED','STAGING_DATABASE_REQUEST_FAILED','DATABASE_ROLE_UNPROVEN','STAGING_REQUEST_BUDGET_EXHAUSTED','PRIVATE_RUNTIME_HEALTH_FAILED','PRIVATE_RUNTIME_TRIAL_FAILED'}
  detail=str(error) if isinstance(error,EventCaptureError) and str(error) in safe else type(error).__name__
  print(json.dumps(dict(status='UNVERIFIED',reasonCode='EVENT_RUNTIME_START_FAILED',diagnostic=detail,verified=False)),flush=True)
  raise SystemExit(1)
