import copy
import json
from pathlib import Path
import tempfile
import unittest
from event_capture_journal import EventCaptureError
from event_customer_response_staging import issue_token,respond
from event_source_staging import StagingEventSource,SCOPE
from test_event_capture_journal import fixture
STREAM='11111111-1111-1111-1111-111111111111'
SECRET=b'synthetic-only-signing-key-32-bytes-minimum'

class CustomerResponseTests(unittest.TestCase):
 def token(self,proposal='offer1'):
  return issue_token(STREAM,'synthetic-a',proposal,enabled=True,secret=SECRET)
 def test_disabled_bad_method_tampering_and_wrong_scope_never_write(self):
  def refuse(_):self.fail('unexpected source request')
  self.assertIsNone(issue_token(None,None,None))
  self.assertEqual(respond(None,None,None,transport=refuse)['status'],'DISABLED')
  token=self.token()
  for method,body,extra in [
   ('GET',{'token':token,'decision':'accept'},{}),
   ('POST',{'token':token[:-1]+('a' if token[-1]!='a' else 'b'),'decision':'accept'},{}),
   ('POST',{'token':token,'decision':'accept','orderId':'synthetic-b'},{}),
   ('POST',{'token':token,'decision':'accept'},{'project':'production'}),
   ('POST',{'token':token,'decision':'accept'},{'secret':b'wrong-but-long-enough-signing-key-0000'})]:
   with self.assertRaises(EventCaptureError):respond(method,body,STREAM,enabled=True,transport=refuse,**dict({'secret':SECRET},**extra))
  with self.assertRaises(EventCaptureError):respond('POST',{'token':token,'decision':'accept'},'22222222-2222-2222-2222-222222222222',enabled=True,secret=SECRET,transport=refuse)
 def test_response_and_retry_flow_through_actual_transaction_and_replay_validation(self):
  with tempfile.TemporaryDirectory() as tmp:
   source=StagingEventSource(Path(tmp)/'synthetic-source.sqlite3','2026-10-17',enabled=True,scope=SCOPE)
   def offer(eid,at,target):
    e=copy.deepcopy(fixture()['events'][0]);e.pop('sequence');e.update(eventId=eid,at=at);e['order']['targetAt']=target;source.record(e)
   try:
    offer('offer1','2026-10-17T15:00:00Z','2026-10-17T18:00:00Z')
    offer('offer2','2026-10-17T15:01:00Z','2026-10-17T19:00:00Z')
    def transport(p):
     stream,rid,command=p['parameters'];self.assertEqual(stream,STREAM)
     e=dict(eventId=rid,at='2026-10-17T15:02:00Z',kind='PROPOSAL_RESPONSE',orderId=command['orderId'],proposalEventId=command['proposalEventId'],response='ACCEPTED' if command['action']=='accept' else 'REJECTED')
     return [dict(result=source.record(e))]
    def answer(proposal,decision='accept'):
     return respond('POST',dict(token=self.token(proposal),decision=decision),STREAM,enabled=True,secret=SECRET,transport=transport)
    with self.assertRaises(EventCaptureError):answer('offer1')
    self.assertEqual(source.db.execute('SELECT count(*) FROM outbox').fetchone()[0],2)
    self.assertEqual(answer('offer2')['status'],'RECORDED')
    self.assertEqual(answer('offer2')['status'],'ALREADY_RECORDED')
    state=json.loads(source.db.execute('SELECT payload FROM bookings').fetchone()[0])
    self.assertEqual(state['commitment'],'CONFIRMED');self.assertEqual(state['order']['targetAt'],'2026-10-17T19:00:00Z')
    with self.assertRaises(EventCaptureError):answer('offer2','reject')
    self.assertEqual(source.db.execute('SELECT count(*) FROM outbox').fetchone()[0],3)
    self.assertEqual(source.db.execute('SELECT count(*) FROM bookings').fetchone()[0],1)
    offer('offer3','2026-10-17T15:02:00Z','2026-10-17T19:30:00Z')
    self.assertEqual(answer('offer3','reject')['status'],'RECORDED')
    self.assertEqual(answer('offer3','reject')['status'],'ALREADY_RECORDED')
    self.assertEqual(source.db.execute('SELECT count(*) FROM bookings').fetchone()[0],0)
    self.assertEqual(source.db.execute('SELECT count(*) FROM outbox').fetchone()[0],5)
   finally:source.close()
 def test_backend_failure_cannot_be_reported_success(self):
  def fail(_):raise OSError('simulated transaction failure')
  with self.assertRaises(OSError):respond('POST',dict(token=self.token(),decision='reject'),STREAM,enabled=True,secret=SECRET,transport=fail)
