import copy
import io
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from urllib.request import Request,urlopen
from urllib.error import HTTPError
from event_capture_journal import EventCaptureJournal,EventCaptureError,digest
from event_postgres_export import source_identity
from event_transfer_bundle import TransferBundleStore,poll_pair
from event_transfer_monitor import PairMonitor,route_export,serve_health
from event_transfer_recovery import PairRecovery,fingerprint,restore
from event_transfer_monitor_staging import configuration,run
ROOT=Path(__file__).resolve().parent.parent

def fixture():return json.loads((ROOT/'fixtures/cross-date-authenticated-capture.json').read_text())
class Storage:
 def __init__(self):self.objects={};self.calls=[];self.corrupt=False
 def put_object(self,**p):self.calls.append(('put',p['Key']));self.objects[p['Key']]=p['Body']
 def get_object(self,**p):
  self.calls.append(('get',p['Key']));data=self.objects[p['Key']]
  if self.corrupt and p['Key'].endswith('.sqlite3'):data=b'bad'
  return dict(Body=io.BytesIO(data))
 def close(self):pass
class PairMonitorTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.bundle=fixture();self.streams=[s['streamId'] for s in self.bundle['streams']]
  self.store=TransferBundleStore(self.root/'transfer-bundles.sqlite3',self.streams,enabled=True)
  self.storage=Storage();self.config=SimpleNamespace(endpoint='https://synthetic.storageapi.dev',bucket='synthetic',region='us-west2',style='virtual')
  self.recovery=PairRecovery(self.config,enabled=True,client_factory=lambda _:self.storage)
  self.now=1000;self.reads=0;self.fail_read=False;self.inside=[]
  def reader(_):
   self.reads+=1
   if hasattr(self,'monitor'):self.inside.append(self.monitor.healthy())
   if self.fail_read:raise OSError('untrusted source error')
   return [dict(bundle=copy.deepcopy(self.bundle))]
  self.reader=reader;self.monitor=PairMonitor(self.store,reader,self.recovery,enabled=True,clock=lambda:self.now,read_limit=8)
 def tearDown(self):self.store.close();self.tmp.cleanup()
 def test_default_off_and_initial_history_never_implies_fresh_source(self):
  self.assertEqual(PairMonitor().cycle()['status'],'DISABLED');self.assertFalse(PairMonitor().healthy())
  self.assertEqual(PairRecovery().run(None)['status'],'DISABLED');self.assertIsNone(configuration({}));out=[];run({},emit=out.append);self.assertEqual(out[0]['sourceRequests'],0)
  self.store.enqueue(self.bundle);self.store.run_once();self.assertFalse(self.monitor.healthy())
  self.assertEqual(self.monitor.cycle()['status'],'OBSERVED');self.assertTrue(self.monitor.healthy());self.assertEqual(self.inside,[False])
 def test_unchanged_poll_refreshes_source_without_duplicate_ack_or_backup_then_stales(self):
  self.assertEqual(self.monitor.cycle()['status'],'OBSERVED');mark=fingerprint(self.store)
  self.now+=30;self.assertEqual(self.monitor.cycle()['status'],'WAITING');self.assertEqual(self.reads,1)
  for _ in range(4):
   self.now+=60;self.assertEqual(self.monitor.cycle()['status'],'OBSERVED');self.assertTrue(self.monitor.healthy())
  self.assertEqual(fingerprint(self.store),mark);self.assertEqual(self.store.verify(),dict(acknowledged=1,bundles=1));self.assertEqual(len(self.storage.calls),4)
  self.now+=181;self.assertFalse(self.monitor.healthy())
 def test_failure_restart_and_durable_read_budget_cannot_reuse_old_health(self):
  self.monitor.cycle();self.now+=60;self.fail_read=True
  self.assertEqual(self.monitor.cycle()['status'],'UNVERIFIED');self.assertFalse(self.monitor.healthy());self.assertEqual(len(self.store.acknowledged()),1)
  old=self.monitor;self.monitor=PairMonitor(self.store,self.reader,self.recovery,enabled=True,clock=lambda:self.now,read_limit=8)
  before=self.reads;self.assertEqual(old.cycle()['sourceRequests'],0);self.assertEqual(self.reads,before)
  self.assertFalse(self.monitor.healthy());self.fail_read=False
  self.assertEqual(self.monitor.cycle()['status'],'OBSERVED')
  for _ in range(5):self.now+=60;self.monitor.cycle()
  self.assertEqual(self.reads,8);self.now+=60;self.assertEqual(self.monitor.cycle()['sourceRequests'],0);self.assertFalse(self.monitor.healthy());self.assertEqual(self.reads,8)
 def test_bad_counterpart_or_recovery_failure_never_reports_healthy(self):
  self.bundle['transfers'].pop();self.assertEqual(self.monitor.cycle()['status'],'UNVERIFIED');self.assertFalse(self.monitor.healthy());self.assertEqual(self.store.verify()['bundles'],0)
  self.bundle=fixture();self.storage.corrupt=True;self.now+=60
  self.assertEqual(self.monitor.cycle()['status'],'UNVERIFIED');self.assertFalse(self.monitor.healthy());self.assertEqual(len(self.store.acknowledged()),1)
  self.assertEqual(self.store.db.execute('SELECT count(*) FROM pair_recovery_receipts').fetchone()[0],0)
 def test_changed_history_needs_new_backup_and_corrupt_cached_proof_fails(self):
  self.monitor.cycle();b=self.bundle['streams'][0]['batch'];n=len(b['events'])+1
  order=copy.deepcopy(next(e['order'] for e in b['events'] if 'order' in e));order['orderId']='synthetic-extra'
  b['events'].append(dict(eventId='extra-decline',at='2026-10-21T07:00:00Z',sequence=n,kind='BOOKING_DECISION',order=order,actualDecision='DECLINED'));b['coverage'].update(eventCount=n,lastSequence=n,throughAt='2026-10-21T07:00:00Z')
  self.now+=60;self.assertEqual(self.monitor.cycle()['status'],'OBSERVED');self.assertEqual(len(self.storage.calls),8)
  with self.store.db:self.store.db.execute("UPDATE pair_recovery_receipts SET proof_hash='bad'")
  self.now+=60;self.assertEqual(self.monitor.cycle()['status'],'UNVERIFIED');self.assertFalse(self.monitor.healthy());self.assertEqual(len(self.storage.calls),8)
 def test_independent_restore_blocks_source_reads_and_never_overwrites(self):
  self.monitor.cycle();_,manifest_body,_=self.store.db.execute('SELECT destination,manifest,proof_hash FROM pair_recovery_receipts').fetchone();manifest=json.loads(manifest_body)
  downloaded=self.root/'downloaded.sqlite3';downloaded.write_bytes(self.storage.objects[manifest['key']]);manifest_path=self.root/'manifest.json';manifest_path.write_text(manifest_body)
  targetdir=self.root/'independent';targetdir.mkdir();target=targetdir/'transfer-bundles.sqlite3'
  cmd=[sys.executable,str(ROOT/'railway-shadow/event_transfer_recovery_check.py'),str(downloaded),str(manifest_path),str(target)]
  child=subprocess.run(cmd,capture_output=True,text=True,timeout=20,env={k:v for k,v in os.environ.items() if k in ('PATH','LANG')});self.assertEqual(child.returncode,0,child.stdout+child.stderr);self.assertEqual(json.loads(child.stdout)['sourceRequests'],0)
  restored=TransferBundleStore(target,self.streams,enabled=True)
  try:
   self.assertEqual(restored.run_once()['status'],'IDLE');self.assertEqual(len(restored.acknowledged()),1)
   with self.assertRaises(EventCaptureError):poll_pair(restored,enabled=True,transport=lambda _:self.fail('source must stay blocked'))
   with self.assertRaises(EventCaptureError):PairMonitor(restored,self.reader,self.recovery,enabled=True)
  finally:restored.close()
  original=target.read_bytes();child=subprocess.run(cmd,capture_output=True,text=True,timeout=20,env={k:v for k,v in os.environ.items() if k in ('PATH','LANG')});self.assertNotEqual(child.returncode,0);self.assertEqual(target.read_bytes(),original)
 def test_stream_watermark_corruption_and_worker_failure_remain_unhealthy(self):
  self.monitor.cycle()
  with self.store.db:self.store.db.execute('UPDATE streams SET through_at=0')
  self.assertFalse(self.monitor.healthy())
  with self.assertRaises(EventCaptureError):self.store.verify()
 def test_transfer_routing_reacquires_full_pair_and_health_http_has_no_write_actions(self):
  s=self.bundle['streams'][0];journal=EventCaptureJournal(self.root/'event-capture.sqlite3',source_identity(s['streamId']),enabled=True)
  row=dict(stream_id=s['streamId'],scope='SYNTHETIC_STAGING_EVENTS',event_count=len(s['batch']['events']),batch=s['batch'])
  try:
   self.assertEqual(route_export([row],journal,s['streamId'],enabled=True)['reasonCode'],'TRANSFER_BUNDLE_REQUIRED')
   self.assertEqual(route_export([row],journal,s['streamId'],enabled=True,pair_monitor=self.monitor)['status'],'OBSERVED');self.assertEqual(self.reads,1);self.assertEqual(journal.summary()['counts']['observations'],0)
  finally:journal.close()
  server,thread=serve_health(self.monitor,'h'*32)
  try:
   base='http://127.0.0.1:'+str(server.server_port)
   with self.assertRaises(HTTPError) as error:urlopen(base+'/healthz')
   self.assertEqual(error.exception.code,401)
   with urlopen(Request(base+'/healthz',headers={'Authorization':'Bearer '+'h'*32})) as response:self.assertEqual(response.status,200)
   self.now+=181
   with self.assertRaises(HTTPError) as error:urlopen(Request(base+'/healthz',headers={'Authorization':'Bearer '+'h'*32}))
   self.assertEqual(error.exception.code,503)
   with self.assertRaises(HTTPError) as error:urlopen(Request(base+'/staging/admin-action',data=b'{}'))
   self.assertEqual(error.exception.code,405)
  finally:server.shutdown();server.server_close();thread.join(timeout=2)

 def test_failed_object_attempt_budget_survives_recovery_restart(self):
  self.storage.corrupt=True
  for _ in range(2):
   self.assertEqual(self.monitor.cycle()['status'],'UNVERIFIED');self.now+=60
  calls=len(self.storage.calls);self.storage.corrupt=False
  self.monitor.recovery=PairRecovery(self.config,enabled=True,client_factory=lambda _:self.storage)
  self.assertEqual(self.monitor.cycle()['status'],'UNVERIFIED');self.assertEqual(len(self.storage.calls),calls)
  self.assertEqual(self.store.db.execute('SELECT used FROM pair_recovery_budget').fetchone()[0],2)
 def test_pending_comparison_failure_retries_without_partial_ack(self):
  from unittest.mock import patch
  with patch.object(self.store,'run_once',side_effect=OSError('worker failed')):
   self.assertEqual(self.monitor.cycle()['status'],'UNVERIFIED')
  self.assertEqual(self.store.verify(),dict(acknowledged=0,bundles=1));self.assertFalse(self.monitor.healthy());self.assertEqual(self.storage.calls,[])
  self.now+=60;self.assertEqual(self.monitor.cycle()['status'],'OBSERVED');self.assertEqual(self.store.verify(),dict(acknowledged=1,bundles=1))
 def test_bounded_staging_runtime_wires_reader_recovery_and_stops_unhealthy(self):
  from event_transfer_trial import FLAGS
  env={k:'false' for k in FLAGS}
  env.update(MASTER_WOK_TRANSFER_MONITOR_ENABLED='true',MASTER_WOK_TRANSFER_MONITOR_RECOVERY_ENABLED='true',MASTER_WOK_TRANSFER_TRIAL_ENABLED='false',RAILWAY_PROJECT_ID='7821ad5b-f5c2-4ab4-9206-c3d76eefd4c8',RAILWAY_ENVIRONMENT_ID='c1b8fad6-dbfc-4188-b4b5-a5dbfbf53279',RAILWAY_SERVICE_ID='012e5ef6-6225-4ab3-95f5-894583db7e83',MASTER_WOK_EVENT_RUNTIME_SCOPE='SYNTHETIC_STAGING_EVENTS',MASTER_WOK_TRANSFER_MONITOR_END_EPOCH='1300',MASTER_WOK_TRANSFER_MONITOR_STREAMS=json.dumps(self.streams),MASTER_WOK_EVENT_HEALTH_TOKEN='h'*32,PORT='0',MASTER_WOK_BACKUP_ENDPOINT='https://synthetic.storageapi.dev',MASTER_WOK_BACKUP_BUCKET='synthetic',MASTER_WOK_BACKUP_REGION='us-west2',MASTER_WOK_BACKUP_ACCESS_KEY_ID='synthetic',MASTER_WOK_BACKUP_SECRET_ACCESS_KEY='synthetic')
  with self.assertRaises(EventCaptureError):configuration(dict(env,RAILWAY_ENVIRONMENT_ID='production'),clock=lambda:self.now)
  with self.assertRaises(EventCaptureError):configuration(dict(env,MASTER_WOK_TRANSFER_MONITOR_END_EPOCH='1601'),clock=lambda:self.now)
  case=self
  class Stop:
   cycles=0
   def is_set(self):return self.cycles>=2
   def wait(self,seconds):case.now+=seconds;self.cycles+=1
  output=[];directory=self.root/'runtime'
  run(env,stop=Stop(),directory=directory,clock=lambda:self.now,reader=lambda _:[dict(bundle=copy.deepcopy(self.bundle))],client_factory=lambda _:self.storage,emit=output.append)
  self.assertEqual([o['status'] for o in output],['OBSERVED','OBSERVED']);self.assertEqual(len(self.storage.calls),4)
  with sqlite3.connect(directory/'transfer-bundles.sqlite3') as db:
   self.assertEqual(db.execute('SELECT state FROM pair_monitor_state').fetchone()[0],'FAILED');self.assertEqual(db.execute('SELECT used FROM pair_monitor_budget').fetchone()[0],2)
