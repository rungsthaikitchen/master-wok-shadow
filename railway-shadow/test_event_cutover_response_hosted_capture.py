import json
from pathlib import Path
import tempfile
import unittest
from event_capture_journal import EventCaptureJournal,invoke_node
from event_postgres_export import source_identity,ingest_export

ROOT=Path(__file__).resolve().parent.parent
STREAM='74247071-2b40-52cc-8b7b-dfd260a5b7cd'

class CutoverHttpCaptureTests(unittest.TestCase):
 def test_actual_restricted_login_http_capture_preserves_revision_order_and_no_double_count(self):
  data=json.loads((ROOT/'fixtures/cutover-response-http-hosted-capture.json').read_text())
  self.assertEqual((data['sourceEventCount'],data['destinationEventCount'],data['remainingReservations']),(2,4,0))
  self.assertEqual(data['finalStatus'],'customer_declined_time')
  batch=data['batch'];events=batch['events']
  self.assertEqual([e['kind'] for e in events],['CUTOVER_BASELINE','PROPOSAL_RESPONSE','BOOKING_DECISION','PROPOSAL_RESPONSE'])
  self.assertEqual(events[0]['commitments'][0]['proposalEventId'],'offer-a')
  self.assertEqual((events[1]['proposalEventId'],events[1]['response']),('offer-a','ACCEPTED'))
  self.assertEqual(events[2]['eventId'],'offer-b')
  self.assertEqual((events[3]['proposalEventId'],events[3]['response']),('offer-b','REJECTED'))
  result=invoke_node(batch)
  self.assertEqual((result['decisionCount'],result['remainingCommitments']),(1,0))
  self.assertFalse(result['historicalDecisionCoverage']);self.assertFalse(result['verified'])
  with tempfile.TemporaryDirectory() as tmp:
   path=Path(tmp)/'event-capture.sqlite3';j=EventCaptureJournal(path,source_identity(STREAM),enabled=True)
   try:
    rows=[dict(stream_id=STREAM,scope='SYNTHETIC_STAGING_EVENTS',event_count=4,batch=batch)]
    ingest_export(rows,j,STREAM);self.assertEqual(j.run_once(enabled=True)['observations'],1)
    ingest_export(rows,j,STREAM);self.assertEqual(j.run_once(enabled=True)['status'],'IDLE')
   finally:j.close()
   j=EventCaptureJournal(path,source_identity(STREAM),enabled=True)
   try:self.assertEqual(j.run_once(enabled=True)['status'],'IDLE');self.assertEqual(j.summary()['counts']['observations'],1)
   finally:j.close()

if __name__=='__main__':unittest.main()
