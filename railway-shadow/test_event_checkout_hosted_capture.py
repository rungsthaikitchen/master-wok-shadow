"""Independent synthetic hosted checkout exports, processed by the real journal."""
import json
from pathlib import Path
import tempfile
import unittest
from event_capture_journal import EventCaptureJournal
from event_postgres_export import source_identity,ingest_export

DATA=Path(__file__).resolve().parent.parent/'fixtures/checkout-submission-runtime-hosted-capture.json'
class HostedCheckoutTests(unittest.TestCase):
 def test_each_export_replays_once_without_inventing_booking_decisions(self):
  data=json.loads(DATA.read_text())
  self.assertEqual((data['orders'],data['items'],data['reservations'],data['events'],len(data['receipts'])),(6,12,6,6,6))
  for name,p in data['packets'].items():
   with self.subTest(case=name),tempfile.TemporaryDirectory() as tmp:
    path=Path(tmp)/'event-capture.sqlite3';identity=source_identity(p['streamId'])
    journal=EventCaptureJournal(path,identity,enabled=True)
    try:
     rows=[dict(stream_id=p['streamId'],scope='SYNTHETIC_STAGING_EVENTS',event_count=p['eventCount'],batch=p['batch'])]
     ingest_export(rows,journal,p['streamId']);result=journal.run_once(enabled=True)
     self.assertEqual(result['status'],'RECORDED');self.assertEqual(result['observations'],0)
     self.assertEqual(journal.db.execute('SELECT count(*) FROM events').fetchone()[0],2 if name=='http' else 1)
     self.assertEqual(journal.db.execute('SELECT count(*) FROM observations').fetchone()[0],0)
    finally:journal.close()
    journal=EventCaptureJournal(path,identity,enabled=True)
    try:self.assertEqual(journal.run_once(enabled=True)['status'],'IDLE')
    finally:journal.close()
 def test_receipts_retain_complete_supported_baskets_and_delivery_has_no_fabricated_estimate(self):
  data=json.loads(DATA.read_text());requests=[r['requestId'] for r in data['receipts']]
  self.assertEqual(len(requests),len(set(requests)))
  self.assertIn('checkout-rollback-second',requests);self.assertNotIn('checkout-rollback',requests)
  for receipt in data['receipts']:
   payload=receipt['checkout'];self.assertEqual(len(payload['lines']),2)
   self.assertEqual(sum(x['qty']*x['unit_price_pence'] for x in payload['lines']),payload['subtotal_pence'])
  events=[e for p in data['packets'].values() for e in p['batch']['events']]
  deliveries=[e for e in events if e['order']['orderType']=='delivery'];self.assertEqual(len(deliveries),1)
  self.assertIsNone(deliveries[0]['order']['deliveryReadyEstimate'])
  for event in events:
   self.assertEqual(event['kind'],'RESERVATION_SET');self.assertNotIn('customer_alias',json.dumps(event));self.assertNotIn('pence',json.dumps(event))

if __name__=='__main__':unittest.main()
