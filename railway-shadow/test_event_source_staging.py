import copy
from pathlib import Path
import tempfile
import unittest
from event_source_staging import StagingEventSource,SCOPE
from event_capture_journal import EventCaptureJournal,EventCaptureError
from test_event_capture_journal import fixture
class SourceTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.path=self.root/'synthetic-source.sqlite3'
        self.source=StagingEventSource(self.path,'2026-10-17',enabled=True,scope=SCOPE)
    def tearDown(self):self.source.close();self.tmp.cleanup()
    def events(self):
        events=copy.deepcopy(fixture()['events'])
        for e in events:e.pop('sequence')
        return events
    def test_atomicity_duplicates_and_replay(self):
        def fail():raise OSError('simulated failure')
        with self.assertRaises(OSError):self.source.record(self.events()[0],before_commit=fail)
        for table in ['bookings','outbox']:self.assertEqual(self.source.db.execute('SELECT count(*) FROM '+table).fetchone()[0],0)
        for e in self.events():self.source.record(e)
        self.assertEqual(self.source.record(self.events()[0]),'ALREADY_RECORDED')
        batch=self.source.export('2026-10-17T22:00:00Z');self.assertEqual(batch,fixture())
        j=EventCaptureJournal(self.root/'event-capture.sqlite3',self.source.identity,enabled=True)
        try:
            j.enqueue(batch);self.assertEqual(j.run_once(enabled=True)['observations'],5)
            self.source.close();self.source=StagingEventSource(self.path,'2026-10-17',enabled=True,scope=SCOPE)
            self.assertEqual(j.enqueue(self.source.export('2026-10-17T22:00:00Z'))['status'],'ALREADY_QUEUED')
        finally:j.close()
    def test_watermark_invalid_input_and_id_reuse(self):
        self.source.record(self.events()[0]);self.source.export('2026-10-17T15:01:00Z')
        with self.assertRaises(EventCaptureError):self.source.record(self.events()[1])
        with self.assertRaises(EventCaptureError):self.source.export('2026-10-17T15:00:00Z')
        event=self.events()[0];event['order']['targetAt']='2026-10-17T18:00:00Z'
        with self.assertRaises(EventCaptureError):self.source.record(event)
        event=self.events()[2];event['order']['address']='private'
        with self.assertRaises(EventCaptureError):self.source.record(event)
        self.assertEqual(self.source.db.execute('SELECT count(*) FROM outbox').fetchone()[0],1)
    def test_default_off(self):
        with self.assertRaises(EventCaptureError):StagingEventSource(self.path,'2026-10-17')
