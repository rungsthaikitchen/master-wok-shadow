import copy
from pathlib import Path
import tempfile
import unittest
from urllib.request import Request,urlopen
from urllib.error import HTTPError
from event_capture_journal import EventCaptureError
from event_runtime_http import serve_api
from event_response_http_trial import TrialBudget,exercise,main,STREAM
from event_source_staging import StagingEventSource,SCOPE
from test_event_capture_journal import fixture

class ResponseHttpTests(unittest.TestCase):
 def test_disabled_and_persistent_attempt_caps(self):
  main({})
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp)/'attempts.sqlite3';calls=[];b=TrialBudget(p)
   def fail(p):calls.append(p);raise OSError('failure')
   for _ in range(8):
    with self.assertRaises(OSError):b.wrap('writer',fail)({})
   b=TrialBudget(p)
   with self.assertRaises(EventCaptureError):b.wrap('writer',fail)({})
   b.wrap('reader',lambda _:[1])({})
   with self.assertRaises(EventCaptureError):b.wrap('reader',fail)({})
   self.assertEqual(len(calls),8)
 def test_real_http_signed_responses_repeated_proposals_and_transaction_state(self):
  with tempfile.TemporaryDirectory() as tmp:
   source=StagingEventSource(Path(tmp)/'synthetic-source.sqlite3','2026-10-20',enabled=True,scope=SCOPE)
   def writer(p):
    stream,rid,cmd=p['parameters'];self.assertEqual(stream,STREAM)
    event=dict(eventId=rid,at='2026-10-20T06:00:00Z')
    if cmd['action']=='offer':
     order=copy.deepcopy(fixture()['events'][0]['order']);order.update(orderId='synthetic-runtime',targetAt=cmd['targetAt'])
     event.update(kind='BOOKING_DECISION',actualDecision='SUGGESTED',order=order)
    else:event.update(kind='PROPOSAL_RESPONSE',orderId=cmd['orderId'],proposalEventId=cmd['proposalEventId'],response='ACCEPTED' if cmd['action']=='accept' else 'REJECTED')
    local=StagingEventSource(Path(tmp)/'synthetic-source.sqlite3','2026-10-20',enabled=True,scope=SCOPE)
    try:return [dict(result=local.record(event))]
    finally:local.close()
   server,thread=serve_api(STREAM,'o'*32,'h'*32,writer,lambda:False,response_secret=b's'*32)
   try:
    self.assertEqual(exercise(server,'o'*32,b's'*32)['httpCalls'],8)
    self.assertEqual(source.db.execute('SELECT count(*) FROM bookings').fetchone()[0],0)
    self.assertEqual(source.db.execute('SELECT count(*) FROM outbox').fetchone()[0],5)
    url='http://127.0.0.1:'+str(server.server_port)+'/staging/proposal-response'
    with self.assertRaises(HTTPError) as error:urlopen(url,timeout=5)
    self.assertEqual(error.exception.code,404)
    with self.assertRaises(HTTPError) as error:urlopen(Request(url,data=b'{}'),timeout=5)
    self.assertEqual(error.exception.code,401)
   finally:server.shutdown();server.server_close();thread.join(timeout=2);source.close()
 def test_new_route_is_absent_without_explicit_secret(self):
  def refuse(_):self.fail('source access')
  server,thread=serve_api(STREAM,'o'*32,'h'*32,refuse,lambda:False)
  try:
   request=Request('http://127.0.0.1:'+str(server.server_port)+'/staging/proposal-response',data=b'{}',headers={'Authorization':'Bearer '+'o'*32})
   with self.assertRaises(HTTPError) as error:urlopen(request,timeout=5)
   self.assertEqual(error.exception.code,404)
  finally:server.shutdown();server.server_close();thread.join(timeout=2)
