import json
from pathlib import Path
import tempfile
import unittest
from urllib.request import Request,urlopen
from urllib.error import HTTPError
from event_capture_journal import EventCaptureJournal,EventCaptureError
from event_runtime_transport import DatabaseTransport,connection_parameters,ROLES
from event_runtime_http import serve_api
from event_runtime_staging import Budget,Monitor,cycle,configuration
from event_postgres_export import source_identity,QUERY,PROJECT
from event_staging_handlers import QUERY as WRITE_QUERY
from event_source_staging import StagingEventSource,SCOPE
from test_event_capture_journal import fixture
ID='11111111-1111-1111-1111-111111111111'
def dsn(kind):return 'postgresql://'+ROLES[kind]+':synthetic-password@db.'+PROJECT+'.supabase.co:5432/postgres'

class RuntimeTests(unittest.TestCase):
 def test_configuration_disabled_and_production_or_unsafe_connections_refused(self):
  self.assertIsNone(configuration({}))
  with self.assertRaises(EventCaptureError):configuration(dict(MASTER_WOK_EVENT_RUNTIME_ENABLED='true'))
  params=connection_parameters(dsn('reader'),'reader');self.assertEqual(params['sslmode'],'verify-full')
  import psycopg.conninfo
  self.assertIn('sslmode=verify-full',psycopg.conninfo.make_conninfo(**params))
  for bad in [dsn('reader').replace(PROJECT,'production'),dsn('reader')+'?sslmode=disable',dsn('writer'),dsn('reader').replace('postgresql:','http:')]:
   with self.assertRaises(EventCaptureError):connection_parameters(bad,'reader')
 def test_request_budgets_survive_restart_and_count_failed_requests(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp)/'budget.sqlite3';b=Budget(p,source_identity(ID))
   def fail(_):raise RuntimeError('failed source')
   for _ in range(2):
    with self.assertRaises(RuntimeError):b.transport('reader',fail)({})
   b=Budget(p,source_identity(ID))
   with self.assertRaises(EventCaptureError):b.take('reader')
   for _ in range(3):b.take('writer')
   with self.assertRaises(EventCaptureError):b.take('writer')
   with self.assertRaises(EventCaptureError):Budget(p,'wrong-identity')
 def test_database_transport_role_query_binding_and_error_redaction(self):
  calls=[]
  class Cursor:
   def __enter__(self):return self
   def __exit__(self,*_):pass
   def execute(self,q,p=None):calls.append((q,p))
   def fetchone(self):
    return (ROLES['reader'],False,False) if 'pg_roles' in calls[-1][0] else (False,False)
   def fetchall(self):return [(ID,'SYNTHETIC_STAGING_EVENTS',1,{'events':[]})]
  class Connection:
   def __enter__(self):return self
   def __exit__(self,*_):pass
   def cursor(self):return Cursor()
  transport=DatabaseTransport(dsn('reader'),'reader',connect=lambda **_:Connection())
  self.assertEqual(transport(dict(query=QUERY,parameters=[ID]))[0]['stream_id'],ID)
  self.assertEqual(calls[0][0],'SET TRANSACTION READ ONLY');self.assertEqual(calls[-1][1],[ID])
  with self.assertRaises(EventCaptureError):transport(dict(query=WRITE_QUERY,parameters=[]))
  def fail(**_):raise RuntimeError('SECRET-DSN')
  with self.assertRaises(EventCaptureError) as result:DatabaseTransport(dsn('reader'),'reader',connect=fail)(dict(query=QUERY,parameters=[ID]))
  self.assertNotIn('SECRET',str(result.exception))
 def test_authenticated_http_to_source_to_poll_replay_and_health(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);source_path=root/'synthetic-source.sqlite3'
   source=StagingEventSource(source_path,'2026-10-17',enabled=True,scope=SCOPE)
   first=fixture()['events'][0];first.pop('sequence');source.record(first)
   ticks=iter(['2026-10-17T15:00:00Z','2026-10-17T15:01:00Z'])
   calls=[]
   def writer(p):
    calls.append(p);_,rid,cmd=p['parameters'];event=dict(eventId=rid,at=next(ticks),kind='PROPOSAL_RESPONSE',orderId=cmd['orderId'],proposalEventId=cmd['proposalEventId'],response='ACCEPTED')
    if cmd['action']=='offer':
     order=first['order'].copy();order['targetAt']=cmd['targetAt']
     event=dict(eventId=rid,at=event['at'],kind='BOOKING_DECISION',actualDecision='SUGGESTED',order=order)
    local=StagingEventSource(source_path,'2026-10-17',enabled=True,scope=SCOPE)
    try:return [dict(result=local.record(event))]
    finally:local.close()
   now=[1000];monitor=Monitor(clock=lambda:now[0]);server,thread=serve_api(ID,'o'*32,'h'*32,writer,monitor.healthy)
   base='http://127.0.0.1:'+str(server.server_port)
   def request(path,token,body=None):
    return urlopen(Request(base+path,data=None if body is None else json.dumps(body).encode(),headers={'Authorization':'Bearer '+token}),timeout=5)
   try:
    with self.assertRaises(HTTPError) as unauthorized:request('/staging/admin-action','wrong',{})
    self.assertEqual(unauthorized.exception.code,401);self.assertEqual(calls,[])
    with self.assertRaises(HTTPError) as unhealthy:request('/healthz','h'*32)
    self.assertEqual(unhealthy.exception.code,503)
    with request('/staging/admin-action','o'*32,dict(requestId='http-offer',orderId='synthetic-a',action='offer',targetAt='2026-10-17T19:00:00Z')) as r:self.assertEqual(r.status,200)
    with request('/staging/customer-response','o'*32,dict(requestId='http-accept',orderId='synthetic-a',response='accept',proposalEventId='http-offer')) as r:self.assertEqual(r.status,200)
    def reader(_):return [dict(stream_id=ID,scope='SYNTHETIC_STAGING_EVENTS',event_count=3,batch=source.export('2026-10-17T15:01:00Z'))]
    j=EventCaptureJournal(root/'event-capture.sqlite3',source_identity(ID),enabled=True)
    try:
     self.assertEqual(cycle(j,ID,reader,monitor,root)['observations'],1)
     with request('/healthz','h'*32) as r:self.assertEqual(r.status,200)
     self.assertEqual(cycle(j,ID,reader,monitor,root)['intake'],'ALREADY_QUEUED')
     now[0]+=181;self.assertFalse(monitor.healthy())
     result=cycle(j,ID,lambda _:[],monitor,root)
     self.assertEqual(result['status'],'UNVERIFIED');self.assertFalse(monitor.healthy())
    finally:j.close()
   finally:server.shutdown();server.server_close();thread.join(timeout=2);source.close()
