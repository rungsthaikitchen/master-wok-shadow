"""Independent readback from the bounded hosted trial, never production history."""
import copy
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from event_routed_observer import RoutedObserver

CAPTURE=Path(__file__).resolve().parent.parent/'fixtures/command-route-runtime-hosted-captures.json'

class HostedRouteCaptureTests(unittest.TestCase):
 def count(self,root,stream):
  with sqlite3.connect(root/stream/'event-capture.sqlite3') as db:
   return db.execute('SELECT count(*) FROM observations').fetchone()[0]
 def test_final_handover_prefixes_recover_on_fresh_import_and_restart(self):
  data=json.loads(CAPTURE.read_text());p=data['packets']['before'];reads=[]
  self.assertEqual(data['before_reservations'],0);self.assertEqual(data['before_status'],'customer_declined_time')
  def reader(payload):reads.append(payload);return [dict(packet=copy.deepcopy(p))]
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp)/'observer'
   for _ in range(2):
    observer=RoutedObserver(root,p['routeId'],reader,enabled=True)
    try:
     self.assertFalse(observer.status()['healthy']);result=observer.cycle()
     self.assertEqual(result['status'],'OBSERVED');self.assertTrue(observer.status()['healthy'])
     self.assertEqual(self.count(root,p['previousStreamId']),2);self.assertEqual(self.count(root,p['streamId']),1)
    finally:observer.close()
   self.assertEqual(len(reads),2)
 def test_committed_rolled_back_and_timeout_routes_replay_only_real_decisions(self):
  data=json.loads(CAPTURE.read_text())
  for name,generation,count in [('after',1,1),('rollback',0,2),('timeout',0,2)]:
   p=data['packets'][name]
   with self.subTest(case=name),tempfile.TemporaryDirectory() as tmp:
    observer=RoutedObserver(Path(tmp)/'observer',p['routeId'],lambda _:[dict(packet=copy.deepcopy(p))],enabled=True)
    try:
     self.assertEqual(observer.cycle()['generation'],generation)
     self.assertEqual(self.count(Path(tmp)/'observer',p['streamId']),count)
     self.assertFalse(observer.status()['verified'])
    finally:observer.close()

if __name__=='__main__':unittest.main()
