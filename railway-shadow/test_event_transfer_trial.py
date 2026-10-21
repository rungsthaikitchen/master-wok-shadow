import json
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from event_capture_journal import EventCaptureError
from event_transfer_trial import Budget,main,recover,STREAMS,opposite_moves,MOVE
ROOT=Path(__file__).resolve().parent.parent
class TransferTrialTests(unittest.TestCase):
 def test_default_off_and_restart_safe_concurrent_budget(self):
  main({})
  with self.assertRaises(EventCaptureError):main({'MASTER_WOK_TRANSFER_TRIAL_ENABLED':'true'})
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp)/'budget.sqlite3';b=Budget(p,100,clock=lambda:1);b.take('started')
   with self.assertRaises(EventCaptureError):Budget(p,100,clock=lambda:1).take('started')
   def take(_):
    try:b.take('writer');return True
    except EventCaptureError:return False
   with ThreadPoolExecutor(max_workers=4) as pool:self.assertEqual(sum(pool.map(take,range(20))),10)
   self.assertEqual(b.summary(),dict(started=1,writer=10))
   with self.assertRaises(EventCaptureError):Budget(p,1,clock=lambda:1).take('reader')
 def test_real_process_exit_rolls_back_ack_and_snapshot_recovers(self):
  b=json.loads((ROOT/'fixtures/cross-date-bundle-staging-export.json').read_text())
  mapping={s['streamId']:STREAMS[i] for i,s in enumerate(b['streams'])}
  for s in b['streams']:s['streamId']=mapping[s['streamId']]
  for t in b['transfers']:
   t['sourceStream']=mapping[t['sourceStream']];t['destinationStream']=mapping[t['destinationStream']]
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);result=recover(root,b)
   self.assertEqual(result['comparisons'],2)
   for path in (root/'transfer-bundles.sqlite3',root/'restored/transfer-bundles.sqlite3'):
    with sqlite3.connect(path) as db:self.assertEqual(db.execute('SELECT state FROM bundles').fetchall(),[('ACKED',)])
 def test_two_writer_sessions_are_invoked_before_reader_snapshot(self):
  calls=[];lock=threading.Lock();blocked=threading.Event()
  class Writer:
   def call(self,query,params,prepared=None,release=None,entered=None):
    with lock:calls.append((query,params))
    if prepared is not None:
     prepared.set()
     if not release.wait(3):raise AssertionError('release not signalled')
    else:entered.set();blocked.set()
    return 'RECORDED'
  def reader(_):
   self.assertTrue(blocked.is_set());self.assertEqual(len(calls),2)
   return [dict(bundle=dict(transfers=[],streams=[dict(batch=dict(events=[{}])),dict(batch=dict(events=[{}]))]))]
  with tempfile.TemporaryDirectory() as tmp:
   b=Budget(Path(tmp)/'budget.sqlite3',100,clock=lambda:1);opposite_moves(Writer(),reader,b)
   self.assertTrue(all(q==MOVE for q,p in calls));self.assertEqual(calls[0][1][:2],list(STREAMS));self.assertEqual(calls[1][1][:2],list(reversed(STREAMS)))
