import json
import unittest
from event_delivery_booking_transport import DeliveryBookingTransport
from event_booking_transport import CREATE_QUERY
from event_staging_handlers import QUERY
from event_capture_journal import EventCaptureError
from test_event_booking_transport import DSN,STREAM
from event_runtime_transport import ROLES
class DeliveryTransportTests(unittest.TestCase):
 def test_disabled_no_connection_and_explicit_trusted_planning(self):
  self.assertEqual(DeliveryBookingTransport()(None)['status'],'DISABLED')
  with self.assertRaises(EventCaptureError):DeliveryBookingTransport(DSN,enabled=True)
  with self.assertRaises(EventCaptureError):DeliveryBookingTransport(DSN.replace('hvrqgufqjslvgiohgkvu','production'),enabled=True,planning=lambda _:None)
 def test_fixed_sql_and_server_only_planning(self):
  calls=[];plan=dict(basis='synthetic-test')
  class Cursor:
   def __enter__(self):return self
   def __exit__(self,*a):pass
   def execute(self,q,p=None):calls.append((q,p))
   def fetchone(self):return (ROLES['writer'],False,False)
   def fetchall(self):return [('RECORDED',)]
  class Connection:
   def __enter__(self):return self
   def __exit__(self,*a):pass
   def cursor(self):return Cursor()
  t=DeliveryBookingTransport(DSN,enabled=True,planning=lambda rid:plan,connect=lambda **_:Connection())
  t(dict(query=CREATE_QUERY,parameters=[STREAM,'create','22222222-2222-2222-2222-222222222222','synthetic-a','2026-10-20T17:00:00Z',[]]))
  self.assertIn('create_delivery_booking',calls[-1][0]);self.assertEqual(json.loads(calls[-1][1][-1]),plan)
  cmd=dict(action='offer',orderId='synthetic-a',targetAt='2026-10-20T18:00:00Z',proposalEventId=None)
  t(dict(query=QUERY,parameters=[STREAM,'offer',cmd]));self.assertIn('apply_delivery_booking',calls[-1][0]);self.assertEqual(json.loads(calls[-1][1][-1]),plan)
  cmd.update(action='accept',targetAt=None,proposalEventId='offer')
  t(dict(query=QUERY,parameters=[STREAM,'accept',cmd]));self.assertIn('apply_booking',calls[-1][0]);self.assertNotIn('apply_delivery_booking',calls[-1][0])
  with self.assertRaises(EventCaptureError):t(dict(query='DELETE FROM public.orders',parameters=[]))
  cmd.update(action='confirm')
  with self.assertRaises(EventCaptureError):t(dict(query=QUERY,parameters=[STREAM,'confirm',cmd]))
