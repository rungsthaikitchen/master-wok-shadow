import unittest
from event_staging_handlers import admin_action,customer_response,QUERY
from event_capture_journal import EventCaptureError
ID='11111111-1111-1111-1111-111111111111'
class HandlerTests(unittest.TestCase):
 def test_default_off_and_invalid_routes_never_call_transport(self):
  refuse=lambda _:self.fail('invalid input called transport')
  self.assertEqual(admin_action(transport=refuse)['status'],'DISABLED')
  self.assertEqual(customer_response(transport=refuse)['status'],'DISABLED')
  for args in [dict(action='offer'),dict(action='mark_paid'),dict(action='cancel',target_at='2026-10-19T17:00:00Z'),dict(action='confirm',target_at='2026-10-19T17:00:00Z',project='production')]:
   with self.assertRaises(EventCaptureError):admin_action(ID,'request','synthetic-a',enabled=True,transport=refuse,**args)
  with self.assertRaises(EventCaptureError):customer_response(ID,'request','synthetic-a','accept',None,enabled=True,transport=refuse)
 def test_fixed_commands_and_retry_result(self):
  calls=[]
  def transport(p):calls.append(p);return [dict(result='RECORDED')]
  self.assertEqual(admin_action(ID,'offer1','synthetic-a','offer','2026-10-19T18:00:00Z',enabled=True,transport=transport)['status'],'RECORDED')
  self.assertEqual(calls[0],dict(query=QUERY,parameters=[ID,'offer1',dict(action='offer',orderId='synthetic-a',targetAt='2026-10-19T18:00:00Z',proposalEventId=None)]))
  self.assertEqual(customer_response(ID,'reply','synthetic-a','accept','offer1',enabled=True,transport=lambda p:[dict(result='ALREADY_RECORDED')])['status'],'ALREADY_RECORDED')
 def test_unexpected_backend_result_refused(self):
  with self.assertRaises(EventCaptureError):admin_action(ID,'request','synthetic-a','confirm','2026-10-19T18:00:00Z',enabled=True,transport=lambda p:[dict(result='UNKNOWN')])
