import unittest
from event_capture_journal import EventCaptureError
from event_customer_response_staging import issue_token,respond
from event_cutover_response_staging import respond_after_cutover,QUERY

OLD='11111111-1111-1111-1111-111111111111'
NEW='22222222-2222-2222-2222-222222222222'
OTHER='33333333-3333-3333-3333-333333333333'
SECRET=b'local-synthetic-cutover-signing-key'

class CutoverResponseTests(unittest.TestCase):
 def body(self,stream=OLD):return dict(token=issue_token(stream,'synthetic-order','offer-a',enabled=True,secret=SECRET),decision='accept')
 def answer(self,body,transport):return respond_after_cutover('POST',body,OLD,NEW,'baseline',enabled=True,secret=SECRET,transport=transport)
 def test_disabled_never_reads_route_or_credentials(self):
  self.assertEqual(respond_after_cutover(None,None,None,None,None)['sourceRequests'],0)
 def test_original_adapter_refuses_old_token_after_naive_stream_switch(self):
  with self.assertRaisesRegex(EventCaptureError,'RESPONSE_TOKEN_REFUSED'):
   respond('POST',self.body(),NEW,enabled=True,secret=SECRET,transport=lambda _:self.fail('network'))
 def test_compatibility_keeps_signed_revision_and_stable_request_id(self):
  calls=[]
  def transport(p):calls.append(p);return [dict(result='RECORDED' if len(calls)==1 else 'ALREADY_RECORDED')]
  body=self.body()
  self.assertEqual(self.answer(body,transport)['status'],'RECORDED')
  self.assertEqual(self.answer(body,transport)['status'],'ALREADY_RECORDED')
  self.assertEqual(calls[0],calls[1]);self.assertEqual(calls[0]['query'],QUERY)
  p=calls[0]['parameters'];self.assertEqual(p[:3],[OLD,NEW,'baseline']);self.assertTrue(p[3].startswith('reply_'))
  self.assertEqual(p[4:],['synthetic-order','accept','offer-a'])
 def test_body_route_override_and_unrelated_tokens_refused_before_transport(self):
  for body in (dict(self.body(),destination=OTHER),self.body(OTHER),dict(self.body(),decision='complete')):
   with self.subTest(body=body),self.assertRaises(EventCaptureError):self.answer(body,lambda _:self.fail('network'))
  with self.assertRaises(EventCaptureError):respond_after_cutover('POST',self.body(),OLD,NEW,'baseline',enabled=True,project='production',secret=SECRET,transport=lambda _:self.fail('network'))
 def test_database_failure_cannot_be_reported_as_success(self):
  def fail(_):raise EventCaptureError('CUTOVER_ROUTE_UNPROVEN')
  with self.assertRaisesRegex(EventCaptureError,'CUTOVER_ROUTE_UNPROVEN'):self.answer(self.body(),fail)

if __name__=='__main__':unittest.main()
