"""Fixed synthetic delivery trial, real planner, restricted DB login; default off."""
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import time
from datetime import datetime,timezone
from urllib.request import Request,urlopen
from urllib.error import HTTPError
from event_capture_journal import EventCaptureError,EventCaptureJournal,canonical
from event_customer_response_staging import issue_token
from event_delivery_booking_transport import DeliveryBookingTransport
from event_postgres_export import source_identity
from event_runtime_http import serve_api
from event_runtime_staging import configuration,cycle,Monitor
from event_terminal_http_trial import TerminalBudget
STREAM='473cf9b1-393b-4644-873f-3071ffb610b1'
DIRECTORY=Path('/data/delivery-http-473cf9b1')
class DeliveryBudget(TerminalBudget):WRITER_LIMIT=10

def prepare(directory):
 script=Path(__file__).resolve().parent.parent/'master-wok-event-delivery-trial-plan.js'
 result=subprocess.run(['node',str(script)],input=json.dumps(dict(assessedAt=datetime.now(timezone.utc).isoformat())).encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=15,env={'PATH':os.environ.get('PATH','/usr/local/bin:/usr/bin:/bin'),'LANG':'C.UTF-8','TZ':'Europe/London','MASTER_WOK_DELIVERY_PLAN_TRIAL_ENABLED':'true'})
 if result.returncode or len(result.stdout)>100000:raise EventCaptureError('DELIVERY_PLANNER_FAILED')
 data=json.loads(result.stdout)
 if data.get('status')!='TRIAL_PLANS_PREPARED' or len(data.get('evidence',[]))!=3:raise EventCaptureError('DELIVERY_PLANNER_FAILED')
 path=directory/'delivery-planning.sqlite3'
 if path.is_symlink():raise EventCaptureError('DELIVERY_EVIDENCE_PATH_REFUSED')
 with sqlite3.connect(path) as db:
  db.execute('CREATE TABLE IF NOT EXISTS evidence(reference TEXT PRIMARY KEY,payload TEXT NOT NULL,sha256 TEXT NOT NULL)')
  if db.execute('SELECT count(*) FROM evidence').fetchone()[0]:raise EventCaptureError('DELIVERY_EVIDENCE_ALREADY_PREPARED')
  for evidence in data['evidence']:
   body=canonical(evidence);db.execute('INSERT INTO evidence VALUES (?,?,?)',(evidence['reference'],body,hashlib.sha256(body.encode()).hexdigest()))
 path.chmod(0o600)
 # Resolve the full retained evidence, not just an unchecked reference string.
 with sqlite3.connect(path) as db:
  for plan in data['plans'].values():
   row=db.execute('SELECT payload,sha256 FROM evidence WHERE reference=?',(plan['routeEvidenceRef'],)).fetchone()
   if not row or hashlib.sha256(row[0].encode()).hexdigest()!=row[1] or json.loads(row[0])['result']['estimates'][0]['deliveryReadyEstimate']!=plan['estimate']:raise EventCaptureError('DELIVERY_EVIDENCE_MISMATCH')
 return data['plans']

def exercise(server,operator,secret):
 base='http://127.0.0.1:'+str(server.server_port)
 def post(path,body,expected=200,receipt='RECORDED'):
  try:r=urlopen(Request(base+path,data=json.dumps(body).encode(),headers={'Authorization':'Bearer '+operator,'Content-Type':'application/json'}),timeout=20)
  except HTTPError as error:r=error
  with r:code=r.status;result=json.loads(r.read(8192))
  if code!=expected or (expected==200 and result.get('status')!=receipt):raise EventCaptureError('DELIVERY_HTTP_SEQUENCE_FAILED')
 def offer(n,target):post('/staging/admin-action',dict(requestId='delivery-offer-'+str(n),orderId='synthetic-delivery-trial',action='offer',targetAt=target))
 def answer(n,decision='accept',expected=200,receipt='RECORDED'):
  token=issue_token(STREAM,'synthetic-delivery-trial','delivery-offer-'+str(n),enabled=True,secret=secret)
  post('/staging/proposal-response',dict(token=token,decision=decision),expected,receipt)
 post('/staging/create-booking',dict(requestId='delivery-create',orderId='c4aa259f-f0ef-4703-bcec-3fc04c642020',orderAlias='synthetic-delivery-trial',preferredTime='2026-10-20T17:00:00Z',lines=[dict(item_id='panang-curry',qty=1,modifiers=[dict(id='chicken')])]))
 offer(1,'2026-10-20T18:00:00Z');offer(2,'2026-10-20T18:30:00Z');answer(1,expected=409)
 offer(3,'2026-10-20T19:00:00Z');answer(3);answer(3,receipt='ALREADY_RECORDED')
 body=dict(requestId='delivery-complete',orderId='synthetic-delivery-trial',action='complete',targetAt=None)
 post('/staging/admin-action',body);post('/staging/admin-action',body,receipt='ALREADY_RECORDED');answer(3,'reject',409)
 return 10

