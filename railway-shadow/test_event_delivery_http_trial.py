import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from datetime import datetime,timezone
from event_delivery_http_trial import main,prepare,exercise,DeliveryBudget,STREAM
from event_booking_transport import CREATE_QUERY
from event_runtime_http import serve_api
from event_source_staging import StagingEventSource,SCOPE
from event_capture_journal import EventCaptureError,EventCaptureJournal
def prepared(root):
 with patch('event_delivery_http_trial.datetime') as clock:
  clock.now.return_value=datetime(2026,10,20,12,tzinfo=timezone.utc)
  return prepare(root)

class DeliveryTrialTests(unittest.TestCase):
 def test_default_off_prepare_evidence_and_persistent_cap(self):
  main({})
  with self.assertRaises(EventCaptureError):main({'MASTER_WOK_DELIVERY_HTTP_TRIAL_ENABLED':'true'})
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);plans=prepared(root);self.assertEqual(len(plans),3)
   with self.assertRaises(EventCaptureError):prepared(root)
   b=DeliveryBudget(root/'budget.sqlite3',float('inf'))
   for _ in range(10):b.wrap('writer',lambda _:None)({})
   with self.assertRaises(EventCaptureError):DeliveryBudget(b.path,float('inf')).wrap('writer',lambda _:None)({})
 def test_real_planner_loopback_and_local_transaction_replay(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);plans=prepared(root);path=root/'synthetic-source.sqlite3';s=StagingEventSource(path,'2026-10-20',enabled=True,scope=SCOPE);s.close()
   receipts={};orders={}
   def writer(p):
    _,rid,*rest=p['parameters']
    if rid in receipts:
     self.assertEqual(receipts[rid],p);return [dict(result='ALREADY_RECORDED')]
    event=dict(eventId=rid,at='2026-10-20T12:00:00+00:00')
    if p['query']==CREATE_QUERY:
     _,rid,oid,alias,target,lines=p['parameters'];order=dict(orderId=alias,orderType='delivery',targetAt=target,lines=[dict(itemId=l['item_id'],qty=l['qty'],mods=l['modifiers']) for l in lines],deliveryReadyEstimate=plans[rid]['estimate'])
     orders[alias]=copy.deepcopy(order);event.update(kind='RESERVATION_SET',commitment='PROPOSED',order=order)
    else:
     cmd=rest[0];alias=cmd['orderId'];action=cmd['action']
     if action=='offer':event.update(kind='BOOKING_DECISION',actualDecision='SUGGESTED',order=dict(orders[alias],targetAt=cmd['targetAt'],deliveryReadyEstimate=plans.get(rid,{}).get('estimate')))
     elif action in ('accept','reject'):event.update(kind='PROPOSAL_RESPONSE',orderId=alias,proposalEventId=cmd['proposalEventId'],response='ACCEPTED' if action=='accept' else 'REJECTED')
     else:event.update(kind='RESERVATION_RELEASED',orderId=alias,reason='COMPLETED')
    local=StagingEventSource(path,'2026-10-20',enabled=True,scope=SCOPE)
    try:result=local.record(event)
    finally:local.close()
    receipts[rid]=p;return [dict(result=result)]
   budget=DeliveryBudget(root/'budget.sqlite3',float('inf'));writer=budget.wrap('writer',writer)
   server,thread=serve_api(STREAM,'o'*32,'h'*32,writer,lambda:False,response_secret=b's'*32,creation_transport=writer)
   try:self.assertEqual(exercise(server,'o'*32,b's'*32),10)
   finally:server.shutdown();server.server_close();thread.join(timeout=2)
   s=StagingEventSource(path,'2026-10-20',enabled=True,scope=SCOPE)
   try:
    batch=s.export('2026-10-20T12:00:00+00:00');self.assertEqual(len(batch['events']),6);self.assertEqual(s.db.execute('SELECT count(*) FROM bookings').fetchone()[0],0)
    j=EventCaptureJournal(root/'event-capture.sqlite3',s.identity,enabled=True)
    try:j.enqueue(batch);self.assertEqual(j.run_once(enabled=True)['observations'],3)
    finally:j.close()
   finally:s.close()
   self.assertEqual(budget.summary(),dict(reader=0,writer=10))
