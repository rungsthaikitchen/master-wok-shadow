"""Default-off, fixed two-order terminal-status rehearsal in private staging."""
import json
import os
from pathlib import Path
import time
from urllib.error import HTTPError
from urllib.request import Request,urlopen
from event_booking_transport import BookingTransport
from event_capture_journal import EventCaptureError,EventCaptureJournal
from event_customer_response_staging import issue_token
from event_postgres_export import source_identity
from event_response_http_trial import TrialBudget
from event_runtime_http import serve_api
from event_runtime_staging import configuration,cycle,Monitor

STREAM='682fa56b-34ea-4ce5-bf91-324a95075c02'
DIRECTORY=Path('/data/terminal-http-682fa56b')
ORDERS=('7c7c9f78-3b93-42bd-bc6a-95b295172ec1','421104d6-9ca0-4c71-9a83-ed1482513922')
class TerminalBudget(TrialBudget):
 WRITER_LIMIT=12
 def __init__(self,path,deadline,*,clock=time.time):
  self.deadline=deadline;self.clock=clock
  super().__init__(path)
 def wrap(self,kind,transport):
  bounded=super().wrap(kind,transport)
  def call(payload):
   if self.clock()>=self.deadline:raise EventCaptureError('TERMINAL_TRIAL_DEADLINE_REFUSED')
   return bounded(payload)
  return call

def exercise(server,operator,secret):
 base='http://127.0.0.1:'+str(server.server_port)
 def post(path,body,expected,receipt=None):
  req=Request(base+path,data=json.dumps(body).encode(),headers={'Authorization':'Bearer '+operator,'Content-Type':'application/json'})
  try:r=urlopen(req,timeout=20)
  except HTTPError as error:r=error
  with r:
   code=r.status;result=json.loads(r.read(8192))
  if code!=expected or (receipt is not None and result.get('status')!=receipt):raise EventCaptureError('TERMINAL_TRIAL_HTTP_FAILED')
 for i,action in enumerate(('cancel','complete'),1):
  alias='synthetic-terminal-'+str(i)
  post('/staging/create-booking',dict(requestId='terminal-create-'+str(i),orderId=ORDERS[i-1],orderAlias=alias,preferredTime='2026-10-20T17:00:00Z',lines=[dict(item_id='jasmine-rice',qty=1,modifiers=[])]),200,'RECORDED')
  proposal='terminal-offer-'+str(i)
  post('/staging/admin-action',dict(requestId=proposal,orderId=alias,action='offer',targetAt='2026-10-20T18:00:00Z'),200,'RECORDED')
  token=issue_token(STREAM,alias,proposal,enabled=True,secret=secret)
  post('/staging/proposal-response',dict(token=token,decision='reject'),200,'RECORDED')
  terminal=dict(requestId='terminal-close-'+str(i),orderId=alias,action=action,targetAt=None)
  post('/staging/admin-action',terminal,200,'RECORDED')
  post('/staging/admin-action',terminal,200,'ALREADY_RECORDED')
  post('/staging/proposal-response',dict(token=token,decision='accept'),409)
 return dict(httpCalls=12,verified=False)

def main(env=None):
 env=os.environ if env is None else env
 if env.get('MASTER_WOK_TERMINAL_HTTP_TRIAL_ENABLED')!='true':
  print(json.dumps(dict(status='DISABLED',sourceRequests=0,verified=False)),flush=True);return
 flags=('MASTER_WOK_EVENT_RUNTIME_ENABLED','MASTER_WOK_EVENT_RUNTIME_TRIAL_ENABLED','MASTER_WOK_EVENT_CLOUD_BACKUP_ENABLED','MASTER_WOK_EVENT_SOAK_ENABLED','MASTER_WOK_SIGNED_HTTP_TRIAL_ENABLED','MASTER_WOK_BOOKING_HTTP_TRIAL_ENABLED','MASTER_WOK_CONTINUOUS_STAGING_ENABLED','MASTER_WOK_PREPARED_STAGING_ENABLED')
 if any(env.get(k)!='false' for k in flags):raise EventCaptureError('TERMINAL_TRIAL_SCOPE_REFUSED')
 deadline=float(env['MASTER_WOK_TERMINAL_HTTP_TRIAL_END_EPOCH'])
 if not time.time()<deadline<=time.time()+600:raise EventCaptureError('TERMINAL_TRIAL_DEADLINE_REFUSED')
 directory,stream,tokens,reader,_=configuration(dict(env,MASTER_WOK_EVENT_RUNTIME_ENABLED='true',MASTER_WOK_EVENT_RUNTIME_DIRECTORY=str(DIRECTORY),MASTER_WOK_EVENT_STREAM_ID=STREAM))
 directory.mkdir(mode=0o700,parents=True,exist_ok=True)
 budget=TerminalBudget(directory/'terminal-budget.sqlite3',deadline)
 writer=budget.wrap('writer',BookingTransport(env.get('MASTER_WOK_EVENT_WRITER_DSN')))
 secret=os.urandom(32)
 server,thread=serve_api(stream,*tokens,writer,lambda:False,response_secret=secret,creation_transport=writer)
 try:
  sequence=exercise(server,tokens[0],secret)
  journal=EventCaptureJournal(directory/'event-capture.sqlite3',source_identity(stream),enabled=True)
  try:
   result=cycle(journal,stream,budget.wrap('reader',reader),Monitor(),directory)
   if result['status']!='OBSERVED' or result['observations']!=2:raise EventCaptureError('TERMINAL_TRIAL_REPLAY_FAILED')
   print(json.dumps(dict(result,attempts=budget.summary(),httpCalls=sequence['httpCalls'])),flush=True)
  finally:journal.close()
 finally:server.shutdown();server.server_close();thread.join(timeout=2)
if __name__=='__main__':
 try:main()
 except Exception:
  print(json.dumps(dict(status='UNVERIFIED',reasonCode='TERMINAL_HTTP_TRIAL_FAILED',verified=False)),flush=True)
  raise SystemExit(1)
