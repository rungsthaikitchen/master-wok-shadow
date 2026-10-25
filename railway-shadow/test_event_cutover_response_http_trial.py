import contextlib
import io
import json
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch
from urllib.request import Request,urlopen
from urllib.error import HTTPError
from event_capture_journal import EventCaptureError
from event_cutover_response_transport import CutoverResponseTransport,SQL
from event_cutover_response_staging import QUERY
from event_customer_response_staging import issue_token
from event_runtime_http import serve_api
import event_cutover_response_http_trial as trial

DSN='postgresql://master_wok_event_writer_login:synthetic@db.hvrqgufqjslvgiohgkvu.supabase.co/postgres'

class CutoverHttpTests(unittest.TestCase):
 def env(self):
  e={k:'false' for k in (*trial.FLAGS,'MASTER_WOK_CUTOVER_TRIAL_ENABLED','MASTER_WOK_BACKEND_KEY_TRIAL_ENABLED','MASTER_WOK_KEY_COMPATIBILITY_ENABLED')}
  e.update(MASTER_WOK_CUTOVER_RESPONSE_HTTP_ENABLED='true',MASTER_WOK_CUTOVER_RESPONSE_HTTP_END_EPOCH='1500',RAILWAY_PROJECT_ID='7821ad5b-f5c2-4ab4-9206-c3d76eefd4c8',RAILWAY_ENVIRONMENT_ID='c1b8fad6-dbfc-4188-b4b5-a5dbfbf53279',RAILWAY_SERVICE_ID='012e5ef6-6225-4ab3-95f5-894583db7e83',MASTER_WOK_EVENT_RUNTIME_SCOPE='SYNTHETIC_STAGING_EVENTS',MASTER_WOK_EVENT_WRITER_DSN=DSN,MASTER_WOK_EVENT_READER_DSN=DSN.replace('_writer_','_reader_'))
  return e
 def test_disabled_never_inspects_credentials_or_constructs_client(self):
  with patch.object(trial,'connection_parameters',side_effect=AssertionError('credentials')),contextlib.redirect_stdout(io.StringIO()) as out:trial.main({})
  self.assertEqual(json.loads(out.getvalue())['sourceRequests'],0)
  self.assertEqual(CutoverResponseTransport()({'query':'anything'})['sourceRequests'],0)
 def test_scope_deadline_and_production_connection_refused(self):
  self.assertEqual(trial.configuration(self.env(),now=1000),1500)
  for key in ('RAILWAY_SERVICE_ID','MASTER_WOK_CUTOVER_TRIAL_ENABLED','MASTER_WOK_EVENT_RUNTIME_SCOPE'):
   e=self.env();e.pop(key)
   with self.subTest(key=key),self.assertRaises(EventCaptureError):trial.configuration(e,now=1000)
  for value in ('1000','1601','nan','inf'):
   e=self.env();e['MASTER_WOK_CUTOVER_RESPONSE_HTTP_END_EPOCH']=value
   with self.assertRaises(EventCaptureError):trial.configuration(e,now=1000)
  e=self.env();e['MASTER_WOK_EVENT_WRITER_DSN']=DSN.replace('hvrqgufqjslvgiohgkvu','ubyjrrsvbbqomitpaidb')
  with self.assertRaisesRegex(EventCaptureError,'STAGING_DATABASE_CONNECTION_REQUIRED'):trial.configuration(e,now=1000)
 def test_fixed_query_role_and_admin_receipt_privilege_checks(self):
  calls=[];privileged=[False]
  class Cursor:
   index=0
   def __enter__(self):return self
   def __exit__(self,*a):pass
   def execute(self,q,p=None):calls.append((q,p))
   def fetchone(self):
    self.index+=1;return ('master_wok_event_writer_login',False,False) if self.index==1 else (privileged[0],False,False)
   def fetchall(self):return [('RECORDED',)]
  class Conn:
   def __enter__(self):return self
   def __exit__(self,*a):pass
   def cursor(self):return Cursor()
  transport=CutoverResponseTransport(DSN,enabled=True,connect=lambda **_:Conn())
  p=[trial.SOURCE,trial.DESTINATION,trial.CUTOVER,'reply',trial.ALIAS,'accept','offer-a']
  self.assertEqual(transport(dict(query=QUERY,parameters=p)),[dict(result='RECORDED')]);self.assertEqual(calls[-1],(SQL,p))
  privileged[0]=True
  with self.assertRaisesRegex(EventCaptureError,'CUTOVER_ATTESTATION_PRIVILEGES_REFUSED'):transport(dict(query=QUERY,parameters=p))
  privileged[0]=False
  with self.assertRaises(EventCaptureError):transport(dict(query='DELETE FROM public.orders',parameters=p))
  def fail(**_):raise RuntimeError('SECRET')
  transport=CutoverResponseTransport(DSN,enabled=True,connect=fail)
  with self.assertRaisesRegex(EventCaptureError,'^STAGING_CUTOVER_RESPONSE_FAILED$'):transport(dict(query=QUERY,parameters=p))
 def test_start_once_and_deadline_budget_survive_restart(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp)/'budget.sqlite3';b=trial.Budget(p,2000,clock=lambda:1000);b.take('started')
   with self.assertRaises(EventCaptureError):trial.Budget(p,2000,clock=lambda:1000).take('started')
   for _ in range(8):b.take('write')
   with self.assertRaises(EventCaptureError):b.take('write')
   with self.assertRaises(EventCaptureError):trial.Budget(p,2000,clock=lambda:2000).take('read')
 def test_private_route_absent_by_default_and_rejects_duplicate_json_before_callback(self):
  seen=[];operator='o'*32;health='h'*32
  def callback(body):seen.append(body);return dict(status='RECORDED',verified=False)
  for enabled in (False,True):
   server,thread=serve_api(trial.DESTINATION,operator,health,lambda _:None,lambda:False,cutover_response=callback if enabled else None)
   try:
    url='http://127.0.0.1:'+str(server.server_port)+'/staging/cutover-proposal-response'
    req=Request(url,data=b'{"token":"a","token":"b","decision":"accept"}',headers={'Authorization':'Bearer '+operator})
    with self.assertRaises(HTTPError) as error:urlopen(req,timeout=5)
    self.assertEqual(error.exception.code,409 if enabled else 404);self.assertEqual(seen,[])
   finally:server.shutdown();server.server_close();thread.join(timeout=2)

if __name__=='__main__':unittest.main()
