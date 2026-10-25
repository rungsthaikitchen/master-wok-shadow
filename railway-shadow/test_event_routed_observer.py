import copy
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
from event_capture_journal import EventCaptureError
from event_routed_observer import RoutedObserver

ROOT=Path(__file__).resolve().parent.parent

class RoutedObserverTests(unittest.TestCase):
 CAPTURE='command-route-local-captures.json'
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)/'observer'
  self.data=json.loads((ROOT/'fixtures'/self.CAPTURE).read_text());self.packet=self.data['initial'];self.now=1000;self.reads=0;self.during=[]
  def reader(payload):
   self.reads+=1;self.during.append(self.observer.status()['healthy']);return [dict(packet=copy.deepcopy(self.packet))]
  self.reader=reader;self.observer=RoutedObserver(self.root,self.packet['routeId'],reader,enabled=True,clock=lambda:self.now)
 def tearDown(self):self.observer.close();self.tmp.cleanup()
 def count(self,stream):
  db=sqlite3.connect(self.root/stream/'event-capture.sqlite3')
  try:return db.execute('SELECT count(*) FROM observations').fetchone()[0]
  finally:db.close()
 def test_default_off_and_explicit_switch_preserve_both_journals(self):
  self.assertEqual(RoutedObserver().cycle()['sourceRequests'],0);self.assertFalse(self.observer.status()['healthy'])
  self.assertEqual(self.observer.cycle()['status'],'OBSERVED');old=self.packet['streamId'];self.assertEqual(self.count(old),1)
  self.packet=self.data['switched'];self.now+=60;self.assertEqual(self.observer.cycle()['generation'],1);new=self.packet['streamId']
  self.assertEqual(self.count(old),2);self.assertEqual(self.count(new),0)
  self.packet=self.data['final'];self.now+=60;self.assertEqual(self.observer.cycle()['status'],'OBSERVED');self.assertEqual(self.count(new),1)
  self.assertTrue(self.observer.status()['healthy']);self.assertEqual(self.during,[False,False,False]);self.now+=181;self.assertFalse(self.observer.status()['healthy'])
 def test_crash_after_new_journal_ack_before_route_commit_recovers_on_fresh_read(self):
  self.observer.cycle();self.packet=self.data['switched'];self.now+=60
  def fail():raise OSError('before pointer commit')
  self.assertEqual(self.observer.cycle(before_route_commit=fail)['status'],'UNVERIFIED');self.assertFalse(self.observer.status()['healthy'])
  self.assertEqual(self.observer.db.execute('SELECT generation FROM route_state').fetchone()[0],0)
  self.observer.close();self.observer=RoutedObserver(self.root,self.packet['routeId'],self.reader,enabled=True,clock=lambda:self.now)
  self.assertFalse(self.observer.status()['healthy']);self.assertEqual(self.observer.cycle()['status'],'OBSERVED');self.assertEqual(self.count(self.packet['streamId']),0)
 def test_bad_attestation_wrong_predecessor_and_regression_cannot_reuse_health(self):
  self.observer.cycle();good=copy.deepcopy(self.data['switched'])
  for key,value in (('attested',False),('previousStreamId','33333333-3333-3333-3333-333333333333')):
   self.packet=copy.deepcopy(good);self.packet[key]=value;self.now+=1
   self.assertEqual(self.observer.cycle()['status'],'UNVERIFIED');self.assertFalse(self.observer.status()['healthy'])
  self.packet=good;self.now+=1;self.assertEqual(self.observer.cycle()['status'],'OBSERVED')
  self.packet=self.data['initial'];self.now+=1;self.assertEqual(self.observer.cycle()['reasonCode'],'ROUTE_GENERATION_REFUSED');self.assertFalse(self.observer.status()['healthy'])
 def test_budget_and_limit_cannot_be_reset_on_restart(self):
  self.observer.close();self.root=Path(self.tmp.name)/'limited'
  self.observer=RoutedObserver(self.root,self.packet['routeId'],self.reader,enabled=True,read_limit=1,clock=lambda:self.now)
  self.assertEqual(self.observer.cycle()['status'],'OBSERVED');self.observer.close()
  self.observer=RoutedObserver(self.root,self.packet['routeId'],self.reader,enabled=True,read_limit=1,clock=lambda:self.now)
  before=self.reads;self.assertEqual(self.observer.cycle()['sourceRequests'],0);self.assertEqual(self.reads,before)
  self.observer.close()
  with self.assertRaises(EventCaptureError):RoutedObserver(self.root,self.packet['routeId'],self.reader,enabled=True,read_limit=2)
 def test_failed_recovery_and_invalid_clock_never_commit_health(self):
  with patch('event_routed_observer.snapshot',side_effect=OSError('snapshot failure')):self.assertEqual(self.observer.cycle()['status'],'UNVERIFIED')
  self.assertFalse(self.observer.status()['healthy']);self.assertEqual(self.observer.cycle()['status'],'OBSERVED')
  self.now=float('nan');before=self.reads;self.assertEqual(self.observer.cycle()['sourceRequests'],0);self.assertEqual(self.reads,before);self.assertFalse(self.observer.status()['healthy'])
 def test_retired_history_corruption_invalidates_current_health(self):
  self.observer.cycle();old=self.packet['streamId'];self.packet=self.data['switched'];self.now+=60
  self.assertEqual(self.observer.cycle()['status'],'OBSERVED');self.assertEqual(self.count(old),2)
  db=sqlite3.connect(self.root/old/'event-capture.sqlite3')
  try:db.execute("UPDATE observations SET payload_hash='corrupt'");db.commit()
  finally:db.close()
  before=self.reads;self.assertFalse(self.observer.status()['healthy']);self.assertEqual(self.reads,before)
 def test_other_database_and_symlink_paths_are_refused_without_modification(self):
  other=Path(self.tmp.name)/'other';other.mkdir();db=sqlite3.connect(other/'route-state.sqlite3');db.execute('CREATE TABLE keep_me(value TEXT)');db.commit();db.close()
  with self.assertRaises(EventCaptureError):RoutedObserver(other,self.packet['routeId'],self.reader,enabled=True)
  db=sqlite3.connect(other/'route-state.sqlite3')
  try:self.assertEqual(db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall(),[('keep_me',)])
  finally:db.close()
  link=Path(self.tmp.name)/'link';link.symlink_to(other)
  with self.assertRaises(EventCaptureError):RoutedObserver(link,self.packet['routeId'],self.reader,enabled=True)

class HostedRoutedObserverTests(RoutedObserverTests):CAPTURE='command-route-hosted-captures.json'

if __name__=='__main__':unittest.main()
