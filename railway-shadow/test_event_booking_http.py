import copy
from pathlib import Path
import tempfile
import unittest
from urllib.request import Request,urlopen
import json
from event_booking_http_trial import BookingBudget,main,STREAM
from event_booking_transport import CREATE_QUERY
from event_response_http_trial import exercise
from event_runtime_http import serve_api
from event_source_staging import StagingEventSource,SCOPE
from event_capture_journal import EventCaptureError
from test_event_capture_journal import fixture
class BookingHttpTests(unittest.TestCase):
 def test_disabled_and_separate_nine_request_budget(self):
  main({})
  with tempfile.TemporaryDirectory() as tmp:
   b=BookingBudget(Path(tmp)/'budget.sqlite3')
   for _ in range(9):b.wrap('writer',lambda _:None)({})
   with self.assertRaises(EventCaptureError):BookingBudget(b.path).wrap('writer',lambda _:None)({})
 def test_creation_through_loopback_then_offers_and_signed_responses(self):
  with tempfile.TemporaryDirectory() as tmp:
   path=Path(tmp)/'synthetic-source.sqlite3'
   source=StagingEventSource(path,'2026-10-20',enabled=True,scope=SCOPE);source.close()
   def writer(p):
    event=dict(at='2026-10-20T06:00:00Z')
    if p['query']==CREATE_QUERY:
     _,rid,oid,alias,target,lines=p['parameters'];self.assertEqual(len(lines),2)
     order=dict(orderId=alias,orderType='collection',targetAt=target,deliveryReadyEstimate=None,lines=[dict(itemId=l['item_id'],qty=l['qty'],mods=l['modifiers']) for l in lines])
     event.update(eventId=rid,kind='RESERVATION_SET',commitment='PROPOSED',order=order)
    else:
     _,rid,cmd=p['parameters'];event['eventId']=rid
     if cmd['action']=='offer':
      order=copy.deepcopy(fixture()['events'][0]['order']);order.update(orderId='synthetic-runtime',targetAt=cmd['targetAt'])
      event.update(kind='BOOKING_DECISION',actualDecision='SUGGESTED',order=order)
     else:event.update(kind='PROPOSAL_RESPONSE',orderId=cmd['orderId'],proposalEventId=cmd['proposalEventId'],response='ACCEPTED' if cmd['action']=='accept' else 'REJECTED')
    local=StagingEventSource(path,'2026-10-20',enabled=True,scope=SCOPE)
    try:return [dict(result=local.record(event))]
    finally:local.close()
   server,thread=serve_api(STREAM,'o'*32,'h'*32,writer,lambda:False,response_secret=b's'*32,creation_transport=writer)
   try:
    body=dict(requestId='create',orderId='831594aa-caae-42af-a009-ef7847a6b724',orderAlias='synthetic-runtime',preferredTime='2026-10-20T17:00:00Z',lines=[dict(item_id='panang-curry',qty=1,modifiers=[dict(id='chicken')]),dict(item_id='jasmine-rice',qty=1,modifiers=[])])
    req=Request('http://127.0.0.1:'+str(server.server_port)+'/staging/create-booking',data=json.dumps(body).encode(),headers={'Authorization':'Bearer '+'o'*32})
    with urlopen(req,timeout=5) as r:self.assertEqual(r.status,200)
    self.assertEqual(exercise(server,'o'*32,b's'*32,stream_id=STREAM)['httpCalls'],8)
    source=StagingEventSource(path,'2026-10-20',enabled=True,scope=SCOPE)
    try:
     self.assertEqual(source.db.execute('SELECT count(*) FROM outbox').fetchone()[0],6)
     self.assertEqual(source.db.execute('SELECT count(*) FROM bookings').fetchone()[0],0)
    finally:source.close()
   finally:server.shutdown();server.server_close();thread.join(timeout=2)
