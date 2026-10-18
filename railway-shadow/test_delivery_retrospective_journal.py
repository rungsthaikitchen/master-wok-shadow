import json
import tempfile
import unittest
from pathlib import Path
from delivery_comparison_journal import DeliveryComparisonJournal, ComparisonError
from shadow_collector import timestamp

def aggregate():
    return dict(status='SHADOW_RECOMMENDATION',reasonCode='SEPARATE_TRIPS_PREFERRED',
        networkRequests=2,verified=False,
        evidenceBasis='RETROSPECTIVE_CONDITIONAL_SCENARIO_NOT_DECISION_HISTORY',
        journeyBasis='CURRENT_ESTIMATES_APPLIED_RETROSPECTIVELY',
        clockMapping='DURATIONS_APPLIED_TO_HYPOTHETICAL_HISTORICAL_CLOCK_NOT_BACKDATED_MEASUREMENTS',
        serviceDate='2026-10-17',persistence='NONE',provider='GOOGLE_ROUTES',attribution='Google Maps')

class RetrospectiveJournalTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.path=Path(self.tmp.name)/'delivery-comparison.sqlite3'
        self.j=DeliveryComparisonJournal(self.path,'a'*64,'RETROSPECTIVE_CONDITIONAL',enabled=True)
        self.capture='2026-10-18T16:37:52+00:00'
        self.at=timestamp(self.capture).timestamp()

    def tearDown(self):
        self.j.close()
        self.tmp.cleanup()

    def append(self,r=None,**kw):
        args=dict(source_hash='b'*64,build_hash='c'*64,observed_status='completed',
                  captured_at=self.capture,at=self.at)
        args.update(kw)
        return self.j.append_retrospective(aggregate() if r is None else r,**args)

    def test_restart_keeps_conditional_separate_from_accuracy(self):
        self.append();self.j.close()
        self.j=DeliveryComparisonJournal(self.path,'a'*64,'RETROSPECTIVE_CONDITIONAL',enabled=True)
        self.append()
        s=self.j.summary()
        self.assertFalse(s['verified'])
        self.assertEqual(s['observedStatusVsHypothetical'],[
            dict(observedStatus='completed',prediction='CONDITIONAL_RECOMMENDATION',count=1)])
        self.assertEqual(self.j.db.execute('select count(*) from observation_events').fetchone()[0],2)
        payload=json.loads(self.j.db.execute('select payload from observations').fetchone()[0])
        self.assertNotIn('orderAlias',payload)
        self.assertNotIn('persistence',payload)
        self.assertEqual(payload['assessedAt'],self.capture)

    def test_private_fields_rejected_atomically(self):
        for key in ['points','durationSeconds','recommendation','address','basket','orderId']:
            r=aggregate();r[key]='private'
            with self.assertRaises(ComparisonError):self.append(r)
        self.assertEqual(self.j.db.execute('select count(*) from observations').fetchone()[0],0)

    def test_failure_result_stays_unverified(self):
        r=aggregate();r.update(status='UNVERIFIED',reasonCode='NO_FEASIBLE_PLAN_IN_ARRIVAL_WINDOWS')
        self.append(r)
        self.assertEqual(self.j.summary()['observedStatusVsHypothetical'][0]['prediction'],'UNVERIFIED')

    def test_invalid_evidence_and_binding_refused(self):
        for key,value in [('verified',True),('networkRequests',True),('networkRequests',3),
                          ('evidenceBasis','DECISION_HISTORY'),('serviceDate','bad'),
                          ('reasonCode','customer address'),('status','UNVERIFIED')]:
            r=aggregate();r[key]=value
            with self.assertRaises(ComparisonError):self.append(r)
        for kw in [dict(source_hash='bad'),dict(build_hash='bad'),dict(observed_status='pending'),
                   dict(at=self.at+181),dict(at=self.at-6),dict(captured_at='bad')]:
            with self.assertRaises(Exception):self.append(**kw)

    def test_default_off_scope_crossing_and_foreign_identity(self):
        p=Path(self.tmp.name)/'off'/'delivery-comparison.sqlite3'
        with self.assertRaisesRegex(ComparisonError,'DISABLED'):
            DeliveryComparisonJournal(p,'a'*64,'RETROSPECTIVE_CONDITIONAL')
        self.assertFalse(p.parent.exists())
        self.j.close()
        with self.assertRaises(ComparisonError):
            DeliveryComparisonJournal(self.path,'a'*64,'SYNTHETIC_STAGING',enabled=True)
        self.j=DeliveryComparisonJournal(self.path,'a'*64,'RETROSPECTIVE_CONDITIONAL',enabled=True)
        self.j.scope='SAVED_STATE_ONLY'
        with self.assertRaises(ComparisonError):self.append()
        self.j.scope='RETROSPECTIVE_CONDITIONAL'

    def test_write_failure_rolls_back(self):
        self.j.db.execute("CREATE TRIGGER fail_event BEFORE INSERT ON observation_events BEGIN SELECT RAISE(ABORT,'failure'); END")
        with self.assertRaises(Exception):self.append()
        self.assertEqual(self.j.db.execute('select count(*) from snapshots').fetchone()[0],0)
