import json
from pathlib import Path
import tempfile
import unittest
from event_source_staging import StagingEventSource,SCOPE
from event_capture_journal import EventCaptureJournal,verify_store,snapshot
class TransferCaptureTests(unittest.TestCase):
 def test_actual_transfer_histories_persist_replay_and_verify_snapshots(self):
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
      j.enqueue(source.export(batch['coverage']['throughAt']))
      self.assertEqual(j.run_once(enabled=True)['observations'],1)
      self.assertEqual(verify_store(j.db,j.identity)['observations'],1)
      snapshot(j,root/'verified-snapshot.sqlite3')
     finally:j.close()
    finally:source.close()
