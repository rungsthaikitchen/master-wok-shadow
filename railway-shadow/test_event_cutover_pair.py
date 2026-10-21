import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from event_transfer_bundle import TransferBundleStore,EventCaptureError,invoke
ROOT=Path(__file__).resolve().parent.parent

def captures():return json.loads((ROOT/'fixtures/cutover-pair-staging-captures.json').read_text())

class PairedCutoverTests(unittest.TestCase):
 def test_actual_hosted_baselines_and_future_move_survive_ack_failure_restart_and_snapshot(self):
  data=captures();ids=[s['streamId'] for s in data['initial']['streams']]
  with tempfile.TemporaryDirectory() as directory:
   root=Path(directory);path=root/'transfer-bundles.sqlite3';store=TransferBundleStore(path,ids,enabled=True)
   try:
    store.enqueue(data['initial']);self.assertEqual(store.run_once()['comparisons'],0)
    self.assertEqual(len(store.acknowledged()),1)
    self.assertTrue(all(s['result']['historicalDecisionCoverage'] is False and s['result']['decisionCount']==0 for s in store.acknowledged()[0]['results']))
    store.enqueue(data['final'])
    def interrupt():raise OSError('forced before paired cutover ACK commit')
    with self.assertRaises(OSError):store.run_once(before_commit=interrupt)
    self.assertEqual(len(store.acknowledged()),1)
   finally:store.close()
   store=TransferBundleStore(path,ids[::-1],enabled=True)
   try:
    self.assertEqual(store.run_once()['comparisons'],1)
    self.assertEqual(store.verify(),dict(acknowledged=2,bundles=2))
    latest=store.acknowledged()[-1]['results']
    self.assertEqual(sum(s['result']['remainingCommitments'] for s in latest),3)
    self.assertTrue(all(s['result']['verified'] is False and s['result']['historicalDecisionCoverage'] is False for s in latest))
    bad=copy.deepcopy(data['initial']);bad['streams'][0]['batch']['events'][0]['commitments'][0]['order']['lines'][0]['qty']=2
    with self.assertRaises(EventCaptureError):store.enqueue(bad)
    mixed=copy.deepcopy(data['final']);mixed['streams'][0]=copy.deepcopy(data['initial']['streams'][0])
    with self.assertRaises(EventCaptureError):store.enqueue(mixed)
    self.assertEqual(store.verify(),dict(acknowledged=2,bundles=2))
    recovery_dir=root/'recovered';recovery_dir.mkdir();snapshot=recovery_dir/'transfer-bundles.sqlite3';expected=store.snapshot(snapshot)
   finally:store.close()
   recovered=TransferBundleStore(snapshot,ids,enabled=True)
   try:
    self.assertEqual(recovered.verify(),expected);self.assertEqual(recovered.run_once()['status'],'IDLE')
    self.assertEqual(len(recovered.acknowledged()),2)
   finally:recovered.close()
 def test_one_result_missing_cutover_provenance_cannot_ack_either_side(self):
  data=captures()['final'];ids=[s['streamId'] for s in data['streams']]
  with tempfile.TemporaryDirectory() as directory:
   store=TransferBundleStore(Path(directory)/'transfer-bundles.sqlite3',ids,enabled=True)
   try:
    store.enqueue(data);result=invoke(data);result['results'][0]['result'].pop('baselineAt')
    with patch('event_transfer_bundle.invoke',return_value=result):
     with self.assertRaises(EventCaptureError):store.run_once()
    self.assertEqual(store.acknowledged(),[])
    self.assertEqual(store.run_once()['comparisons'],1)
    self.assertEqual(store.verify(),dict(acknowledged=1,bundles=1))
   finally:store.close()

if __name__=='__main__':unittest.main()
