import hashlib
import hmac
import http.client
import json
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime,timezone
from pathlib import Path
from unittest.mock import patch
import preview_browser_receiver as p

KEY=bytes.fromhex('01'*32)  # Synthetic protocol fixture only, never a deployment key.
def envelope(operation='state',input=None,issued=1000):
 body=json.dumps(dict(version=1,issuedAt=issued,actorId='a'*64,operation=operation,input=input or dict(orderId=p.FIXTURE['orderId'])),separators=(',',':'))
 return dict(body=body,tag=hmac.new(KEY,body.encode(),hashlib.sha256).hexdigest())
def command():return dict(version=1,commandId='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',orderId=p.FIXTURE['orderId'],expectedRevision=2,action='offer',target=p.FIXTURE['targets'][2])
class Counter:
 def __init__(self):self.calls=[]
 def take(self,kind):self.calls.append(kind)
class Connection:
 def __init__(self,result):self.result=result;self.queries=[];self.committed=False;self.rolled_back=False
 def __enter__(self):return self
 def __exit__(self,kind,*_):self.committed=kind is None;self.rolled_back=kind is not None
 def execute(self,query,params=None):self.queries.append((query,params));return self
 def fetchone(self):return self.result

class Tests(unittest.TestCase):
 def receiver(self,result=None):
  counter=Counter();conn=Connection(result or ('proposed',datetime.fromisoformat(p.FIXTURE['targets'][1].replace('Z','+00:00')),2));opens=[]
  def connect(**kwargs):opens.append(kwargs);return conn
  receiver=p.Receiver(dict(key=KEY,deadline=1600,reader={'user':'test-reader'},writer={'user':'test-writer'}),counter,connect=connect,clock=lambda:1000)
  return receiver,counter,conn,opens
 def test_disabled_does_not_inspect_connection_or_start_http(self):
  self.assertIsNone(p.configuration({}))
  with patch.object(p,'serve',side_effect=AssertionError('HTTP opened')),patch.object(p,'connection_parameters',side_effect=AssertionError('DSN read')):p.main({})
 def test_diagnostic_reason_codes_never_copy_database_or_secret_messages(self):
  self.assertEqual(p.safe_reason(p.EventCaptureError('PREVIEW_SERVER_KEY_REQUIRED')),'PREVIEW_SERVER_KEY_REQUIRED')
  for error in [Exception('PRIVATE secret DSN'),p.EventCaptureError('PRIVATE secret DSN')]:self.assertEqual(p.safe_reason(error),'PREVIEW_RECEIVER_FAILED')
 def test_private_diagnostic_reads_budget_without_consuming_or_enabling_it(self):
  with tempfile.TemporaryDirectory() as directory:
   directory=Path(directory);budget=p.Budget(directory/'budget.sqlite3',1600,clock=lambda:1000);budget.take('started');before=budget.summary()
   conn=Connection((2,False));cfg=dict(reader={'user':'test-reader'})
   with patch.object(p,'connection_configuration',return_value=cfg),patch.object(p,'role_check'),patch.object(p,'serve',side_effect=AssertionError('HTTP opened')):
    result=p.diagnose({'MASTER_WOK_PREVIEW_BROWSER_ENABLED':'false'},connect=lambda **_:conn,clock=lambda:1000,directory=directory)
   self.assertEqual(result['fixtureEnabled'],False);self.assertEqual(result['budget'],{'started':1});self.assertEqual(budget.summary(),before);self.assertEqual(conn.queries[0][0],'SET TRANSACTION READ ONLY')
   with self.assertRaises(p.EventCaptureError):p.diagnose({'MASTER_WOK_PREVIEW_BROWSER_ENABLED':'true'})
 def test_expired_trial_can_be_diagnosed_but_cannot_be_started(self):
  env=dict(MASTER_WOK_PREVIEW_BROWSER_ENABLED='false',MASTER_WOK_PREVIEW_BROWSER_END_EPOCH='1',MASTER_WOK_PREVIEW_HOP_KEY=KEY.hex(),RAILWAY_PROJECT_ID='7821ad5b-f5c2-4ab4-9206-c3d76eefd4c8',RAILWAY_ENVIRONMENT_ID='c1b8fad6-dbfc-4188-b4b5-a5dbfbf53279',RAILWAY_SERVICE_ID='012e5ef6-6225-4ab3-95f5-894583db7e83',MASTER_WOK_EVENT_RUNTIME_SCOPE='SYNTHETIC_STAGING_EVENTS')
  with tempfile.TemporaryDirectory() as directory,patch.object(p,'connection_parameters',side_effect=lambda _,kind:dict(kind=kind)),patch.object(p,'role_check'),patch.object(p,'serve',side_effect=AssertionError('HTTP opened')):
   conn=Connection((2,False));before=dict(env)
   result=p.diagnose(env,connect=lambda **_:conn,clock=lambda:p.END_LIMIT+86400,directory=Path(directory))
   self.assertEqual(result['budget'],None);self.assertEqual(env,before);self.assertEqual(conn.queries[0][0],'SET TRANSACTION READ ONLY')
   self.assertFalse((Path(directory)/'budget.sqlite3').exists())
   with self.assertRaises(p.EventCaptureError):p.configuration(dict(env,MASTER_WOK_PREVIEW_BROWSER_ENABLED='true'),p.END_LIMIT+86400)
   for bad in [dict(RAILWAY_ENVIRONMENT_ID='production'),dict(MASTER_WOK_EVENT_RUNTIME_ENABLED='true')]:
    with self.assertRaises(p.EventCaptureError):p.diagnose(dict(env,**bad),connect=lambda **_:self.fail('connection opened'),directory=Path(directory))
 def test_configuration_pins_environment_fresh_deadline_and_other_flags(self):
  env=dict(MASTER_WOK_PREVIEW_BROWSER_ENABLED='true',MASTER_WOK_PREVIEW_BROWSER_END_EPOCH='1600',MASTER_WOK_PREVIEW_HOP_KEY=KEY.hex(),RAILWAY_PROJECT_ID='7821ad5b-f5c2-4ab4-9206-c3d76eefd4c8',RAILWAY_ENVIRONMENT_ID='c1b8fad6-dbfc-4188-b4b5-a5dbfbf53279',RAILWAY_SERVICE_ID='012e5ef6-6225-4ab3-95f5-894583db7e83',MASTER_WOK_EVENT_RUNTIME_SCOPE='SYNTHETIC_STAGING_EVENTS')
  with patch.object(p,'connection_parameters',side_effect=lambda d,k:dict(kind=k)):
   self.assertEqual(p.configuration(env,1000)['deadline'],1600)
   for bad in [dict(RAILWAY_ENVIRONMENT_ID='production'),dict(MASTER_WOK_PREVIEW_BROWSER_END_EPOCH='1601'),dict(MASTER_WOK_PREVIEW_BROWSER_END_EPOCH='1000'),dict(MASTER_WOK_EVENT_RUNTIME_ENABLED='true'),dict(MASTER_WOK_PREVIEW_HOP_KEY='weak')]:
    with self.assertRaises(p.EventCaptureError):p.configuration(dict(env,**bad),1000)
 def test_signed_state_and_command_validate_and_wrong_fixture_never_passes(self):
  self.assertEqual(p.validate_envelope(envelope(),KEY,1000)['operation'],'state')
  self.assertEqual(p.validate_envelope(envelope('command',command()),KEY,1000)['input'],command())
  for bad in [envelope(issued=970),envelope(issued=1001),envelope('state',dict(orderId='other')),envelope('command',dict(command(),target='2026-10-28T21:00:00Z')),envelope('command',dict(command(),expectedRevision=True)),dict(envelope(),tag='a'*64)]:
   with self.assertRaises(p.EventCaptureError):p.validate_envelope(bad,KEY,1000)
 def test_duplicate_fields_refuse_even_with_valid_hmac(self):
  body=envelope()['body'].replace('"version":1','"version":1,"version":1');signed=dict(body=body,tag=hmac.new(KEY,body.encode(),hashlib.sha256).hexdigest())
  with self.assertRaises(p.EventCaptureError):p.validate_envelope(signed,KEY,1000)
 def test_signed_read_uses_readonly_role_fixed_query_and_minimal_output(self):
  receiver,budget,conn,opens=self.receiver()
  with patch.object(p,'role_check') as role:r=receiver(envelope())
  role.assert_called_once_with(conn,'reader');self.assertEqual(budget.calls,['state']);self.assertEqual(opens,[{'user':'test-reader'}]);self.assertEqual(set(r),{'orderId','revision','status','target','proposalTargets'});self.assertEqual(conn.queries[0][0],'SET TRANSACTION READ ONLY');self.assertEqual(conn.queries[1][0],p.STATE);self.assertEqual(r['target'],p.FIXTURE['targets'][1])
 def test_signed_command_uses_fixed_route_and_writer_transaction(self):
  receiver,budget,conn,opens=self.receiver((dict(status='RECORDED',revision=3),))
  with patch.object(p,'role_check'):r=receiver(envelope('command',command()))
  self.assertEqual(r,dict(status='RECORDED',revision=3));self.assertEqual(opens,[{'user':'test-writer'}]);self.assertEqual(conn.queries[0],(p.APPLY,[p.FIXTURE['routeId'],command()['commandId'],'a'*64,p.FIXTURE['orderId'],2,'offer',command()['target']]));self.assertTrue(conn.committed)
 def test_invalid_envelope_and_exhausted_budget_never_connect(self):
  receiver,budget,_,opens=self.receiver()
  with self.assertRaises(p.EventCaptureError):receiver(dict(envelope(),tag='a'*64))
  self.assertEqual(opens,[]);self.assertEqual(budget.calls,[])
  with patch.object(budget,'take',side_effect=p.EventCaptureError('LIMIT')):
   with self.assertRaises(p.EventCaptureError):receiver(envelope())
  self.assertEqual(opens,[])
 def test_invalid_writer_receipt_rolls_back_before_commit(self):
  receiver,_,conn,_=self.receiver((dict(status='RECORDED',revision=True),))
  with patch.object(p,'role_check'):
   with self.assertRaises(p.EventCaptureError):receiver(envelope('command',command()))
  self.assertTrue(conn.rolled_back);self.assertFalse(conn.committed)
 def test_budget_survives_reopen_and_serializes_concurrent_attempts(self):
  with tempfile.TemporaryDirectory() as directory:
   path=Path(directory)/'budget.sqlite3'
   class Small(p.Budget):LIMITS={'command':3,'started':1}
   Small(path,1600,clock=lambda:1000).take('started')
   with self.assertRaises(p.EventCaptureError):Small(path,1600,clock=lambda:1000).take('started')
   def take(_):
    try:Small(path,1600,clock=lambda:1000).take('command');return 1
    except p.EventCaptureError:return 0
   with ThreadPoolExecutor(max_workers=6) as pool:self.assertEqual(sum(pool.map(take,range(12))),3)
   self.assertEqual(Small(path,1600,clock=lambda:1000).summary(),{'started':1,'command':3})
   with self.assertRaises(p.EventCaptureError):Small(path,1600,clock=lambda:1600).take('command')
 def test_http_exact_path_content_bound_and_no_private_error_details(self):
  receiver,budget,_,opens=self.receiver();server=p.serve(receiver,budget,host='127.0.0.1',port=0);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
  try:
   with patch.object(p,'role_check'):
    def request(method,path,body=None,headers=None):
     conn=http.client.HTTPConnection('127.0.0.1',server.server_port,timeout=5);conn.request(method,path,body,headers or {});r=conn.getresponse();result=r.status,r.read();conn.close();return result
    self.assertEqual(request('GET','/staging/preview-fixture-v1')[0],404)
    self.assertEqual(request('POST','/wrong','{}',{'Content-Type':'application/json'})[0],404)
    self.assertEqual(request('POST','/staging/preview-fixture-v1','{}',{'Content-Type':'text/plain'})[0],503);self.assertEqual(opens,[])
    status,body=request('POST','/staging/preview-fixture-v1',json.dumps(envelope()),{'Content-Type':'application/json'});self.assertEqual(status,200);self.assertEqual(json.loads(body)['orderId'],p.FIXTURE['orderId'])
    with patch.object(receiver,'connection',side_effect=Exception('PRIVATE DATABASE DSN')):
     status,body=request('POST','/staging/preview-fixture-v1',json.dumps(envelope()),{'Content-Type':'application/json'});self.assertEqual(status,503);self.assertNotIn(b'PRIVATE',body)
  finally:server.shutdown();server.server_close();thread.join(timeout=2)

if __name__=='__main__':unittest.main()
