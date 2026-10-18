import copy
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from delivery_comparison_journal import DeliveryComparisonJournal as Journal, ComparisonError
from delivery_evidence_journal import run_audit
from delivery_shadow_source import prepare_snapshot
from test_delivery_shadow_source import fixture, PROJECT, SECRET
from shadow_collector import digest, timestamp
import delivery_staging_worker as worker

class ComparisonTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.audit=run_audit(prepare_snapshot(fixture(),'2026-10-17',PROJECT,SECRET))
        cls.at=timestamp(cls.audit['observedAt']).timestamp()
        source=json.loads(subprocess.check_output(['node','-e',"process.stdout.write(JSON.stringify({cases:require('./staging-delivery/test_cases').makeCases()}))"],cwd=worker.ROOT))
        cls.batch=worker.compare(source)

    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.path=Path(self.temp.name)/'delivery-comparison.sqlite3'
        self.j=Journal(self.path,self.audit['sourceIdentity'],'SAVED_STATE_ONLY',enabled=True)

    def tearDown(self):
        self.j.close();self.temp.cleanup()

    def append(self,audit=None):
        return self.j.append_saved_audit(self.audit if audit is None else audit,'a'*64,self.at)

    def count(self,table):
        return self.j.db.execute('SELECT count(*) FROM '+table).fetchone()[0]

    def test_default_off_and_wrong_paths(self):
        p=Path(self.temp.name)/'unused'/'delivery-comparison.sqlite3'
        with self.assertRaisesRegex(ComparisonError,'DISABLED'):Journal(p,None,None)
        self.assertFalse(p.parent.exists())
        with self.assertRaises(ComparisonError):Journal(self.path.with_name('delivery-evidence.sqlite3'),'a'*64,'SAVED_STATE_ONLY',enabled=True)

    def test_restart_dedup_and_explicit_unverified(self):
        self.append();self.j.close()
        self.j=Journal(self.path,self.audit['sourceIdentity'],'SAVED_STATE_ONLY',enabled=True)
        self.append()
        self.assertEqual(self.count('snapshots'),1);self.assertEqual(self.count('observation_events'),2)
        r=json.loads(self.j.db.execute('SELECT payload FROM observations').fetchone()[0])
        self.assertEqual(r['prediction'],'UNVERIFIED');self.assertIsNone(r['planKind']);self.assertFalse(r['verified'])
        self.assertEqual(self.j.summary()['latestRecords'],len(self.audit['records']))

    def test_a_b_a_retains_event_history(self):
        a=self.append()['snapshotKey'];b=copy.deepcopy(self.audit)
        b['snapshotHash']=digest('changed');b['records'][0]['observedStatus']='completed'
        second=self.append(b)['snapshotKey'];third=self.append()['snapshotKey']
        self.assertEqual(a,third);self.assertNotEqual(a,second)
        self.assertEqual([x[0] for x in self.j.db.execute('SELECT snapshot_key FROM observation_events ORDER BY id')],[a,second,a])

    def test_missing_order_does_not_become_cancelled(self):
        self.append();empty=copy.deepcopy(self.audit)
        empty.update(records=[],deliveryOrders=0,unknownOrderTypes=0,snapshotHash=digest('empty'))
        self.append(empty)
        self.assertEqual(self.j.summary()['latestRecords'],0)
        self.assertGreater(self.count('observations'),0)

    def test_refuses_scope_crossing_and_unsafe_audits_atomically(self):
        with self.assertRaises(ComparisonError):self.j.append_synthetic(self.batch,1)
        for mutate in [lambda a:a.update(verified=True),lambda a:a.update(prediction='RECOMMENDED'),
                       lambda a:a['records'][0].update(address='private address')]:
            a=copy.deepcopy(self.audit);mutate(a)
            with self.assertRaises(Exception):self.append(a)
        self.assertEqual(self.count('snapshots'),0)

    def test_synthetic_success_and_missing_evidence_remain_distinct(self):
        p=Path(self.temp.name)/'synthetic'/'delivery-comparison.sqlite3'
        j=Journal(p,'b'*64,'SYNTHETIC_STAGING',enabled=True)
        try:
            j.append_synthetic(self.batch,1)
            predictions={r['prediction'] for r in j.summary()['observedStatusVsHypothetical']}
            self.assertEqual(predictions,{'RECOMMENDED','UNVERIFIED'})
            with self.assertRaises(ComparisonError):j.append_saved_audit(self.audit,'a'*64,self.at)
            raw=''.join(r[0] for r in j.db.execute('SELECT payload FROM observations'))
            for prohibited in ['durationSeconds','latitude','longitude','panang-curry','modifiers']:
                self.assertNotIn(prohibited,raw)
        finally:j.close()

    def test_scope_identity_lock_and_foreign_database_rejected(self):
        with self.assertRaises(Exception):Journal(self.path,self.audit['sourceIdentity'],'SAVED_STATE_ONLY',enabled=True)
        self.j.close()
        with self.assertRaises(ComparisonError):Journal(self.path,'b'*64,'SYNTHETIC_STAGING',enabled=True)
        self.j=Journal(self.path,self.audit['sourceIdentity'],'SAVED_STATE_ONLY',enabled=True)

    def test_disk_write_failure_rolls_back_snapshot_and_latest(self):
        self.append();before=self.count('observation_events')
        self.j.db.execute("CREATE TRIGGER fail_event BEFORE INSERT ON observation_events BEGIN SELECT RAISE(ABORT,'disk failure'); END")
        b=copy.deepcopy(self.audit);b['snapshotHash']=digest('new snapshot')
        with self.assertRaises(Exception):self.append(b)
        self.assertEqual(self.count('snapshots'),1);self.assertEqual(self.count('observation_events'),before)

    def test_stale_and_out_of_order_inputs_do_not_replace_latest(self):
        with self.assertRaises(ComparisonError):self.j.append_saved_audit(self.audit,'a'*64,self.at+181)
        self.j.append_saved_audit(self.audit,'a'*64,self.at+10)
        with self.assertRaisesRegex(ComparisonError,'OUT_OF_ORDER'):self.append()
        self.assertEqual(self.count('observation_events'),1)

    def test_corrupt_record_cannot_silently_count_as_healthy(self):
        self.append()
        self.j.db.execute("UPDATE observations SET payload='{}'")
        with self.assertRaisesRegex(ComparisonError,'CORRUPT'):self.j.summary()
