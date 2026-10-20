import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
from flask import Flask
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'backend-patch'))
from master_wok_customer_routes import register_staging_routes
from event_customer_response_staging import issue_token
STREAM='11111111-1111-1111-1111-111111111111'
SECRET=b's'*32
URL='/master-wok-staging/proposal-response'

def env():
 return dict(MASTER_WOK_BACKEND_EVENT_STAGING_ENABLED='true',RAILWAY_PROJECT_ID='7821ad5b-f5c2-4ab4-9206-c3d76eefd4c8',RAILWAY_ENVIRONMENT_ID='c1b8fad6-dbfc-4188-b4b5-a5dbfbf53279',RAILWAY_SERVICE_ID='012e5ef6-6225-4ab3-95f5-894583db7e83',MASTER_WOK_EVENT_RUNTIME_SCOPE='SYNTHETIC_STAGING_EVENTS',MASTER_WOK_BACKEND_EVENT_PROJECT='hvrqgufqjslvgiohgkvu',MASTER_WOK_EVENT_STREAM_ID=STREAM,MASTER_WOK_BACKEND_EVENT_SIGNING_KEY=SECRET.hex())
def body():return dict(token=issue_token(STREAM,'synthetic-a','offer1',enabled=True,secret=SECRET),decision='accept')

class BackendPatchTests(unittest.TestCase):
 def test_disabled_registers_nothing_and_production_scope_refuses_startup(self):
  app=Flask('disabled')
  self.assertFalse(register_staging_routes(app,{}))
  self.assertEqual(app.test_client().post(URL,json=body()).status_code,404)
  with self.assertRaises(ValueError):register_staging_routes(app,dict(env(),RAILWAY_ENVIRONMENT_ID='production'))
  self.assertEqual(app.test_client().post(URL,json=body()).status_code,404)
 def test_flask_response_maps_receipts_and_preserves_request_identity(self):
  calls=[]
  def writer(p):calls.append(p);return [dict(result='RECORDED' if len(calls)==1 else 'ALREADY_RECORDED')]
  app=Flask('receipts');register_staging_routes(app,env(),transport=writer);client=app.test_client()
  first=client.post(URL,json=body());second=client.post(URL,json=body())
  self.assertTrue(first.json['success']);self.assertEqual(second.json['status'],'ALREADY_RECORDED')
  self.assertEqual(calls[0],calls[1]);self.assertEqual(calls[0]['parameters'][2]['proposalEventId'],'offer1')
  self.assertEqual(first.headers['Cache-Control'],'no-store')
  self.assertEqual(first.headers['Referrer-Policy'],'no-referrer')
  self.assertNotIn(body()['token'],first.get_data(as_text=True))
 def test_bad_inputs_and_get_do_not_reach_writer(self):
  def writer(_):self.fail('unexpected write')
  app=Flask('bad');register_staging_routes(app,env(),transport=writer);client=app.test_client()
  self.assertEqual(client.get(URL).status_code,405)
  cases=[dict(data='{}',content_type='text/plain'),dict(data='x'*2049,content_type='application/json'),dict(data='{"token":"a","decision":"accept","decision":"reject"}',content_type='application/json'),dict(json=dict(body(),orderId='synthetic-b')),dict(json=dict(body(),token='tampered'))]
  for args in cases:self.assertEqual(client.post(URL,**args).status_code,400)
 def test_database_failure_is_not_success_and_does_not_leak_details(self):
  def fail(_):raise RuntimeError('PRIVATE-DATABASE-ERROR')
  app=Flask('failure');register_staging_routes(app,env(),transport=fail)
  response=app.test_client().post(URL,json=body())
  self.assertEqual(response.status_code,503);self.assertFalse(response.json['success'])
  self.assertNotIn('PRIVATE',response.get_data(as_text=True))
 @unittest.skipUnless(os.getenv('MASTER_WOK_REVIEW_SERVER_PATH'),'owner supplied backend path required')
 def test_patch_applies_to_exact_supplied_backend_and_disabled_startup_preserves_routes(self):
  source=Path(os.environ['MASTER_WOK_REVIEW_SERVER_PATH'])
  self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(),'ad15337033c5b4a91816e2c5875460dcff1364d43e6a9619be8aa8a1d6412d88')
  with tempfile.TemporaryDirectory() as tmp:
   target=Path(tmp)/'server.py';target.write_text(source.read_text())
   result=subprocess.run(['patch','--batch','--silent',str(target),str(ROOT/'backend-patch/server.py.patch')],capture_output=True,text=True,timeout=5)
   self.assertEqual(result.returncode,0,result.stderr)
   notifications=types.ModuleType('notifications');notifications.send_timing_notification=lambda *a,**k:None
   supabase=types.ModuleType('supabase');supabase.create_client=lambda *a,**k:self.fail('unexpected database client')
   requests=types.ModuleType('requests')
   with patch.dict(os.environ,{},clear=True),patch.dict(sys.modules,{'notifications':notifications,'supabase':supabase,'requests':requests}),contextlib.redirect_stdout(io.StringIO()):
    app=runpy.run_path(str(target),run_name='review_backend')['app']
   client=app.test_client()
   with contextlib.redirect_stdout(io.StringIO()):self.assertEqual(client.get('/').status_code,200)
   self.assertEqual(client.post(URL,json=body()).status_code,404)
   routes={rule.rule for rule in app.url_map.iter_rules()}
   self.assertIn('/orders/<order_id>/time/accept',routes)
   self.assertIn('/orders/<order_id>/time/decline',routes)

   calls=[]
   def writer(payload):calls.append(payload);return [dict(result='RECORDED')]
   with patch.dict(os.environ,env(),clear=True),patch.dict(sys.modules,{'notifications':notifications,'supabase':supabase,'requests':requests}),patch('event_runtime_transport.DatabaseTransport',return_value=writer),contextlib.redirect_stdout(io.StringIO()):
    enabled_app=runpy.run_path(str(target),run_name='review_backend_enabled')['app']
   result=enabled_app.test_client().post(URL,json=body())
   self.assertEqual(result.status_code,200);self.assertTrue(result.json['success'])
   self.assertEqual(len(calls),1);self.assertEqual(calls[0]['parameters'][2]['proposalEventId'],'offer1')
