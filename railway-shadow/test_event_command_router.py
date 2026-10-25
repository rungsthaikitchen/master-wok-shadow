import unittest
from event_capture_journal import EventCaptureError
from event_command_router import RoutedTransport,READ_QUERY,READ_SQL,APPLY_QUERY,APPLY_SQL,routed_response,routed_admin
from event_customer_response_staging import issue_token
from event_runtime_transport import ROLES

ROUTE='11111111-1111-1111-1111-111111111111'
ORIGIN='22222222-2222-2222-2222-222222222222'
SECRET=b'synthetic-router-signing-key-32-bytes'
DSN='postgresql://master_wok_event_reader_login:synthetic@db.hvrqgufqjslvgiohgkvu.supabase.co/postgres'

class CommandRouterTests(unittest.TestCase):
 def test_default_off_and_production_dsn_refused(self):
  self.assertEqual(RoutedTransport()({'query':'bad'})['sourceRequests'],0)
  self.assertEqual(routed_response(None,None,None)['sourceRequests'],0)
  with self.assertRaises(EventCaptureError):RoutedTransport(DSN.replace('hvrqgufqjslvgiohgkvu','ubyjrrsvbbqomitpaidb'),enabled=True)
 def test_authenticated_origin_is_bound_but_current_stream_is_never_client_selected(self):
  calls=[];token=issue_token(ORIGIN,'synthetic-order','offer-a',enabled=True,secret=SECRET)
  def transport(p):calls.append(p);return [dict(result='RECORDED')]
  self.assertEqual(routed_response('POST',dict(token=token,decision='accept'),ROUTE,enabled=True,secret=SECRET,transport=transport)['status'],'RECORDED')
  self.assertEqual(calls[0]['query'],APPLY_QUERY);p=calls[0]['parameters'];self.assertEqual(p[0],ROUTE);self.assertEqual(p[-1],ORIGIN);self.assertEqual(p[2:6],['synthetic-order','accept',None,'offer-a'])
  for body in (dict(token=token,decision='accept',streamId=ORIGIN),dict(token=token+'x',decision='accept')):
   with self.assertRaises(EventCaptureError):routed_response('POST',body,ROUTE,enabled=True,secret=SECRET,transport=lambda _:self.fail('request'))
 def test_read_only_packet_and_fixed_routed_write_queries(self):
  for kind in ('reader','writer'):
   calls=[];privileged=[False]
   class Cursor:
    index=0
    def __enter__(self):return self
    def __exit__(self,*a):pass
    def execute(self,q,p=None):calls.append((q,p))
    def fetchone(self):
     self.index+=1;return (ROLES[kind],False,False) if self.index==1 else (privileged[0],False,False)
    def fetchall(self):return [({'routeId':ROUTE},)] if kind=='reader' else [('RECORDED',)]
   class Conn:
    def __enter__(self):return self
    def __exit__(self,*a):pass
    def cursor(self):return Cursor()
   t=RoutedTransport(DSN.replace('_reader_','_'+kind+'_'),kind,enabled=True,connect=lambda **_:Conn())
   payload=dict(query=READ_QUERY,parameters=[ROUTE]) if kind=='reader' else dict(query=APPLY_QUERY,parameters=[ROUTE,'accept','synthetic-order','accept',None,'offer-a',ORIGIN])
   result=t(payload);self.assertEqual(calls[-1][0],READ_SQL if kind=='reader' else APPLY_SQL)
   if kind=='reader':self.assertEqual(calls[0][0],'SET TRANSACTION READ ONLY');self.assertEqual(result,[dict(packet={'routeId':ROUTE})])
   privileged[0]=True
   with self.assertRaisesRegex(EventCaptureError,'ROUTE_CONTROL_PRIVILEGES_REFUSED'):t(payload)
   with self.assertRaises(EventCaptureError):t(dict(query='DELETE FROM public.orders',parameters=[]))
 def test_raw_database_errors_are_sanitized(self):
  def fail(**_):raise RuntimeError('SECRET DSN')
  t=RoutedTransport(DSN,enabled=True,connect=fail)
  with self.assertRaisesRegex(EventCaptureError,'^STAGING_ROUTER_REQUEST_FAILED$'):t(dict(query=READ_QUERY,parameters=[ROUTE]))
 def test_confirmation_has_an_explicit_server_resolved_target_contract(self):
  calls=[]
  def transport(p):calls.append(p);return [dict(result='RECORDED')]
  self.assertEqual(routed_admin(ROUTE,'confirm','synthetic-order','confirm',enabled=True,transport=transport)['status'],'RECORDED')
  self.assertEqual(calls[0],dict(query=APPLY_QUERY,parameters=[ROUTE,'confirm','synthetic-order','confirm',None,None,None]))
  with self.assertRaises(EventCaptureError):routed_admin(ROUTE,'confirm','synthetic-order','confirm','2026-10-26T19:00:00Z',enabled=True,transport=transport)

if __name__=='__main__':unittest.main()