def main(env=None):
 env=os.environ if env is None else env
 if env.get('MASTER_WOK_DELIVERY_HTTP_TRIAL_ENABLED')!='true':print(json.dumps(dict(status='DISABLED',sourceRequests=0,verified=False)),flush=True);return
 flags=('MASTER_WOK_EVENT_RUNTIME_ENABLED','MASTER_WOK_EVENT_RUNTIME_TRIAL_ENABLED','MASTER_WOK_EVENT_CLOUD_BACKUP_ENABLED','MASTER_WOK_EVENT_SOAK_ENABLED','MASTER_WOK_SIGNED_HTTP_TRIAL_ENABLED','MASTER_WOK_BOOKING_HTTP_TRIAL_ENABLED','MASTER_WOK_TERMINAL_HTTP_TRIAL_ENABLED','MASTER_WOK_CONTINUOUS_STAGING_ENABLED','MASTER_WOK_PREPARED_STAGING_ENABLED')
 if any(env.get(k)!='false' for k in flags):raise EventCaptureError('DELIVERY_TRIAL_SCOPE_REFUSED')
 deadline=float(env['MASTER_WOK_DELIVERY_HTTP_TRIAL_END_EPOCH'])
 if not time.time()<deadline<=time.time()+600:raise EventCaptureError('DELIVERY_TRIAL_DEADLINE_REFUSED')
 directory,stream,tokens,reader,_=configuration(dict(env,MASTER_WOK_EVENT_RUNTIME_ENABLED='true',MASTER_WOK_EVENT_RUNTIME_DIRECTORY=str(DIRECTORY),MASTER_WOK_EVENT_STREAM_ID=STREAM))
 directory.mkdir(mode=0o700,parents=True,exist_ok=True)
 budget=DeliveryBudget(directory/'delivery-budget.sqlite3',deadline);plans=prepare(directory)
 writer=budget.wrap('writer',DeliveryBookingTransport(env.get('MASTER_WOK_EVENT_WRITER_DSN'),enabled=True,planning=plans.get))
 secret=os.urandom(32);server,thread=serve_api(stream,*tokens,writer,lambda:False,response_secret=secret,creation_transport=writer)
 try:
  calls=exercise(server,tokens[0],secret)
  journal=EventCaptureJournal(directory/'event-capture.sqlite3',source_identity(stream),enabled=True)
  try:
   r=cycle(journal,stream,budget.wrap('reader',reader),Monitor(),directory)
   if r['status']!='OBSERVED' or r['observations']!=3:raise EventCaptureError('DELIVERY_TRIAL_REPLAY_FAILED')
   print(json.dumps(dict(r,attempts=budget.summary(),httpCalls=calls,retainedPlanningRecords=3)),flush=True)
  finally:journal.close()
 finally:server.shutdown();server.server_close();thread.join(timeout=2)
if __name__=='__main__':
 try:main()
 except Exception:
  print(json.dumps(dict(status='UNVERIFIED',reasonCode='DELIVERY_HTTP_TRIAL_FAILED',verified=False)),flush=True);raise SystemExit(1)
