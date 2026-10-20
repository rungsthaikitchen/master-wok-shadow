import json
from pathlib import Path
import tempfile
import unittest
from event_source_staging import StagingEventSource,SCOPE
from event_capture_journal import EventCaptureJournal,verify_store,snapshot,EventCaptureError
from event_transfer_bundle import TransferBundleStore
class TransferCaptureTests(unittest.TestCase):
 def test_transfer_histories_require_atomic_bundle_before_ack(self):
  data=json.loads((Path(__file__).resolve().parent.parent/'fixtures/cross-date-staging-capture.json').read_text())
  with tempfile.TemporaryDirectory() as tmp:
   for name,batch in data.items():
    root=Path(tmp)/name;root.mkdir()
    source=StagingEventSource(root/'synthetic-source.sqlite3',batch['serviceDate'],enabled=True,scope=SCOPE)
    try:
     for event in batch['events']:
      event=dict(event);event.pop('sequence');source.record(event)
     self.assertEqual(source.db.execute('SELECT count(*) FROM bookings').fetchone()[0],0)
     j=EventCaptureJournal(root/'event-capture.sqlite3',source.identity,enabled=True)
     try:
      with self.assertRaisesRegex(EventCaptureError,'TRANSFER_BUNDLE_REQUIRED'):j.enqueue(source.export(batch['coverage']['throughAt']))
      self.assertEqual(j.run_once(enabled=True)['status'],'IDLE')
      self.assertEqual(verify_store(j.db,j.identity)['observations'],0)
      snapshot(j,root/'verified-snapshot.sqlite3')
     finally:j.close()
    finally:source.close()

   ids=['006c357b-7af5-4907-a3b7-26b2e095ea9b','c0f5e398-d59b-4a96-af2e-39d7f8f2fc2f'];a=data['source_batch'];b=data['destination_batch'];receipts=[]
   for e in a['events']:
    if 'transferId' not in e:continue
    outgoing=e['kind']=='RESERVATION_TRANSFERRED_OUT';incoming=next(x for x in b['events'] if x.get('transferId')==e['transferId']) if outgoing else e
    receipts.append(dict(transferId=e['transferId'],sourceStream=ids[0 if outgoing else 1],destinationStream=ids[1 if outgoing else 0],eventAt=e['at'],orderId='synthetic-cross-date',targetAt=incoming['order']['targetAt']))
   bundle=dict(basis='CONSISTENT_TRANSFER_SNAPSHOT',project='hvrqgufqjslvgiohgkvu',streams=[dict(streamId=ids[0],batch=a),dict(streamId=ids[1],batch=b)],transfers=receipts)
   store=TransferBundleStore(Path(tmp)/'transfer-bundles.sqlite3',ids,enabled=True)
   try:
    store.enqueue(bundle);self.assertEqual(store.run_once()['comparisons'],2)
    self.assertEqual(store.snapshot(Path(tmp)/'paired-snapshot.sqlite3'),dict(acknowledged=1,bundles=1))
   finally:store.close()
