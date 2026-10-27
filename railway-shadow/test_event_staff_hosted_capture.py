"""Replay actual hosted synthetic evidence into persistent local shadow journals."""
import json
from pathlib import Path
import tempfile
import unittest
from event_capture_journal import EventCaptureJournal
from event_postgres_export import poll,source_identity
ROOT=Path(__file__).resolve().parent.parent
class HostedStaffCaptureTests(unittest.TestCase):
 def test_actual_hosted_events_replay_and_restart_without_duplicate_observations(self):
  cases=json.loads((ROOT/'fixtures/staff-command-hosted-capture-27-oct.json').read_text())['verification']['cases']
  fixtures={f['name']:f for f in json.loads((ROOT/'fixtures/staff-command-trial-27-oct-v1.json').read_text())};total=0
  for c in cases:
   with self.subTest(case=c['name']),tempfile.TemporaryDirectory() as tmp:
    f=fixtures[c['name']];path=Path(tmp)/'event-capture.sqlite3';identity=source_identity(f['stream']);j=EventCaptureJournal(path,identity,enabled=True)
    try:
     poll(j,f['stream'],enabled=True,transport=lambda _:[dict(stream_id=f['stream'],scope='SYNTHETIC_STAGING_EVENTS',event_count=c['eventCount'],batch=c['batch'])])
     r=j.run_once(enabled=True);self.assertEqual(r['status'],'RECORDED');expected=1 if c['name']=='audit' else 2;self.assertEqual(r['observations'],expected)
     rows=[json.loads(row[0]) for row in j.db.execute('SELECT payload FROM observations')];self.assertEqual(len(rows),expected)
     self.assertTrue(all(row['actualDecision']=='SUGGESTED' and row['verified'] is False for row in rows));total+=len(rows)
    finally:j.close()
    j=EventCaptureJournal(path,identity,enabled=True)
    try:self.assertEqual(j.run_once(enabled=True)['status'],'IDLE');self.assertEqual(j.db.execute('SELECT count(*) FROM observations').fetchone()[0],expected)
    finally:j.close()
  self.assertEqual(total,11)
if __name__=='__main__':unittest.main()
