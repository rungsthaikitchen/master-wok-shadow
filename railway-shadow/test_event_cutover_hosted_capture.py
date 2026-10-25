import json
from pathlib import Path
import tempfile
import unittest
from event_capture_journal import EventCaptureJournal,digest,invoke_node,snapshot,restore_snapshot

ROOT=Path(__file__).resolve().parent.parent

def capture():
 return json.loads((ROOT/'fixtures/cutover-concurrency-hosted-25-oct.json').read_text())

class HostedCutoverCaptureTests(unittest.TestCase):
 def test_actual_hosted_exports_keep_future_only_baselines_and_exact_retry(self):
  data=capture();self.assertTrue(data['rollbackSeedRetryVerified']);self.assertEqual(len(data['streams']),4)
  baselines=0
  for stream in data['streams']:
   with self.subTest(stream=stream['id']):
    batch=stream['batch'];self.assertEqual(stream['eventCount'],len(batch['events']))
    result=invoke_node(batch);self.assertFalse(result['verified']);self.assertEqual(result['remainingCommitments'],1)
    if batch['coverage']['basis']=='CUTOVER_BASELINE_AND_EVENT_LOG':
     baselines+=1;self.assertFalse(result['historicalDecisionCoverage']);self.assertEqual(result['decisionCount'],0)
     self.assertEqual(len(batch['events'][0]['commitments']),1)
    else:
     self.assertEqual(result['decisionCount'],1)
     self.assertEqual(sum(e['eventId']=='cutover-timeout-retry' for e in batch['events']),1)
  self.assertEqual(baselines,3)

 def test_actual_exports_survive_ack_failure_restart_snapshot_and_restore(self):
  for stream in capture()['streams']:
   with self.subTest(stream=stream['id']),tempfile.TemporaryDirectory() as tmp:
    root=Path(tmp);identity=digest({'syntheticHostedStream':stream['id']});path=root/'event-capture.sqlite3'
    journal=EventCaptureJournal(path,identity,enabled=True)
    try:
     journal.enqueue(stream['batch'])
     def interrupted():raise OSError('synthetic interruption before ACK')
     self.assertEqual(journal.run_once(enabled=True,before_commit=interrupted)['status'],'UNVERIFIED')
     self.assertEqual(journal.summary()['counts']['observations'],0)
    finally:journal.close()
    journal=EventCaptureJournal(path,identity,enabled=True)
    try:
     result=journal.run_once(enabled=True);self.assertEqual(result['status'],'RECORDED')
     expected=1 if stream['batch']['coverage']['basis']=='DECISION_EVENT_LOG' else 0
     self.assertEqual(result['observations'],expected)
     journal.enqueue(stream['batch']);self.assertEqual(journal.run_once(enabled=True)['status'],'IDLE')
     counts=journal.summary()['counts'];target=root/'snapshot.sqlite3';receipt=snapshot(journal,target)
     restored=root/'restored';restored.mkdir()
     self.assertEqual(restore_snapshot(target,restored/'event-capture.sqlite3',identity,receipt['sha256']),counts)
    finally:journal.close()
    journal=EventCaptureJournal(restored/'event-capture.sqlite3',identity,enabled=True)
    try:
     self.assertEqual(journal.run_once(enabled=True)['status'],'IDLE')
     self.assertEqual(journal.summary()['counts'],counts)
    finally:journal.close()

if __name__=='__main__':unittest.main()
