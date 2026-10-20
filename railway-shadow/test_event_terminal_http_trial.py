import json
from pathlib import Path
import tempfile
import unittest
from event_terminal_http_trial import main,TerminalBudget,exercise,STREAM
from event_booking_transport import CREATE_QUERY
from event_capture_journal import EventCaptureError,EventCaptureJournal
from event_runtime_http import serve_api
from event_source_staging import StagingEventSource,SCOPE
class TerminalTrialTests(unittest.TestCase):
 def test_default_off_scope_deadline_and_persistent_budget(self):
  main({})
  with self.assertRaises(EventCaptureError):main({'MASTER_WOK_TERMINAL_HTTP_TRIAL_ENABLED':'true'})
  with tempfile.TemporaryDirectory() as tmp:
   path=Path(tmp)/'budget.sqlite3';now=[1]
   b=TerminalBudget(path,5,clock=lambda:now[0]);calls=[]
   for _ in range(12):b.wrap('writer',calls.append)({})
   with self.assertRaises(EventCaptureError):TerminalBudget(path,5,clock=lambda:1).wrap('writer',calls.append)({})
   now[0]=5
   with self.assertRaises(EventCaptureError):b.wrap('reader',calls.append)({})
   self.assertEqual(len(calls),12);self.assertEqual(b.summary(),dict(reader=0,writer=12))
 def test_real_http_local_transactions_and_replay(self):
  with tempfile.TemporaryDirectory() as tmp:
   path=Path(tmp)/'synthetic-source.sqlite3';source=StagingEventSource(path,'2026-10-20',enabled=True,scope=SCOPE);source.close()
   receipts={};orders={}
   def writer(p):
    _,rid,*rest=p['parameters']
    if rid in receipts:
     self.assertEqual(receipts[rid],p);return [dict(result='ALREADY_RECORDED')]
    event=dict(eventId=rid,at='2026-10-20T07:00:00Z')
    if p['query']==CREATE_QUERY:
     _,rid,oid,alias,target,lines=p['parameters']
     orders[alias]=dict(orderId=alias,orderType='collection',targetAt=target,deliveryReadyEstimate=None,lines=[dict(itemId=l['item_id'],qty=l['qty'],mods=l['modifiers']) for l in lines])
     event.update(kind='RESERVATION_SET',commitment='PROPOSED',order=orders[alias])
    else:
     cmd=rest[0];alias=cmd['orderId']
     if cmd['action']=='offer':event.update(kind='BOOKING_DECISION',actualDecision='SUGGESTED',order=dict(orders[alias],targetAt=cmd['targetAt']))
     elif cmd['action'] in ('accept','reject'):event.update(kind='PROPOSAL_RESPONSE',orderId=alias,proposalEventId=cmd['proposalEventId'],response='REJECTED' if cmd['action']=='reject' else 'ACCEPTED')
     else:event.update(kind='ORDER_STATE_CHANGED',orderId=alias,status='CANCELLED' if cmd['action']=='cancel' else 'COMPLETED')
    local=StagingEventSource(path,'2026-10-20',enabled=True,scope=SCOPE)
    try:result=local.record(event)
    finally:local.close()
    receipts[rid]=p;return [dict(result=result)]
   budget=TerminalBudget(Path(tmp)/'budget.sqlite3',float('inf'))
   writer=budget.wrap('writer',writer)
   server,thread=serve_api(STREAM,'o'*32,'h'*32,writer,lambda:False,response_secret=b's'*32,creation_transport=writer)
   try:self.assertEqual(exercise(server,'o'*32,b's'*32)['httpCalls'],12)
   finally:server.shutdown();server.server_close();thread.join(timeout=2)
   source=StagingEventSource(path,'2026-10-20',enabled=True,scope=SCOPE)
   try:
    self.assertEqual(source.db.execute('SELECT count(*) FROM outbox').fetchone()[0],8)
    self.assertEqual(source.db.execute('SELECT count(*) FROM bookings').fetchone()[0],0)
    journal=EventCaptureJournal(Path(tmp)/'event-capture.sqlite3',source.identity,enabled=True)
    try:
     journal.enqueue(source.export('2026-10-20T07:00:00Z'))
     self.assertEqual(journal.run_once(enabled=True)['observations'],2)
    finally:journal.close()
   finally:source.close()
   self.assertEqual(budget.summary(),dict(reader=0,writer=12))
