import contextlib
import io
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch
from event_capture_journal import EventCaptureError
from event_runtime_http import serve_api
import event_full_checkout_trial as trial

DSN='postgresql://master_wok_event_writer_login:synthetic@db.hvrqgufqjslvgiohgkvu.supabase.co/postgres'
class FullTests(unittest.TestCase):
 def env(self):
  e={k:'false' for k in (*trial.FLAGS,*trial.EXTRA_FLAGS,'MASTER_WOK_CHECKOUT_TRIAL_ENABLED')}
  e.update(MASTER_WOK_FULL_CHECKOUT_TRIAL_ENABLED='true',MASTER_WOK_FULL_CHECKOUT_TRIAL_END_EPOCH='1500',RAILWAY_PROJECT_ID='7821ad5b-f5c2-4ab4-9206-c3d76eefd4c8',RAILWAY_ENVIRONMENT_ID='c1b8fad6-dbfc-4188-b4b5-a5dbfbf53279',RAILWAY_SERVICE_ID='012e5ef6-6225-4ab3-95f5-894583db7e83',MASTER_WOK_EVENT_RUNTIME_SCOPE='SYNTHETIC_STAGING_EVENTS',MASTER_WOK_EVENT_WRITER_DSN=DSN,MASTER_WOK_EVENT_READER_DSN=DSN.replace('_writer_','_reader_'))
  return e
 def test_default_off_and_scope_deadline_source_guards(self):
  with patch.object(trial,'connection_parameters',side_effect=AssertionError()),contextlib.redirect_stdout(io.StringIO()) as out:trial.main({})
  self.assertEqual(json.loads(out.getvalue())['sourceRequests'],0)
  self.assertEqual(trial.configuration(self.env(),now=1000)[0],1500)
  for key in ('MASTER_WOK_CHECKOUT_TRIAL_ENABLED','MASTER_WOK_COMMAND_ROUTE_TRIAL_ENABLED','RAILWAY_SERVICE_ID'):
   e=self.env();e.pop(key)
   with self.assertRaises(EventCaptureError):trial.configuration(e,now=1000)
  for value in ('1000','1601','nan','inf'):
   e=self.env();e['MASTER_WOK_FULL_CHECKOUT_TRIAL_END_EPOCH']=value
   with self.assertRaises(EventCaptureError):trial.configuration(e,now=1000)
  e=self.env();e['MASTER_WOK_EVENT_WRITER_DSN']=DSN.replace('hvrqgufqjslvgiohgkvu','ubyjrrsvbbqomitpaidb')
  with self.assertRaises(EventCaptureError):trial.configuration(e,now=1000)
 def test_fixed_query_payload_and_privilege_checks(self):
  f=trial.CASES[0];p=dict(query=trial.QUERY,parameters=[f['route'],f['request'],f['order'],f['quote'],f['payload']]);self.assertEqual(json.loads(trial.parameters(p)[4]),f['payload'])
  for bad in (dict(p,query='DELETE FROM public.orders'),dict(p,parameters=[None]*5),dict(p,parameters=p['parameters'][:4]+[dict(notes='x'*100001)])):
   with self.assertRaises(EventCaptureError):trial.parameters(bad)
  class Row:
   def __init__(self,v):self.v=v
   def fetchone(self):return self.v
  class Conn:
   def __init__(self,priv=False):self.priv=priv
   def execute(self,q):return Row((self.priv,False,False,False,False,False) if q==trial.PRIVILEGES else ('master_wok_event_writer_login',False,False))
  trial.check_role(Conn())
  with self.assertRaises(EventCaptureError):trial.check_role(Conn(True))
 def test_budget_start_operations_and_deadline_are_durable(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp)/'budget.sqlite3';b=trial.Budget(p,2000,clock=lambda:1000);b.take('started')
   with self.assertRaises(EventCaptureError):trial.Budget(p,2000,clock=lambda:1000).take('started')
   for _ in range(20):b.take('write')
   with self.assertRaises(EventCaptureError):b.take('write')
   with self.assertRaises(EventCaptureError):trial.Budget(p,2000,clock=lambda:2000).take('read')
 def test_actual_node_adapter_loopback_lost_commit_response_and_boundaries(self):
  f=trial.CASES[-1];commands={};seen=[]
  # Use the production trial's helper with a fake DB transaction at its fixed SQL boundary.
  class Rows:
   def __init__(self,r):self.r=r
   def fetchone(self):return (self.r,)
  class Conn:
   def __enter__(self):return self
   def __exit__(self,*args):pass
   def execute(self,sql,args):
    selftest.assertEqual(sql,trial.SQL);key=args[1];seen.append(args);r='ALREADY_RECORDED' if key in commands else 'RECORDED';commands[key]=True;return Rows(r)
  class Budget:
   def take(self,k):selftest.assertEqual(k,'write')
  class Stub:
   budget=Budget()
   def writer(self):return Conn()
  selftest=self
  r=trial.http_trial({},Stub(),time.time()+30)
  self.assertEqual(r,dict(status='PASSED',httpCalls=7,lostSuccessResponseRetried=True));self.assertEqual(len(seen),4);self.assertEqual(len(commands),2);self.assertEqual(seen[0],seen[1])
 def test_real_export_packet_privacy_validation_snapshot_and_restart(self):
  p=json.loads((trial.ROOT/'fixtures/checkout-full-local-capture.json').read_text());f=trial.CASES[-1];trial.verify_packet(f,p)
  with tempfile.TemporaryDirectory() as tmp,patch.object(trial,'DIRECTORY',Path(tmp)):
   self.assertEqual(trial.replay_packet(p),dict(events=2,actualDecisions=0,recoveryVerified=True))
  bad=json.loads(json.dumps(p));bad['batch']['events'][0]['order']['lines'][0]['itemId']='private-id'
  with self.assertRaises(EventCaptureError):trial.verify_packet(f,bad)
if __name__=='__main__':unittest.main()
