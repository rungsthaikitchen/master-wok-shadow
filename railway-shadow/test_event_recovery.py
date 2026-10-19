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
