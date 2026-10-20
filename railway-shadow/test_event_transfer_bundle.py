import copy
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
from event_transfer_bundle import TransferBundleStore,EventCaptureError,poll_pair,invoke
from event_transfer_reader import TransferPairReader
from event_runtime_transport import ROLES
from test_event_booking_transport import DSN
ROOT=Path(__file__).resolve().parent.parent
IDS=['006c357b-7af5-4907-a3b7-26b2e095ea9b','c0f5e398-d59b-4a96-af2e-39d7f8f2fc2f']
def fixture():return json.loads((ROOT/'fixtures/cross-date-bundle-staging-export.json').read_text())
class BundleTests(unittest.TestCase):
 def test_default_off_and_missing_side_before_persistence(self):
  self.assertEqual(poll_pair()['status'],'DISABLED');self.assertEqual(TransferPairReader()(None)['status'],'DISABLED')
  with tempfile.TemporaryDirectory() as tmp:
   path=Path(tmp)/'transfer-bundles.sqlite3'
   with self.assertRaises(EventCaptureError):TransferBundleStore(path,IDS)
   s=TransferBundleStore(path,IDS,enabled=True)
   try:
    bad=fixture();bad['transfers'].pop()
    with self.assertRaises(EventCaptureError):s.enqueue(bad)
    self.assertEqual(s.db.execute('SELECT count(*) FROM bundles').fetchone()[0],0)
   finally:s.close()
 def test_atomic_ack_failure_retry_restart_and_snapshot(self):
  with tempfile.TemporaryDirectory() as tmp:
   path=Path(tmp)/'transfer-bundles.sqlite3';s=TransferBundleStore(path,IDS,enabled=True)
   try:
    self.assertEqual(s.enqueue(fixture())['status'],'QUEUED')
    def fail():raise OSError('forced after both comparisons')
    with self.assertRaises(OSError):s.run_once(before_commit=fail)
    self.assertEqual(s.acknowledged(),[]);self.assertEqual(s.db.execute('SELECT state FROM bundles').fetchone()[0],'PENDING')
    self.assertEqual(s.run_once()['comparisons'],2);self.assertEqual(len(s.acknowledged()),1)
    snapshot=Path(tmp)/'bundle-snapshot.sqlite3';self.assertEqual(s.snapshot(snapshot),dict(acknowledged=1,bundles=1))
    with sqlite3.connect(snapshot) as db:self.assertEqual(s.verify(db),dict(acknowledged=1,bundles=1))
   finally:s.close()
   s=TransferBundleStore(path,list(reversed(IDS)),enabled=True)
   try:self.assertEqual(s.enqueue(fixture())['status'],'ALREADY_QUEUED');self.assertEqual(s.run_once()['status'],'IDLE');self.assertEqual(len(s.acknowledged()),1)
   finally:s.close()
 def test_mixed_worker_result_cannot_acknowledge_either_stream(self):
  with tempfile.TemporaryDirectory() as tmp:
   s=TransferBundleStore(Path(tmp)/'transfer-bundles.sqlite3',IDS,enabled=True)
   try:
    s.enqueue(fixture());result=invoke(fixture());result['results'].pop()
    with patch('event_transfer_bundle.invoke',return_value=result):
     with self.assertRaises(EventCaptureError):s.run_once()
    self.assertEqual(s.acknowledged(),[])
   finally:s.close()
 def test_reader_fixed_parameterized_read_only_query_and_scope(self):
  calls=[];replies=[(ROLES['reader'],False,False),(False,False)]
  class Cursor:
   def __enter__(self):return self
   def __exit__(self,*a):pass
   def execute(self,q,p=None):calls.append((q,p))
   def fetchone(self):return replies.pop(0)
   def fetchall(self):return [(fixture(),)]
  class Connection:
   def __enter__(self):return self
   def __exit__(self,*a):pass
   def cursor(self):return Cursor()
  from event_transfer_bundle import QUERY
  t=TransferPairReader(DSN.replace(ROLES['writer'],ROLES['reader']),enabled=True,connect=lambda **_:Connection())
  self.assertEqual(t(dict(query=QUERY,parameters=IDS))[0]['bundle']['basis'],'CONSISTENT_TRANSFER_SNAPSHOT');self.assertEqual(calls[0][0],'SET TRANSACTION READ ONLY');self.assertEqual(calls[-1][1],IDS)
  with self.assertRaises(EventCaptureError):t(dict(query='UPDATE public.orders SET status=\'cancelled\'',parameters=IDS))
 def test_prefix_rewrite_and_partial_intake_failure_roll_back_both_watermarks(self):
  with tempfile.TemporaryDirectory() as tmp:
   s=TransferBundleStore(Path(tmp)/'transfer-bundles.sqlite3',IDS,enabled=True)
   try:
    s.enqueue(fixture());before=s.db.execute('SELECT * FROM streams ORDER BY id').fetchall()
    altered=fixture()
    for stream in altered['streams']:
     for e in stream['batch']['events']:
      if 'order' in e:e['order']['lines'][0]['qty']=2
    with self.assertRaises(EventCaptureError):s.enqueue(altered)
    with s.db:s.db.execute("CREATE TRIGGER fail_second BEFORE INSERT ON streams WHEN NEW.id='c0f5e398-d59b-4a96-af2e-39d7f8f2fc2f' BEGIN SELECT RAISE(ABORT,'forced second watermark failure'); END")
    extended=fixture()
    for i,stream in enumerate(extended['streams']):
     b=stream['batch'];n=len(b['events'])+1
     order=copy.deepcopy(next(e['order'] for e in b['events'] if 'order' in e));order['orderId']='synthetic-unrelated-'+str(i)
     b['events'].append(dict(eventId='declined-'+str(i),sequence=n,at='2026-10-20T10:04:00Z',kind='BOOKING_DECISION',order=order,actualDecision='DECLINED'))
     b['coverage'].update(eventCount=n,lastSequence=n,throughAt='2026-10-20T10:04:00Z')
    with self.assertRaises(sqlite3.IntegrityError):s.enqueue(extended)
    self.assertEqual(s.db.execute('SELECT * FROM streams ORDER BY id').fetchall(),before)
    self.assertEqual(s.db.execute('SELECT count(*) FROM bundles').fetchone()[0],1)
   finally:s.close()
