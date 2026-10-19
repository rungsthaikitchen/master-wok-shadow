import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from event_capture_journal import EventCaptureJournal
from event_runtime_staging import Budget,Monitor,cycle
from event_postgres_export import source_identity
from event_recovery import EventRecovery
from test_event_capture_journal import fixture
ID='11111111-1111-1111-1111-111111111111'
class Storage:
 def __init__(self):self.objects={};self.calls=[];self.corrupt=False
 def put_object(self,**p):self.calls.append(('put',p['Key']));self.objects[p['Key']]=p['Body']
 def get_object(self,**p):
  self.calls.append(('get',p['Key']));data=self.objects[p['Key']]
  if self.corrupt and p['Key'].endswith('.sqlite3'):data=b'corrupt'
  return {'Body':io.BytesIO(data)}
 def close(self):pass
class RecoveryTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
  self.j=EventCaptureJournal(self.root/'event-capture.sqlite3',source_identity(ID),enabled=True)
  self.j.enqueue(fixture(4));self.j.run_once(enabled=True)
  self.storage=Storage();self.budget=Budget(self.root/'budget.sqlite3',self.j.identity)
  self.recovery=EventRecovery(SimpleNamespace(bucket='synthetic'),self.budget,self.root/'receipt.json',client_factory=lambda _:self.storage)
 def tearDown(self):self.j.close();self.tmp.cleanup()
 def test_round_trip_restores_ack_and_verifies_cloud_manifest_then_caches(self):
  result=self.recovery.run(self.j);self.assertEqual(result['status'],'CLOUD_RECOVERY_VERIFIED');self.assertTrue(result['restored'])
  self.assertEqual(len(self.storage.calls),4)
  self.assertEqual(self.recovery.run(self.j)['status'],'CACHED_RECOVERY_VERIFIED');self.assertEqual(len(self.storage.calls),4)
  receipt=json.loads((self.root/'receipt.json').read_text());self.assertEqual(receipt['restorePolicy'],'SPEND_TRIAL_BUDGETS_ON_RESTORE')
 def test_corruption_fails_without_receipt_and_cloud_attempt_survives_restart(self):
  self.storage.corrupt=True
  self.assertEqual(self.recovery.run(self.j)['status'],'RECOVERY_FAILED');self.assertFalse((self.root/'receipt.json').exists())
  calls=len(self.storage.calls);self.storage.corrupt=False
  self.budget=Budget(self.root/'budget.sqlite3',self.j.identity)
  self.assertEqual(self.recovery.run(self.j)['status'],'RECOVERY_FAILED');self.assertEqual(len(self.storage.calls),calls)
 def test_cached_receipt_cannot_cover_new_source_or_corrupt_receipt(self):
  self.assertTrue(self.recovery.run(self.j)['restored'])
  self.j.enqueue(fixture());self.j.run_once(enabled=True)
  self.assertFalse(self.recovery.run(self.j)['restored']);self.assertEqual(len(self.storage.calls),4)
 def test_cloud_failure_keeps_monitor_unhealthy(self):
  self.storage.corrupt=True;monitor=Monitor()
  reader=lambda _:[dict(stream_id=ID,scope='SYNTHETIC_STAGING_EVENTS',event_count=4,batch=fixture(4))]
  result=cycle(self.j,ID,reader,monitor,self.root,recovery=self.recovery)
  self.assertEqual(result['status'],'UNVERIFIED');self.assertFalse(monitor.healthy())

class IndependentRecoveryTests(unittest.TestCase):
 setUp=RecoveryTests.setUp
 tearDown=RecoveryTests.tearDown
 def test_new_process_restores_without_source_access_and_rejects_overwrite(self):
  import subprocess,sys
  self.assertTrue(self.recovery.run(self.j)['restored'])
  receipt=json.loads((self.root/'receipt.json').read_text())
  snapshot_path=self.root/'download.sqlite3';snapshot_path.write_bytes(self.storage.objects[receipt['key']])
  manifest_path=self.root/'manifest.json';manifest_path.write_bytes(self.storage.objects[receipt['key']+'.json'])
  directory=self.root/'independent';directory.mkdir()
  destination=directory/'event-capture.sqlite3'
  command=[sys.executable,str(Path(__file__).with_name('event_recovery_check.py')),str(snapshot_path),str(manifest_path),str(destination)]
  result=subprocess.run(command,capture_output=True,text=True,timeout=20)
  self.assertEqual(result.returncode,0,result.stdout+result.stderr)
  self.assertEqual(json.loads(result.stdout)['status'],'OFFLINE_RECOVERY_VERIFIED')
  before=destination.read_bytes()
  result=subprocess.run(command,capture_output=True,text=True,timeout=20)
  self.assertNotEqual(result.returncode,0)
  self.assertEqual(destination.read_bytes(),before)
 def test_hundred_unchanged_polls_keep_comparisons_and_snapshots_bounded(self):
  monitor=Monitor()
  reader=lambda _:[dict(stream_id=ID,scope='SYNTHETIC_STAGING_EVENTS',event_count=4,batch=fixture(4))]
  protected=self.root/'event-snapshot-manual.sqlite3';protected.write_bytes(b'keep')
  baseline=self.j.summary()['counts']['observations']
  for _ in range(100):
   result=cycle(self.j,ID,reader,monitor,self.root,recovery=self.recovery)
   self.assertEqual(result['status'],'OBSERVED')
   self.assertEqual(result['observations'],baseline)
  self.assertEqual(len(self.storage.calls),4)
  self.assertEqual(len(list(self.root.glob('event-snapshot-*.sqlite3'))),4)
  self.assertEqual(protected.read_bytes(),b'keep')
