import copy
import json
from pathlib import Path
import os
import sqlite3
import tempfile
import subprocess
import sys
import unittest
from unittest.mock import patch
from delivery_evidence_journal import (DeliveryEvidenceJournal as Journal,EvidenceError,poll_evidence,
                                      run_audit,evidence_health,APPLICATION_ID)
from delivery_shadow_source import prepare_snapshot
from shadow_collector import timestamp,digest
from test_delivery_shadow_source import fixture,PROJECT,SECRET

DAY='2026-10-17'
AT=timestamp('2026-10-17T16:00:00Z').timestamp()

class DeliveryEvidenceJournalTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.snapshot=prepare_snapshot(fixture(),DAY,PROJECT,SECRET)
        cls.audit=run_audit(cls.snapshot)
        cls.identity=cls.audit['sourceIdentity']

    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.path=Path(self.temp.name)/'delivery-evidence.sqlite3'
        self.j=Journal(self.path,self.identity,PROJECT,enabled=True)

    def tearDown(self):
        self.j.close();self.temp.cleanup()

    def count(self,table):
        return self.j.db.execute('SELECT count(*) FROM '+table).fetchone()[0]

    def test_default_disabled_creates_nothing_and_calls_nothing(self):
        path=Path(self.temp.name)/'unused'/'delivery-evidence.sqlite3'
        with self.assertRaisesRegex(EvidenceError,'DISABLED'):Journal(path,None,None)
        self.assertFalse(path.parent.exists())
        self.assertEqual(poll_evidence(None,None,None)['status'],'DISABLED')

    def test_real_bridge_poll_persists_and_restart_deduplicates(self):
        r=poll_evidence(self.j,DAY,lambda:self.snapshot,enabled=True,clock=lambda:AT)
        self.assertEqual(r['status'],'OBSERVED')
        self.j.close();self.j=Journal(self.path,self.identity,PROJECT,enabled=True)
        self.assertEqual(poll_evidence(self.j,DAY,lambda:self.snapshot,enabled=True,clock=lambda:AT+60)['status'],'OBSERVED')
        self.assertEqual(self.count('evidence_states'),1)
        self.assertEqual(self.count('evidence_polls'),2)
        self.assertEqual(self.count('evidence_transitions'),1)
        self.assertTrue(self.j.health([DAY],at=AT+61)['healthy'])
        payload=json.loads(self.j.db.execute('SELECT payload FROM evidence_states').fetchone()[0])
        self.assertEqual(payload,self.audit['records'][0])

    def test_rescheduling_a_b_a_keeps_transition_history(self):
        self.j.commit(self.audit,AT)
        b=copy.deepcopy(self.audit);b['records'][0]['targetBasis']='CONFIRMED';b['records'][0]['targetMinute']=1150;b['snapshotHash']=digest('b')
        self.j.commit(b,AT+1);self.j.commit(self.audit,AT+2)
        self.assertEqual(self.count('evidence_states'),2)
        self.assertEqual(self.count('evidence_transitions'),3)
        keys=[r[0] for r in self.j.db.execute('SELECT state_key FROM evidence_transitions ORDER BY id')]
        self.assertEqual(keys[0],keys[2]);self.assertNotEqual(keys[0],keys[1])

    def test_basket_only_revision_is_bound_without_retaining_basket(self):
        self.j.commit(self.audit,AT)
        b=copy.deepcopy(self.audit);b['snapshotHash']=digest('basket changed')
        self.j.commit(b,AT+1)
        self.assertEqual(self.count('evidence_states'),2)
        text=''.join(r[0] for r in self.j.db.execute('SELECT payload FROM evidence_states'))
        self.assertNotIn('panang-curry',text)

    def test_missing_is_not_cancellation_and_reappearance_keeps_history(self):
        self.j.commit(self.audit,AT)
        empty=copy.deepcopy(self.audit);empty.update(records=[],deliveryOrders=0,snapshotHash=digest('empty'))
        self.j.commit(empty,AT+1)
        self.assertEqual(self.count('evidence_presence'),0)
        self.assertEqual(self.j.db.execute('SELECT kind,state_key FROM evidence_transitions ORDER BY id DESC LIMIT 1').fetchone(),('MISSING',None))
        self.j.commit(self.audit,AT+2)
        self.assertEqual(self.count('evidence_states'),1)
        self.assertEqual(self.count('evidence_transitions'),3)

    def test_service_days_do_not_erase_one_another_and_health_checks_both(self):
        self.j.commit(self.audit,AT)
        other=copy.deepcopy(self.audit);other['serviceDate']='2026-10-18'
        self.j.commit(other,AT+1)
        self.assertEqual(self.count('evidence_presence'),2)
        self.j.failure(DAY,AT+2,'SOURCE_FAILED')
        health=self.j.health([DAY,'2026-10-18'],at=AT+3)
        self.assertFalse(health['healthy']);self.assertTrue(health['perServiceDay']['2026-10-18']['healthy'])
        self.j.commit(self.audit,AT+4)
        self.assertTrue(self.j.health([DAY,'2026-10-18'],at=AT+5)['healthy'])
        self.assertFalse(self.j.health(['2026-10-19'],at=AT+5)['healthy'])

    def test_stale_or_future_source_clock_cannot_be_a_healthy_poll(self):
        for at in (AT+181,AT-6):
            r=poll_evidence(self.j,DAY,lambda:self.snapshot,enabled=True,clock=lambda:at)
            self.assertEqual(r['reasonCode'],'SOURCE_CLOCK_UNVERIFIED')
        self.assertEqual(self.count('evidence_states'),0)
        self.j.commit(self.audit,AT)
        self.assertFalse(self.j.health([DAY],at=AT+181)['healthy'])
        self.assertFalse(self.j.health([DAY],at=AT-1)['healthy'])

    def test_source_failure_is_redacted_and_does_not_delete_presence(self):
        self.j.commit(self.audit,AT)
        def failed():raise RuntimeError('PRIVATE-TOKEN-AND-ADDRESS')
        result=poll_evidence(self.j,DAY,failed,enabled=True,clock=lambda:AT+1)
        self.assertEqual(result['reasonCode'],'SOURCE_FAILED')
        self.assertEqual(self.count('evidence_presence'),1)
        self.assertFalse(self.j.health([DAY],at=AT+2)['healthy'])
        self.assertNotIn('PRIVATE',str(list(self.j.db.execute('SELECT * FROM evidence_polls'))))

    def test_transaction_failure_rolls_back_all_success_writes(self):
        self.j.commit(self.audit,AT)
        self.j.db.execute("CREATE TRIGGER fail_transition BEFORE INSERT ON evidence_transitions BEGIN SELECT RAISE(ABORT,'simulated write failure'); END")
        b=copy.deepcopy(self.audit);b['snapshotHash']=digest('changed')
        result=poll_evidence(self.j,DAY,lambda:self.snapshot,enabled=True,assessor=lambda _:b,clock=lambda:AT+1)
        self.assertEqual(result['reasonCode'],'JOURNAL_FAILED')
        self.assertEqual(self.count('evidence_states'),1)
        self.assertEqual(self.count('evidence_presence'),1)
        self.assertEqual(self.count('evidence_transitions'),1)
        self.assertEqual(self.j.db.execute("SELECT count(*) FROM evidence_polls WHERE status='OBSERVED'").fetchone()[0],1)
        self.assertFalse(self.j.health([DAY],at=AT+2)['healthy'])

    def test_unpersistable_failure_still_marks_current_process_unhealthy(self):
        self.j.commit(self.audit,AT)
        self.j.db.execute("CREATE TRIGGER fail_poll BEFORE INSERT ON evidence_polls BEGIN SELECT RAISE(ABORT,'disk unavailable'); END")
        poll_evidence(self.j,DAY,lambda:self.snapshot,enabled=True,assessor=lambda _:self.audit,clock=lambda:AT+1)
        self.assertFalse(self.j.health([DAY],at=AT+2)['healthy'])
        # A separate reader has no knowledge of an unpersisted failure until TTL.
        self.assertTrue(evidence_health(self.path,self.identity,PROJECT,[DAY],at=AT+2)['healthy'])

    def test_strict_projection_and_uncertainty_contract(self):
        changes=[lambda a:a.update(customer_name='PRIVATE'),lambda a:a.update(verified=True),lambda a:a.update(recommendation={}),
          lambda a:a['records'][0].update(customer_lat=53.7),lambda a:a['records'][0].update(prediction='GREEN'),
          lambda a:a['records'][0].update(reasonCodes=[]),lambda a:a.update(deliveryOrders=0),
          lambda a:a['records'].append(copy.deepcopy(a['records'][0]))]
        for change in changes:
            audit=copy.deepcopy(self.audit);change(audit)
            with self.assertRaises(EvidenceError):self.j.commit(audit,AT)
        self.assertEqual(self.count('evidence_states'),0)
        self.assertEqual(self.count('evidence_polls'),0)

    def test_source_build_and_existing_schema_identity_guards(self):
        with self.assertRaises(BlockingIOError):Journal(self.path,self.identity,PROJECT,enabled=True)
        self.j.close()
        with self.assertRaises(EvidenceError):Journal(self.path,'a'*64,PROJECT,enabled=True)
        self.j=Journal(self.path,self.identity,PROJECT,enabled=True)
        self.j.commit(self.audit,AT);self.j.build='a'*64;self.j.commit(self.audit,AT+1)
        self.assertEqual(self.count('evidence_states'),2)
        other=Path(self.temp.name)/'unrelated';other.mkdir();file=other/'delivery-evidence.sqlite3'
        db=sqlite3.connect(file);db.execute('CREATE TABLE kitchen(private TEXT)');db.close()
        before=file.read_bytes()
        with self.assertRaises(EvidenceError):Journal(file,self.identity,PROJECT,enabled=True)
        self.assertEqual(file.read_bytes(),before)
        with self.assertRaises(EvidenceError):Journal(Path(self.temp.name)/'monitor.sqlite3',self.identity,PROJECT,enabled=True)

    def test_cross_project_wrong_role_and_malformed_audit_cannot_be_persisted(self):
        for field,value in [('projectRef','hvrqgufqjslvgiohgkvu'),('sourceRole','postgres'),('serviceDate','2026-10-18')]:
            snapshot=copy.deepcopy(self.snapshot);snapshot[field]=value
            result=poll_evidence(self.j,DAY,lambda:snapshot,enabled=True,clock=lambda:AT)
            self.assertEqual(result['reasonCode'],'SOURCE_FAILED')
        result=poll_evidence(self.j,DAY,lambda:self.snapshot,enabled=True,assessor=lambda _:{'serviceDate':DAY},clock=lambda:AT)
        self.assertEqual(result['reasonCode'],'AUDIT_FAILED')
        self.assertEqual(self.count('evidence_states'),0)

    def test_content_conflict_is_not_overwritten(self):
        self.j.commit(self.audit,AT)
        self.j.db.execute("UPDATE evidence_states SET payload='{}'");self.j.db.commit()
        with self.assertRaisesRegex(EvidenceError,'CONTENT_CONFLICT'):self.j.commit(self.audit,AT+1)
        self.assertEqual(self.count('evidence_polls'),1)

    def test_readonly_health_does_not_create_missing_database(self):
        path=Path(self.temp.name)/'missing.sqlite3'
        self.assertFalse(evidence_health(path,self.identity,PROJECT,[DAY],at=AT)['healthy'])
        self.assertFalse(path.exists())
        self.assertFalse(self.j.health([],at=AT)['healthy'])

    def test_abrupt_process_exit_discards_partial_write_but_keeps_completed_commit(self):
        self.j.commit(self.audit,AT)
        self.j.close()
        interrupted = """import os,sys
from delivery_evidence_journal import DeliveryEvidenceJournal
j=DeliveryEvidenceJournal(sys.argv[1],sys.argv[2],sys.argv[3],enabled=True)
j.db.execute('BEGIN IMMEDIATE')
j.db.execute('DELETE FROM evidence_presence')
os._exit(9)
"""
        result=subprocess.run([sys.executable,'-c',interrupted,str(self.path),self.identity,PROJECT],cwd=Path(__file__).parent,capture_output=True,timeout=10)
        self.j=Journal(self.path,self.identity,PROJECT,enabled=True)
        self.assertEqual(result.returncode,9)
        self.assertEqual(self.count('evidence_presence'),1)
        self.assertEqual(self.count('evidence_polls'),1)
        self.j.close()
        b=copy.deepcopy(self.audit);b['snapshotHash']=digest('crash after commit')
        committed = """import os,sys,json
from delivery_evidence_journal import DeliveryEvidenceJournal
j=DeliveryEvidenceJournal(sys.argv[1],sys.argv[2],sys.argv[3],enabled=True)
j.commit(json.loads(sys.argv[4]),float(sys.argv[5]))
os._exit(9)
"""
        result=subprocess.run([sys.executable,'-c',committed,str(self.path),self.identity,PROJECT,json.dumps(b),str(AT+1)],cwd=Path(__file__).parent,capture_output=True,timeout=10)
        self.j=Journal(self.path,self.identity,PROJECT,enabled=True)
        self.assertEqual(result.returncode,9)
        self.assertEqual(self.count('evidence_states'),2)
        self.assertEqual(self.count('evidence_polls'),2)
        self.assertEqual(self.j.db.execute('PRAGMA integrity_check').fetchone(),('ok',))

    def test_consistent_backup_restore_includes_wal_and_refuses_overwrite(self):
        self.j.commit(self.audit,AT)
        directory=Path(self.temp.name)/'restore';directory.mkdir()
        backup=directory/'delivery-evidence.sqlite3'
        self.j.backup_to(backup)
        with self.assertRaises(EvidenceError):self.j.backup_to(backup)
        restored=Journal(backup,self.identity,PROJECT,enabled=True)
        try:
            self.assertEqual(restored.db.execute('SELECT count(*) FROM evidence_states').fetchone()[0],1)
            self.assertTrue(restored.health([DAY],at=AT+1)['healthy'])
            self.assertEqual(os.stat(backup).st_mode&0o777,0o600)
        finally:restored.close()

if __name__=='__main__':unittest.main()
