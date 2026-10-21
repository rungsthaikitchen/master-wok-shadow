import copy
import json
from pathlib import Path
import tempfile
import unittest
from event_capture_journal import EventCaptureJournal,EventCaptureError,digest,snapshot,restore_snapshot
from event_transfer_bundle import TransferBundleStore
ROOT=Path(__file__).resolve().parent.parent

def fixture():return json.loads((ROOT/'fixtures/cutover-baseline-synthetic.json').read_text())
class CutoverTests(unittest.TestCase):
 def test_durable_comparisons_bind_baseline_and_reject_rewrite(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);identity=digest(dict(source='synthetic-cutover'));j=EventCaptureJournal(root/'event-capture.sqlite3',identity,enabled=True)
   try:
    j.enqueue(fixture());self.assertEqual(j.run_once(enabled=True)['observations'],2)
    rows=[json.loads(p) for p, in j.db.execute('SELECT payload FROM observations')]
    self.assertTrue(all(r['historicalDecisionCoverage'] is False and r['coverageBasis']=='CUTOVER_BASELINE_AND_EVENT_LOG' and r['baselineAt']==fixture()['events'][0]['at'] for r in rows))
    self.assertEqual(rows[0]['priorCommitments'],2)
    bad=fixture();bad['events'][0]['commitments'][0]['order']['lines'][0]['qty']=2
    with self.assertRaises(EventCaptureError):j.enqueue(bad)
    counts=j.summary()['counts'];target=root/'snapshot.sqlite3';receipt=snapshot(j,target);restored_dir=root/'restored';restored_dir.mkdir()
    self.assertEqual(restore_snapshot(target,restored_dir/'event-capture.sqlite3',identity,receipt['sha256']),counts)
   finally:j.close()
   restored=EventCaptureJournal(restored_dir/'event-capture.sqlite3',identity,enabled=True)
   try:self.assertEqual(restored.run_once(enabled=True)['status'],'IDLE');self.assertEqual(restored.summary()['counts']['observations'],2)
   finally:restored.close()
 def test_result_without_cutover_provenance_cannot_ack_and_no_baseline_is_counted_as_decision(self):
  from event_capture_journal import invoke_node
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);j=EventCaptureJournal(root/'event-capture.sqlite3',digest('synthetic-cutover'),enabled=True)
   try:
    j.enqueue(fixture())
    def incomplete(b):
     r=invoke_node(b);r.pop('baselineAt');return r
    self.assertEqual(j.run_once(enabled=True,invoke=incomplete)['status'],'UNVERIFIED');self.assertEqual(j.summary()['counts']['observations'],0)
    self.assertEqual(j.run_once(enabled=True)['observations'],2)
   finally:j.close()
 def test_paired_transfer_can_start_from_cutover_commitment_without_creation_backfill(self):
  source=fixture();source['events']=source['events'][:1];source['events'][0]['commitments']=source['events'][0]['commitments'][:1];source['events'][0]['unreservedOrderIds']=[]
  dest=copy.deepcopy(source);dest['serviceDate']='2026-10-22';dest['events'][0]['eventId']='cutover-dest';dest['events'][0]['commitments']=[]
  order=copy.deepcopy(source['events'][0]['commitments'][0]['order']);order['targetAt']='2026-10-22T18:00:00Z'
  at='2026-10-21T12:01:00Z'
  source['events'].append(dict(eventId='cutover-move_out',sequence=2,at=at,kind='RESERVATION_TRANSFERRED_OUT',orderId='synthetic-a',transferId='cutover-move',toServiceDate='2026-10-22'))
  dest['events'].append(dict(eventId='cutover-move_in',sequence=2,at=at,kind='RESERVATION_TRANSFERRED_IN',order=order,transferId='cutover-move',fromServiceDate='2026-10-21',actualDecision='SUGGESTED'))
  for b in (source,dest):b['coverage'].update(eventCount=2,lastSequence=2,throughAt=at)
  ids=['006c357b-7af5-4907-a3b7-26b2e095ea9b','c0f5e398-d59b-4a96-af2e-39d7f8f2fc2f']
  bundle=dict(basis='CONSISTENT_TRANSFER_SNAPSHOT',project='hvrqgufqjslvgiohgkvu',streams=[dict(streamId=ids[0],batch=source),dict(streamId=ids[1],batch=dest)],transfers=[dict(transferId='cutover-move',sourceStream=ids[0],destinationStream=ids[1],eventAt=at,orderId='synthetic-a',targetAt=order['targetAt'])])
  with tempfile.TemporaryDirectory() as tmp:
   s=TransferBundleStore(Path(tmp)/'transfer-bundles.sqlite3',ids,enabled=True)
   try:
    s.enqueue(bundle);self.assertEqual(s.run_once()['comparisons'],1)
    results=s.acknowledged()[0]['results'];self.assertEqual([r['result']['remainingCommitments'] for r in results],[0,1]);self.assertTrue(all(r['result']['historicalDecisionCoverage'] is False for r in results))
   finally:s.close()
