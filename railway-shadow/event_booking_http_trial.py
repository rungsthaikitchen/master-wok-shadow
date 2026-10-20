"""Default-off one-shot complete basket -> offer -> signed reply staging trial."""
import json
import os
from pathlib import Path
import time
from urllib.request import Request,urlopen
from event_capture_journal import EventCaptureError,EventCaptureJournal
from event_booking_transport import BookingTransport
from event_runtime_staging import configuration,Monitor,cycle
from event_runtime_http import serve_api
from event_response_http_trial import TrialBudget,exercise
from event_postgres_export import source_identity
STREAM='4ff978cb-5a6b-4108-9cc6-9621276bdafa'
DIRECTORY=Path('/data/booking-http-4ff978cb')
class BookingBudget(TrialBudget):WRITER_LIMIT=9

def main(env=None):
 env=os.environ if env is None else env
 if env.get('MASTER_WOK_BOOKING_HTTP_TRIAL_ENABLED')!='true':print(json.dumps(dict(status='DISABLED',sourceRequests=0)),flush=True);return
 flags=('MASTER_WOK_EVENT_RUNTIME_ENABLED','MASTER_WOK_EVENT_RUNTIME_TRIAL_ENABLED','MASTER_WOK_EVENT_CLOUD_BACKUP_ENABLED','MASTER_WOK_EVENT_SOAK_ENABLED','MASTER_WOK_SIGNED_HTTP_TRIAL_ENABLED')
 if any(env.get(k)!='false' for k in flags):raise EventCaptureError('BOOKING_TRIAL_SCOPE_REFUSED')
 if not time.time()<float(env['MASTER_WOK_BOOKING_HTTP_TRIAL_END_EPOCH'])<=time.time()+600:raise EventCaptureError('BOOKING_TRIAL_DEADLINE_REFUSED')
 directory,stream,tokens,reader,_=configuration(dict(env,MASTER_WOK_EVENT_RUNTIME_ENABLED='true',MASTER_WOK_EVENT_RUNTIME_DIRECTORY=str(DIRECTORY),MASTER_WOK_EVENT_STREAM_ID=STREAM))
 directory.mkdir(mode=0o700,parents=True,exist_ok=True)
 budget=BookingBudget(directory/'booking-budget.sqlite3')
 writer=budget.wrap('writer',BookingTransport(env.get('MASTER_WOK_EVENT_WRITER_DSN')))
 secret=os.urandom(32)
 server,thread=serve_api(stream,*tokens,writer,lambda:False,response_secret=secret,creation_transport=writer)
 try:
  body=dict(requestId='create-http-1',orderId='831594aa-caae-42af-a009-ef7847a6b724',orderAlias='synthetic-runtime',preferredTime='2026-10-20T17:00:00Z',lines=[dict(item_id='panang-curry',qty=1,modifiers=[dict(id='chicken')]),dict(item_id='jasmine-rice',qty=1,modifiers=[])])
  req=Request('http://127.0.0.1:'+str(server.server_port)+'/staging/create-booking',data=json.dumps(body).encode(),headers={'Authorization':'Bearer '+tokens[0],'Content-Type':'application/json'})
  with urlopen(req,timeout=20) as response:
   if response.status!=200 or json.loads(response.read(8192)).get('status')!='RECORDED':raise EventCaptureError('BOOKING_CREATE_FAILED')
  exercise(server,tokens[0],secret,stream_id=stream)
  journal=EventCaptureJournal(directory/'event-capture.sqlite3',source_identity(stream),enabled=True)
  try:
   result=cycle(journal,stream,budget.wrap('reader',reader),Monitor(),directory)
   if result['status']!='OBSERVED' or result['observations']!=3:raise EventCaptureError('BOOKING_REPLAY_FAILED')
   print(json.dumps(dict(result,attempts=budget.summary(),httpCalls=9)),flush=True)
  finally:journal.close()
 finally:server.shutdown();server.server_close();thread.join(timeout=2)
if __name__=='__main__':
 try:main()
 except Exception:
  print(json.dumps(dict(status='UNVERIFIED',reasonCode='BOOKING_HTTP_TRIAL_FAILED',verified=False)),flush=True)
  raise SystemExit(1)
