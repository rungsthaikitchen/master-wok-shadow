import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from event_capture_journal import EventCaptureError
from event_soak_staging import SoakBudget,recover,main,STREAM
from event_postgres_export import source_identity
import test_event_recovery

class SoakTests(unittest.TestCase):
 def test_default_off_and_scope_refusal(self):
  main({})
  with self.assertRaises(EventCaptureError):main({'MASTER_WOK_EVENT_SOAK_ENABLED':'true'})
 def test_persistent_read_deadline_and_recovery_caps(self):
  with tempfile.TemporaryDirectory() as tmp:
   path=Path(tmp)/'budget.sqlite3';now=[1]
   b=SoakBudget(path,'synthetic',10,clock=lambda:now[0])
   for _ in range(6):b.take('reads')
   b=SoakBudget(path,'synthetic',10,clock=lambda:now[0])
   with self.assertRaises(EventCaptureError):b.take('reads')
   with self.assertRaises(EventCaptureError):b.take('writer')
   b.take('recovery')
   with self.assertRaises(EventCaptureError):b.take('recovery')
   with self.assertRaises(EventCaptureError):SoakBudget(path,'synthetic',11)
   path2=Path(tmp)/'deadline.sqlite3';b=SoakBudget(path2,'synthetic',10,clock=lambda:now[0]);now[0]=10
   with self.assertRaises(EventCaptureError):b.take('reads')
 def test_real_subprocess_downloads_only_and_retains_original_budget(self):
  from unittest.mock import patch
  case=test_event_recovery.RecoveryTests();case.setUp()
  try:
   self.assertTrue(case.recovery.run(case.j)['restored'])
   receipt=case.root/'receipt.json'
   budget=SoakBudget(case.root/'soak.sqlite3',case.j.identity,100,clock=lambda:1)
   with patch('event_soak_staging.STREAM','11111111-1111-1111-1111-111111111111'):
    result=recover(SimpleNamespace(bucket='synthetic'),budget,receipt,client_factory=lambda _:case.storage)
    self.assertEqual(result['status'],'INDEPENDENT_CLOUD_RECOVERY_VERIFIED')
    self.assertEqual([c[0] for c in case.storage.calls],['put','put','get','get','get','get'])
    with self.assertRaises(EventCaptureError):recover(SimpleNamespace(bucket='synthetic'),budget,receipt,client_factory=lambda _:case.storage)
   self.assertEqual(case.budget.summary(),{'exportAttempts':0,'mutationAttempts':0})
  finally:case.tearDown()
