import contextlib
import io
import json
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch
from urllib.request import Request,urlopen
from urllib.error import HTTPError
from event_capture_journal import EventCaptureError
from event_runtime_http import serve_api
import event_checkout_trial as trial
from event_checkout_transport import CheckoutTransport,QUERY,SQL,PRIVILEGES,submit

DSN='postgresql://master_wok_event_writer_login:synthetic@db.hvrqgufqjslvgiohgkvu.supabase.co/postgres'
class CheckoutTests(unittest.TestCase):
 def env(self):
  e={k:'false' for k in (*trial.FLAGS,*trial.EXTRA_FLAGS)}
  e.update(MASTER_WOK_CHECKOUT_TRIAL_ENABLED='true',MASTER_WOK_CHECKOUT_TRIAL_END_EPOCH='1500',RAILWAY_PROJECT_ID='7821ad5b-f5c2-4ab4-9206-c3d76eefd4c8',RAILWAY_ENVIRONMENT_ID='c1b8fad6-dbfc-4188-b4b5-a5dbfbf53279',RAILWAY_SERVICE_ID='012e5ef6-6225-4ab3-95f5-894583db7e83',MASTER_WOK_EVENT_RUNTIME_SCOPE='SYNTHETIC_STAGING_EVENTS',MASTER_WOK_EVENT_WRITER_DSN=DSN,MASTER_WOK_EVENT_READER_DSN=DSN.replace('_writer_','_reader_'))
  return e
 def test_default_off_never_constructs_connection_or_reads_body(self):
  with patch.object(trial,'connection_parameters',side_effect=AssertionError()),contextlib.redirect_stdout(io.StringIO()) as out:trial.main({})
  self.assertEqual(json.loads(out.getvalue())['sourceRequests'],0)
  self.assertEqual(CheckoutTransport()({})['sourceRequests'],0);self.assertEqual(submit(None,None)['sourceRequests'],0)
 def test_other_runners_wrong_scope_and_deadline_refused(self):
  self.assertEqual(trial.configuration(self.env(),now=1000)[0],1500)
  for key in ('MASTER_WOK_COMMAND_ROUTE_TRIAL_ENABLED','MASTER_WOK_EVENT_RUNTIME_SCOPE','RAILWAY_SERVICE_ID'):
   e=self.env();e.pop(key)
   with self.assertRaises(EventCaptureError):trial.configuration(e,now=1000)
  for value in ('1000','1601','nan','inf'):
   e=self.env();e['MASTER_WOK_CHECKOUT_TRIAL_END_EPOCH']=value
   with self.assertRaises(EventCaptureError):trial.configuration(e,now=1000)
  e=self.env();e['MASTER_WOK_EVENT_WRITER_DSN']=DSN.replace('hvrqgufqjslvgiohgkvu','ubyjrrsvbbqomitpaidb')
  with self.assertRaises(EventCaptureError):trial.configuration(e,now=1000)
 def test_fixed_parameters_role_and_quote_control_privileges_checked(self):
  calls=[];priv=[False]
  class Rows:
   def __init__(self,row):self.row=row
   def fetchone(self):return self.row
   def fetchall(self):return [self.row]
  class Conn:
   def __enter__(self):return self
   def __exit__(self,*a):pass
   def execute(self,q,p=None):
    calls.append((q,p))
    if q==PRIVILEGES:return Rows((priv[0],False,False,False))
    if q==SQL:return Rows(('RECORDED',))
    return Rows(('master_wok_event_writer_login',False,False))
  f=trial.CASES[0];p=trial.args(f);p[4]=f['checkout'];transport=CheckoutTransport(DSN,enabled=True,connect=lambda **_:Conn())
  self.assertEqual(transport(dict(query=QUERY,parameters=p)),[dict(result='RECORDED')]);self.assertEqual(calls[-1][0],SQL);self.assertEqual(json.loads(calls[-1][1][4]),f['checkout'])
  priv[0]=True
  with self.assertRaisesRegex(EventCaptureError,'CONTROL_PRIVILEGES'):transport(dict(query=QUERY,parameters=p))
  with self.assertRaises(EventCaptureError):transport(dict(query='DELETE FROM public.orders',parameters=p))
  def fail(**_):raise RuntimeError('PRIVATE_CREDENTIAL_DIAGNOSTIC')
  with self.assertRaisesRegex(EventCaptureError,'^STAGING_CHECKOUT_REQUEST_FAILED$'):CheckoutTransport(DSN,enabled=True,connect=fail)(dict(query=QUERY,parameters=p))
 def test_start_and_operation_budgets_survive_restart(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp)/'attempts.sqlite3';b=trial.Budget(p,2000,clock=lambda:1000);b.take('started')
   with self.assertRaises(EventCaptureError):trial.Budget(p,2000,clock=lambda:1000).take('started')
   for _ in range(20):b.take('write')
   with self.assertRaises(EventCaptureError):b.take('write')
   with self.assertRaises(EventCaptureError):trial.Budget(p,2000,clock=lambda:2000).take('read')
 def test_new_http_route_absent_by_default_and_duplicate_keys_do_not_call_callback(self):
  seen=[]
  for enabled in (False,True):
   server,thread=serve_api(trial.CASES[0]['stream'],'o'*32,'h'*32,lambda _:None,lambda:False,checkout_submission=(lambda b:seen.append(b)) if enabled else None)
   try:
    req=Request('http://127.0.0.1:'+str(server.server_port)+'/staging/submit-checkout',data=b'{"requestId":"a","requestId":"b"}',headers={'Authorization':'Bearer '+'o'*32})
    with self.assertRaises(HTTPError) as e:urlopen(req,timeout=5)
    self.assertEqual(e.exception.code,409 if enabled else 404);self.assertEqual(seen,[])
   finally:server.shutdown();server.server_close();thread.join(timeout=2)
 def test_real_node_adapter_http_commit_without_success_then_exact_retry(self):
  f=trial.CASES[-1];commands={};seen=[];lost=[False]
  def transport(payload):
   seen.append(payload);rid=payload['parameters'][1];result='ALREADY_RECORDED' if rid in commands else 'RECORDED';commands[rid]=True;return [dict(result=result)]
  def callback(body):
   result=submit(body,f['route'],enabled=True,transport=transport)
   if result['status']=='RECORDED' and not lost[0]:lost[0]=True;raise EventCaptureError('INJECTED_AFTER_COMMIT')
   return result
  server,thread=serve_api(f['stream'],'o'*32,'h'*32,lambda _:None,lambda:False,checkout_submission=callback)
  try:
   data=dict(url='http://127.0.0.1:'+str(server.server_port),operator='o'*32,deadline=time.time()+30,fixtures=[f,trial.DELIVERY])
   script=Path(trial.__file__).resolve().parent.parent/'staging-events/checkout-submission-http-exercise.cjs'
   r=subprocess.run(['node',str(script)],input=json.dumps(data),text=True,capture_output=True,timeout=35)
   self.assertEqual(r.returncode,0,r.stderr);self.assertEqual(json.loads(r.stdout),dict(status='PASSED',httpCalls=7,lostSuccessResponseRetried=True));self.assertEqual(len(seen),4);self.assertEqual(len(commands),2)
   self.assertEqual(seen[0],seen[1]);self.assertEqual(seen[2],seen[3])
  finally:server.shutdown();server.server_close();thread.join(timeout=2)
 def test_checkout_body_limit_allows_larger_baskets_but_remains_bounded(self):
  seen=[];f=trial.CASES[-1]
  def callback(body):seen.append(body);return dict(status='RECORDED')
  server,thread=serve_api(f['stream'],'o'*32,'h'*32,lambda _:None,lambda:False,checkout_submission=callback)
  try:
   url='http://127.0.0.1:'+str(server.server_port)+'/staging/submit-checkout';headers={'Authorization':'Bearer '+'o'*32}
   body=dict(requestId=f['request'],orderId=f['order'],quoteId=f['quote'],checkout=f['checkout'])
   with urlopen(Request(url,data=(' '*9000+json.dumps(body)).encode(),headers=headers),timeout=5) as r:self.assertEqual(r.status,200)
   with self.assertRaises(HTTPError) as e:urlopen(Request(url,data=b'x'*100513,headers=headers),timeout=5)
   self.assertEqual(e.exception.code,409);self.assertEqual(seen,[body])
  finally:server.shutdown();server.server_close();thread.join(timeout=2)

if __name__=='__main__':unittest.main()
