import json
import unittest
from event_capture_journal import EventCaptureError
from event_booking_transport import BookingTransport,CREATE_QUERY
from event_staging_handlers import QUERY
from event_runtime_transport import ROLES
DSN='postgresql://'+ROLES['writer']+':synthetic-password@db.hvrqgufqjslvgiohgkvu.supabase.co:5432/postgres'
STREAM='11111111-1111-1111-1111-111111111111'
class BookingTransportTests(unittest.TestCase):
 def test_fixed_parameterized_queries_and_writer_role(self):
  calls=[]
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
  transport=BookingTransport(DSN,connect=lambda **_:Connection())
  lines=[dict(item_id='panang-curry',qty=1,modifiers=[])]
  transport(dict(query=CREATE_QUERY,parameters=[STREAM,'create','22222222-2222-2222-2222-222222222222','synthetic-a','2026-10-20T17:00:00Z',lines]))
  self.assertEqual(json.loads(calls[-1][1][-1]),lines)
  self.assertNotIn('panang-curry',calls[-1][0])
  transport(dict(query=QUERY,parameters=[STREAM,'accept',dict(action='accept',orderId='synthetic-a',targetAt=None,proposalEventId='offer1')]))
  self.assertEqual(calls[-1][1],[STREAM,'accept',STREAM,'synthetic-a','accept',None,'offer1'])
 def test_query_production_dsn_and_raw_errors_are_refused(self):
  with self.assertRaises(EventCaptureError):BookingTransport(DSN.replace('hvrqgufqjslvgiohgkvu','production'))
  def fail(**_):raise RuntimeError('SECRET-CONNECTION')
  transport=BookingTransport(DSN,connect=fail)
  with self.assertRaises(EventCaptureError):transport(dict(query='DELETE FROM public.orders',parameters=[]))
  with self.assertRaises(EventCaptureError) as error:transport(dict(query=CREATE_QUERY,parameters=[STREAM,'a','b','synthetic-a','c',[]]))
  self.assertNotIn('SECRET',str(error.exception))
