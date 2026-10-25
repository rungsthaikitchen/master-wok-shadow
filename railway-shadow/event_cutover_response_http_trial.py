"""Default-off one-shot loopback HTTP trial; fixed synthetic staging route only."""
import json
import os
from pathlib import Path
import time
from datetime import datetime
from urllib.request import Request,urlopen
from urllib.error import HTTPError
from event_capture_journal import EventCaptureError,EventCaptureJournal,snapshot,restore_snapshot
from event_cutover_trial import Budget as BaseBudget,FLAGS
from event_cutover_response_transport import CutoverResponseTransport
from event_cutover_response_staging import respond_after_cutover
from event_customer_response_staging import issue_token
from event_booking_transport import BookingTransport
from event_runtime_transport import connection_parameters,DatabaseTransport
from event_runtime_http import serve_api
from event_postgres_export import poll,source_identity

SOURCE='03f8a64f-049c-5613-bc70-93e5b88ed9ab'
DESTINATION='74247071-2b40-52cc-8b7b-dfd260a5b7cd'
DAY='2026-10-26'
ALIAS='synthetic-cutover-http'
CUTOVER='cutover-http-baseline'
DIRECTORY=Path('/data/cutover-response-http-26-oct-v1')

class Budget(BaseBudget):LIMITS={'started':1,'read':1,'write':8}

def configuration(env,now=None):
 if env.get('MASTER_WOK_CUTOVER_RESPONSE_HTTP_ENABLED')!='true':return None
 now=time.time() if now is None else now
 expected={'RAILWAY_PROJECT_ID':'7821ad5b-f5c2-4ab4-9206-c3d76eefd4c8','RAILWAY_ENVIRONMENT_ID':'c1b8fad6-dbfc-4188-b4b5-a5dbfbf53279','RAILWAY_SERVICE_ID':'012e5ef6-6225-4ab3-95f5-894583db7e83','MASTER_WOK_EVENT_RUNTIME_SCOPE':'SYNTHETIC_STAGING_EVENTS'}
 if (any(env.get(k)!=v for k,v in expected.items()) or any(env.get(k)!='false' for k in (*FLAGS,'MASTER_WOK_CUTOVER_TRIAL_ENABLED','MASTER_WOK_BACKEND_KEY_TRIAL_ENABLED','MASTER_WOK_KEY_COMPATIBILITY_ENABLED'))):raise EventCaptureError('CUTOVER_HTTP_SCOPE_REFUSED')
 try:deadline=float(env.get('MASTER_WOK_CUTOVER_RESPONSE_HTTP_END_EPOCH','0'))
 except (ValueError,TypeError):raise EventCaptureError('CUTOVER_HTTP_DEADLINE_REFUSED') from None
 if not now<deadline<=now+600 or deadline>=datetime.fromisoformat(DAY+'T19:00:00+00:00').timestamp():raise EventCaptureError('CUTOVER_HTTP_DEADLINE_REFUSED')
 connection_parameters(env.get('MASTER_WOK_EVENT_READER_DSN'),'reader');connection_parameters(env.get('MASTER_WOK_EVENT_WRITER_DSN'),'writer')
 return deadline

def exercise(server,operator,secret,*,clock=time.time,deadline):
 base='http://127.0.0.1:'+str(server.server_port);calls=0
 def post(path,body,expected,expected_result=None,authorized=True):
  nonlocal calls
  if not clock()<deadline:raise EventCaptureError('CUTOVER_HTTP_DEADLINE_REFUSED')
  headers={'Content-Type':'application/json'}
  if authorized:headers['Authorization']='Bearer '+operator
  req=Request(base+path,data=json.dumps(body).encode(),headers=headers);calls+=1
  try:r=urlopen(req,timeout=20)
  except HTTPError as error:r=error
  with r:status=r.status;result=json.loads(r.read(8192))
  if status!=expected or (expected_result and result.get('status')!=expected_result):raise EventCaptureError('CUTOVER_HTTP_RESULT_REFUSED')
 old=dict(token=issue_token(SOURCE,ALIAS,'offer-a',enabled=True,secret=secret),decision='accept')
 route='/staging/cutover-proposal-response'
 post(route,old,401,authorized=False)
 post(route,dict(old,destination=DESTINATION),409)
 post(route,dict(old,token=issue_token(DESTINATION,ALIAS,'offer-a',enabled=True,secret=secret)),409)
 post(route,old,200,'RECORDED');post(route,old,200,'ALREADY_RECORDED')
 post('/staging/admin-action',dict(requestId='offer-b',orderId=ALIAS,action='offer',targetAt=DAY+'T19:30:00Z'),200,'RECORDED')
 post(route,dict(old,decision='reject'),409)
 post(route,old,200,'ALREADY_RECORDED')
 new=dict(token=issue_token(DESTINATION,ALIAS,'offer-b',enabled=True,secret=secret),decision='reject')
 post('/staging/proposal-response',new,200,'RECORDED');post('/staging/proposal-response',new,200,'ALREADY_RECORDED')
 return calls

