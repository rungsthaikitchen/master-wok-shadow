import copy
from pathlib import Path
import tempfile
import unittest
from event_postgres_export import poll,source_identity,QUERY
from event_capture_journal import EventCaptureJournal,EventCaptureError,ROOT
import json
ID='11111111-1111-1111-1111-111111111111'
class ExportTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.j=EventCaptureJournal(Path(self.tmp.name)/'event-capture.sqlite3',source_identity(ID),enabled=True)
  batch=json.loads((ROOT/'staging-events/fixture.json').read_text())
  self.rows=[dict(stream_id=ID,scope='SYNTHETIC_STAGING_EVENTS',event_count=14,batch=batch)]
 def tearDown(self):self.j.close();self.tmp.cleanup()
 def test_disabled_and_production_refusal_precede_transport(self):
  self.assertEqual(poll(transport=lambda _:self.fail('disabled'))['sourceRequests'],0)
  with self.assertRaises(EventCaptureError):poll(self.j,ID,project='production',enabled=True,transport=lambda _:self.fail('production'))
 def test_export_replays_and_deduplicates(self):
  calls=[]
  transport=lambda payload:(calls.append(payload) or self.rows)
  self.assertEqual(poll(self.j,ID,enabled=True,transport=transport)['status'],'QUEUED')
  self.assertEqual(calls,[dict(query=QUERY,parameters=[ID])])
  self.assertEqual(self.j.run_once(enabled=True)['observations'],6)
  self.assertEqual(poll(self.j,ID,enabled=True,transport=transport)['status'],'ALREADY_QUEUED')
 def test_truncated_wrong_scope_and_private_input_refused_without_intake(self):
  for change in [lambda r:r[0].update(scope='PRODUCTION'),lambda r:r[0].update(event_count=15),
    lambda r:r[0]['batch']['events'][0]['order'].update(address='PRIVATE'),
    lambda r:r[0]['batch']['events'][10].update(proposalEventId='event-9')]:
   rows=copy.deepcopy(self.rows);change(rows)
   with self.assertRaises(Exception):poll(self.j,ID,enabled=True,transport=lambda _:rows)
  self.assertEqual(self.j.db.execute('SELECT count(*) FROM events').fetchone()[0],0)
