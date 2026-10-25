import json
from pathlib import Path
import tempfile
import unittest
from event_capture_journal import EventCaptureJournal,EventCaptureError
from event_postgres_export import ingest_export,source_identity

ROOT=Path(__file__).resolve().parent.parent
OLD='d8316d40-dba5-5cfc-9b3b-b1b6b44757c5'
NEW='76233fa7-6e66-544c-ba50-8e072954d6a0'

def rows():
 streams=json.loads((ROOT/'fixtures/cutover-concurrency-hosted-25-oct.json').read_text())['streams']
 s=next(s for s in streams if s['id']==NEW)
 return [dict(stream_id=NEW,scope='SYNTHETIC_STAGING_EVENTS',event_count=s['eventCount'],batch=s['batch'])]

class ObserverHandoverTests(unittest.TestCase):
 def test_old_journal_cannot_be_relabelled_as_new_source(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp)/'event-capture.sqlite3';j=EventCaptureJournal(p,source_identity(OLD),enabled=True)
   try:
    with self.assertRaisesRegex(EventCaptureError,'SOURCE_IDENTITY_MISMATCH'):ingest_export(rows(),j,NEW)
    self.assertEqual(j.summary()['counts']['observations'],0)
   finally:j.close()
   with self.assertRaisesRegex(EventCaptureError,'EVENT_STORE_IDENTITY_MISMATCH'):EventCaptureJournal(p,source_identity(NEW),enabled=True)
 def test_new_journal_handover_retries_without_historical_decision_backfill(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp)/'event-capture.sqlite3';j=EventCaptureJournal(p,source_identity(NEW),enabled=True)
   try:
    ingest_export(rows(),j,NEW)
    def interrupted():raise OSError('before ACK')
    self.assertEqual(j.run_once(enabled=True,before_commit=interrupted)['status'],'UNVERIFIED')
   finally:j.close()
   j=EventCaptureJournal(p,source_identity(NEW),enabled=True)
   try:
    ingest_export(rows(),j,NEW);r=j.run_once(enabled=True)
    self.assertEqual(r['status'],'RECORDED');self.assertEqual(r['observations'],0)
    self.assertEqual(j.run_once(enabled=True)['status'],'IDLE')
    wrong=rows();wrong[0]['stream_id']=OLD
    with self.assertRaisesRegex(EventCaptureError,'EXPORT_COVERAGE_REQUIRED'):ingest_export(wrong,j,NEW)
    self.assertEqual(j.summary()['counts']['observations'],0)
   finally:j.close()

if __name__=='__main__':unittest.main()
