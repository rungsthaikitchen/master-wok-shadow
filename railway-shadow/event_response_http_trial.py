"""Default-off bounded private staging HTTP -> PostgreSQL proposal response trial."""
import json
import os
from pathlib import Path
import sqlite3
import time
from urllib.request import Request,urlopen
from urllib.error import HTTPError
from event_capture_journal import EventCaptureError,EventCaptureJournal
from event_runtime_staging import Monitor,configuration,cycle
from event_runtime_http import serve_api
from event_customer_response_staging import issue_token
from event_postgres_export import source_identity

STREAM='72c0464b-9fa7-4947-82d2-0ac4dbd42438'
DIRECTORY=Path('/data/customer-http-pg-72c0464b')

class TrialBudget:
 def __init__(self,path):
  self.path=Path(path)
  if self.path.is_symlink():raise EventCaptureError('TRIAL_PATH_REFUSED')
  with sqlite3.connect(self.path) as db:
   db.execute('CREATE TABLE IF NOT EXISTS attempts(kind TEXT PRIMARY KEY,used INTEGER NOT NULL)')
   for kind in ('reader','writer'):db.execute('INSERT OR IGNORE INTO attempts VALUES (?,0)',(kind,))
  self.path.chmod(0o600)
 def wrap(self,kind,transport):
  if kind not in ('reader','writer'):raise EventCaptureError('TRIAL_KIND_REFUSED')
  def call(payload):
   with sqlite3.connect(self.path,timeout=5) as db:
    db.execute('BEGIN IMMEDIATE')
    used=db.execute('SELECT used FROM attempts WHERE kind=?',(kind,)).fetchone()[0]
    if used >= (1 if kind=='reader' else 8):raise EventCaptureError('TRIAL_BUDGET_EXHAUSTED')
    db.execute('UPDATE attempts SET used=used+1 WHERE kind=?',(kind,))
   return transport(payload)
  return call
 def summary(self):
  with sqlite3.connect(self.path) as db:return dict(db.execute('SELECT kind,used FROM attempts'))

def exercise(server,operator_token,secret):
 base='http://127.0.0.1:'+str(server.server_port)
 def post(path,body,expected):
  request=Request(base+path,data=json.dumps(body).encode(),headers={'Authorization':'Bearer '+operator_token,'Content-Type':'application/json'})
  try:response=urlopen(request,timeout=20)
  except HTTPError as error:response=error
  with response:
   status=response.status;result=json.loads(response.read(8192))
  if status!=expected:raise EventCaptureError('TRIAL_HTTP_RESULT_REFUSED')
  if expected==200 and result.get('status') not in ('RECORDED','ALREADY_RECORDED'):raise EventCaptureError('TRIAL_HTTP_RESULT_REFUSED')
  return result
 def offer(number):
  return post('/staging/admin-action',dict(requestId='signed-offer-'+str(number),orderId='synthetic-runtime',action='offer',targetAt='2026-10-20T'+str(16+number)+':00:00Z'),200)
 def answer(number,decision='accept',expected=200):
  token=issue_token(STREAM,'synthetic-runtime','signed-offer-'+str(number),enabled=True,secret=secret)
  return post('/staging/proposal-response',dict(token=token,decision=decision),expected)
 offer(1);offer(2);answer(1,expected=409)
 if answer(2)['status']!='RECORDED' or answer(2)['status']!='ALREADY_RECORDED':raise EventCaptureError('TRIAL_RETRY_REFUSED')
 answer(2,'reject',409);offer(3);answer(3,'reject')
 return dict(status='SIGNED_HTTP_SEQUENCE_FINISHED',httpCalls=8,verified=False)

def main(env=None):
 env=os.environ if env is None else env
 if env.get('MASTER_WOK_SIGNED_HTTP_TRIAL_ENABLED')!='true':print(json.dumps(dict(status='DISABLED',sourceRequests=0)),flush=True);return
 if (env.get('MASTER_WOK_EVENT_RUNTIME_ENABLED')!='false' or env.get('MASTER_WOK_EVENT_RUNTIME_TRIAL_ENABLED')!='false' or
     env.get('MASTER_WOK_EVENT_SOAK_ENABLED')!='false' or env.get('MASTER_WOK_EVENT_CLOUD_BACKUP_ENABLED')!='false'):
  raise EventCaptureError('TRIAL_SCOPE_REFUSED')
 if not time.time()<float(env['MASTER_WOK_SIGNED_HTTP_TRIAL_END_EPOCH'])<=time.time()+600:raise EventCaptureError('TRIAL_DEADLINE_REFUSED')
 config=configuration(dict(env,MASTER_WOK_EVENT_RUNTIME_ENABLED='true',MASTER_WOK_EVENT_RUNTIME_DIRECTORY=str(DIRECTORY),MASTER_WOK_EVENT_STREAM_ID=STREAM))
 directory,stream,tokens,reader,writer=config
 directory.mkdir(parents=True,exist_ok=True,mode=0o700)
 budget=TrialBudget(directory/'trial-budget.sqlite3');secret=os.urandom(32)
 server,thread=serve_api(stream,*tokens,budget.wrap('writer',writer),lambda:False,host='127.0.0.1',response_secret=secret)
 try:
  print(json.dumps(exercise(server,tokens[0],secret)),flush=True)
  journal=EventCaptureJournal(directory/'event-capture.sqlite3',source_identity(stream),enabled=True)
  try:
   result=cycle(journal,stream,budget.wrap('reader',reader),Monitor(),directory)
   if result['status']!='OBSERVED' or result['observations']!=3:raise EventCaptureError('TRIAL_REPLAY_REFUSED')
   print(json.dumps(dict(result,attempts=budget.summary())),flush=True)
  finally:journal.close()
 finally:server.shutdown();server.server_close();thread.join(timeout=2)

if __name__=='__main__':
 try:main()
 except Exception:
  print(json.dumps(dict(status='UNVERIFIED',reasonCode='SIGNED_HTTP_TRIAL_FAILED',verified=False)),flush=True)
  raise SystemExit(1)
