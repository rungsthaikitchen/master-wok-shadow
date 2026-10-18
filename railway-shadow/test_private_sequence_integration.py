"""Real Python/Node PREPARE path + persistent controller; synthetic input only."""
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import time
import unittest
from datetime import datetime, timezone
from delivery_minimal_candidate import read, QUERY
from delivery_private_bridge import PrivateCandidateBridge
from delivery_comparison_controller import ComparisonController
from delivery_comparison_journal import DeliveryComparisonJournal
from delivery_comparison_backup import backup, restore
from test_delivery_minimal_candidate import fixture, PROJECT, SECRET, ORIGIN


class PrivateSequenceIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.path = self.root / 'delivery-comparison.sqlite3'
        self.raw = fixture()
        self.raw[0].update(order_count=1, item_count=1)
        self.raw[0]['orders'][0]['status'] = 'confirmed'
        self.source_calls = 0
        self.bridge = PrivateCandidateBridge(self.reader, enabled=True)
        initial = self.bridge.read_candidate()
        self.identity = initial['sourceIdentity']
        self.bridge.prepared = self.bridge.candidate = None
        self.journal = DeliveryComparisonJournal(self.path, self.identity,
            'RETROSPECTIVE_CONDITIONAL', enabled=True)
        self.attach()

    def attach(self):
        self.controller = ComparisonController(self.journal, enabled=True,
            allow_capture=False, request_limit=0)

    def tearDown(self):
        self.journal.close()
        self.tmp.cleanup()

    def transport(self, payload):
        self.assertEqual(payload['query'], QUERY)
        self.source_calls += 1
        raw = copy.deepcopy(self.raw)
        raw[0]['observed_at'] = datetime.now(timezone.utc).isoformat()
        # Simulate the SQL snapshot fingerprint, including changed commitments.
        raw[0]['snapshot_hash'] = hashlib.sha256(json.dumps(raw[0]['orders'],
            sort_keys=True).encode()).hexdigest()
        return raw

    def reader(self):
        return read('https://' + PROJECT + '.supabase.co', 'synthetic-token',
            '2026-10-17', SECRET, ORIGIN, enabled=True, approved_project=PROJECT,
            transport=self.transport, clock=time.time)

    def backed(self):
        # Actual local snapshot and restore verification, not a stub receipt.
        n = len(list(self.root.glob('backup-*.sqlite3')))
        source = self.root / ('backup-%d.sqlite3' % n)
        receipt = backup(self.journal, source)
        target = self.root / ('restore-%d.sqlite3' % n)
        restore(source, target, self.identity, 'RETROSPECTIVE_CONDITIONAL', receipt['sha256'])
        return dict(status='BACKUP_VERIFIED', verifiedRestore=True, verifiedAt=time.time())

    def cycle(self):
        def refuse(candidate):
            self.fail('Routing capture must remain disabled')
        try:
            return self.controller.cycle(self.bridge.read_candidate, refuse, self.backed)
        finally:
            self.bridge.prepared = self.bridge.candidate = None

    def test_confirmed_reschedule_and_restart_keep_zero_capture_budget(self):
        before = self.bridge.read_candidate()
        self.assertEqual(self.cycle()['reasonCode'], 'CAPTURE_DISABLED')
        self.assertTrue(self.controller.healthy())
        self.raw[0]['orders'][0].update(proposed_time='2026-10-17T17:00:00Z',
            confirmed_time='2026-10-17T17:00:00Z')
        after = self.bridge.read_candidate()
        self.assertNotEqual(before['sourceHash'], after['sourceHash'])
        self.assertEqual(before['sourceIdentity'], after['sourceIdentity'])
        self.assertEqual(self.cycle()['reasonCode'], 'CAPTURE_DISABLED')
        self.journal.close()
        self.journal = DeliveryComparisonJournal(self.path, self.identity,
            'RETROSPECTIVE_CONDITIONAL', enabled=True)
        self.attach()
        self.assertFalse(self.controller.healthy())
        self.assertEqual(self.cycle()['reasonCode'], 'CAPTURE_DISABLED')
        self.assertTrue(self.controller.healthy())
        self.assertEqual(self.journal.db.execute('SELECT count(*) FROM controller_events').fetchone()[0], 3)
        self.assertEqual(self.journal.db.execute('SELECT count(*) FROM capture_reservations').fetchone()[0], 0)
        self.assertEqual(self.journal.db.execute('SELECT count(*) FROM observations').fetchone()[0], 0)
        self.assertIsNone(self.bridge.prepared)
        dump = '\n'.join(self.journal.db.iterdump())
        for private in ['synthetic-order', 'synthetic-line', 'customer_lat', 'privateJson', '51.51']:
            self.assertNotIn(private, dump)

    def test_later_booking_changes_coverage_without_becoming_first_order(self):
        first = self.bridge.read_candidate()
        self.raw[0].update(order_count=2, item_count=2)
        # SQL returns only the first basket plus a full-snapshot hash. A later
        # order changes that hash but never gets silently promoted as first.
        self.raw[0]['snapshot_hash'] = 'b' * 64
        original_transport = self.transport
        def later_snapshot(payload):
            raw = original_transport(payload)
            raw[0]['snapshot_hash'] = 'b' * 64
            return raw
        self.transport = later_snapshot
        later = self.bridge.read_candidate()
        self.assertNotEqual(first['sourceHash'], later['sourceHash'])
        private = json.loads(self.bridge.prepared['privateJson'])
        self.assertEqual(private['source']['totalSavedOrderCount'], 2)
        self.assertEqual(len(private['source']['orders']), 1)
        self.assertEqual(self.cycle()['reasonCode'], 'CAPTURE_DISABLED')

    def test_changed_poll_time_does_not_change_candidate(self):
        first = self.bridge.read_candidate()
        self.assertEqual(first, self.bridge.read_candidate())

    def test_unaccepted_proposal_and_invalid_saved_states_fail_closed(self):
        original = copy.deepcopy(self.raw)
        changes = [dict(status='pending'), dict(status='cancelled'),
            dict(order_type='collection'), dict(order_type=None),
            dict(proposed_time='2026-10-17T17:00:00Z', confirmed_time=None)]
        for change in changes:
            with self.subTest(change=change):
                self.raw = copy.deepcopy(original)
                self.raw[0]['orders'][0].update(change)
                result = self.cycle()
                self.assertEqual(result['status'], 'UNVERIFIED')
                self.assertFalse(self.controller.healthy())
                self.assertIsNone(self.bridge.prepared)
        self.raw = copy.deepcopy(original)
        self.assertEqual(self.cycle()['reasonCode'], 'CAPTURE_DISABLED')
        self.assertTrue(self.controller.healthy())
        self.assertEqual(self.journal.db.execute('SELECT count(*) FROM capture_reservations').fetchone()[0], 0)

    def test_ambiguous_order_sequence_refused_without_skipping(self):
        self.raw[0].update(order_count=2, tie_count=2)
        self.assertEqual(self.cycle()['status'], 'UNVERIFIED')
        self.assertFalse(self.controller.healthy())
        self.assertIsNone(self.bridge.prepared)

    def test_empty_service_persists_health_without_fabricated_recommendation(self):
        self.raw[0].update(order_count=0, item_count=0, earlier_count=0,
            tie_count=0, orders=None, items=[])
        self.assertEqual(self.cycle()['reasonCode'], 'NO_CANDIDATE')
        self.assertTrue(self.controller.healthy())
        self.assertEqual(self.journal.db.execute('SELECT count(*) FROM observations').fetchone()[0], 0)