def main(env=None):
 env=os.environ if env is None else env;deadline=configuration(env)
 if deadline is None:print(json.dumps(dict(status='DISABLED',sourceRequests=0,verified=False)),flush=True);return
 if any(p.is_symlink() for p in (DIRECTORY,*DIRECTORY.parents)):raise EventCaptureError('CUTOVER_HTTP_PATH_REFUSED')
 DIRECTORY.mkdir(parents=True,exist_ok=True,mode=0o700);budget=Budget(DIRECTORY/'attempts.sqlite3',deadline);budget.take('started')
 def bounded(kind,transport):
  def call(payload):budget.take(kind);return transport(payload)
  return call
 writer=bounded('write',BookingTransport(env.get('MASTER_WOK_EVENT_WRITER_DSN')))
 compat=bounded('write',CutoverResponseTransport(env.get('MASTER_WOK_EVENT_WRITER_DSN'),enabled=True))
 reader=bounded('read',DatabaseTransport(env.get('MASTER_WOK_EVENT_READER_DSN'),'reader'))
 secret=os.urandom(32);operator=os.urandom(32).hex();health=os.urandom(32).hex()
 def response(body):return respond_after_cutover('POST',body,SOURCE,DESTINATION,CUTOVER,enabled=True,secret=secret,transport=compat)
 server,thread=serve_api(DESTINATION,operator,health,writer,lambda:False,response_secret=secret,cutover_response=response)
 try:
  calls=exercise(server,operator,secret,deadline=deadline)
  identity=source_identity(DESTINATION);journal=EventCaptureJournal(DIRECTORY/'event-capture.sqlite3',identity,enabled=True)
  try:
   poll(journal,DESTINATION,enabled=True,transport=reader);result=journal.run_once(enabled=True)
   if result.get('status')!='RECORDED' or result.get('observations')!=1:raise EventCaptureError('CUTOVER_HTTP_REPLAY_REFUSED')
   receipt=snapshot(journal,DIRECTORY/'snapshot.sqlite3');restore_dir=DIRECTORY/'restored';restore_dir.mkdir(mode=0o700)
   restore_snapshot(DIRECTORY/'snapshot.sqlite3',restore_dir/'event-capture.sqlite3',identity,receipt['sha256'])
  finally:journal.close()
  restored=EventCaptureJournal(restore_dir/'event-capture.sqlite3',identity,enabled=True)
  try:
   if restored.run_once(enabled=True)['status']!='IDLE':raise EventCaptureError('CUTOVER_HTTP_RECOVERY_REFUSED')
  finally:restored.close()
  outcome=dict(status='OBSERVED',scope='SYNTHETIC_STAGING_CUTOVER_HTTP',attempts=budget.summary(),httpCalls=calls,recoveryVerified=True,adminAttestationRequired=True,notifications=0,productionWrites=0,verified=False)
  (DIRECTORY/'result.json').write_text(json.dumps(outcome));(DIRECTORY/'result.json').chmod(0o600)
  print(json.dumps(outcome),flush=True)
 finally:server.shutdown();server.server_close();thread.join(timeout=2)

if __name__=='__main__':
 try:main()
 except Exception as error:
  print(json.dumps(dict(status='UNVERIFIED',reasonCode=str(error) if isinstance(error,EventCaptureError) else 'CUTOVER_HTTP_TRIAL_FAILED',verified=False)),flush=True)
  raise SystemExit(1)
