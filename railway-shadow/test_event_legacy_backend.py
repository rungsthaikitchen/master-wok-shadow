"""Characterization only: passing tests reproduce supplied legacy discrepancies.

No production imports, database connections, HTTP requests or notifications.
Run with MASTER_WOK_REVIEW_SERVER_PATH pointing to the exact owner-supplied file.
"""
import contextlib
import hashlib
import io
import os
from pathlib import Path
import runpy
import sys
import types
import unittest
from unittest.mock import Mock, patch


@unittest.skipUnless(os.getenv('MASTER_WOK_REVIEW_SERVER_PATH'), 'owner supplied backend path required')
class LegacyBackendCharacterization(unittest.TestCase):
    def setUp(self):
        source = Path(os.environ['MASTER_WOK_REVIEW_SERVER_PATH'])
        self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(),
                         'ad15337033c5b4a91816e2c5875460dcff1364d43e6a9619be8aa8a1d6412d88')
        requests = types.ModuleType('requests')
        requests.get = Mock(side_effect=AssertionError('unexpected HTTP GET'))
        requests.patch = Mock(side_effect=AssertionError('unexpected HTTP PATCH'))
        notifications = types.ModuleType('notifications')
        notifications.send_timing_notification = Mock(side_effect=AssertionError('unexpected notification'))
        supabase = types.ModuleType('supabase')
        supabase.create_client = Mock(side_effect=AssertionError('unexpected database client'))
        self.output = io.StringIO()
        self.capture = contextlib.redirect_stdout(self.output)
        self.capture.__enter__()
        self.addCleanup(self.capture.__exit__, None, None, None)
        with patch.dict(os.environ, {}, clear=True), patch.dict(sys.modules, {
                'requests': requests, 'supabase': supabase, 'notifications': notifications}):
            module = runpy.run_path(str(source), run_name='isolated_legacy_review')
        self.globals = module['find_order'].__globals__
        self.globals.update(SUPABASE_URL='https://synthetic.invalid', SUPABASE_SERVICE_ROLE_KEY='synthetic-only')
        self.client = module['app'].test_client()
        self.requests = requests
        self.notifications = notifications
        self.db = supabase
        self.row = dict(id='synthetic-order', status='proposed', proposed_time='2026-10-22T19:00:00Z')
        self.response = Mock()
        self.response.json.return_value = [self.row]
        requests.get.side_effect = None
        requests.get.return_value = self.response
        requests.patch.side_effect = None
        requests.patch.return_value = Mock()

    def tearDown(self):
        self.notifications.send_timing_notification.assert_not_called()
        self.db.create_client.assert_not_called()

    def accept(self, query=''):
        return self.client.get('/orders/synthetic-order/time/accept' + query)

    def test_get_with_no_token_mutates_order(self):
        result = self.accept()
        self.assertEqual(result.status_code, 200)
        self.assertEqual(self.requests.patch.call_count, 1)
        self.assertEqual(self.requests.patch.call_args.kwargs['json'],
                         dict(status='customer_accepted_time', confirmed_time=self.row['proposed_time']))

    def test_unrelated_token_is_not_validated_when_id_matches(self):
        self.accept('?token=not-a-proposal-token')
        self.assertEqual(self.requests.get.call_count, 1)
        self.assertEqual(self.requests.get.call_args.kwargs['params']['id'], 'eq.synthetic-order')
        self.assertEqual(self.requests.patch.call_count, 1)

    def test_accept_patch_failure_still_reports_success(self):
        self.requests.patch.side_effect = RuntimeError('synthetic write failure')
        result = self.accept()
        self.assertEqual(result.status_code, 200)
        self.assertIn('has been accepted', result.get_data(as_text=True))

    def test_missing_order_reports_success_for_both_responses(self):
        self.response.json.return_value = []
        accepted = self.accept()
        declined = self.client.get('/orders/synthetic-order/time/decline')
        self.assertIn('has been accepted', accepted.get_data(as_text=True))
        self.assertIn('Thanks for letting us know', declined.get_data(as_text=True))
        self.requests.patch.assert_not_called()

    def test_no_proposal_still_sets_accepted_status(self):
        self.row.update(status='cancelled', proposed_time=None)
        self.accept()
        self.assertEqual(self.requests.patch.call_args.kwargs['json'], dict(status='customer_accepted_time'))

    def test_new_offer_between_read_and_write_has_no_revision_guard(self):
        saved = dict(self.row)
        def apply_patch(*args, **kwargs):
            # A concurrent offer has already committed before this legacy PATCH.
            saved['proposed_time'] = '2026-10-22T20:00:00Z'
            self.assertEqual(kwargs['params'], dict(id='eq.synthetic-order'))
            saved.update(kwargs['json'])
            return Mock()
        self.requests.patch.side_effect = apply_patch
        self.accept()
        self.assertEqual(saved['proposed_time'], '2026-10-22T20:00:00Z')
        self.assertEqual(saved['confirmed_time'], '2026-10-22T19:00:00Z')
        self.assertEqual(saved['status'], 'customer_accepted_time')

    def test_decline_only_changes_status_and_retains_time_fields(self):
        result = self.client.get('/orders/synthetic-order/time/decline')
        self.assertEqual(result.status_code, 200)
        self.assertEqual(self.requests.patch.call_args.kwargs['json'], dict(status='customer_declined_time'))
        self.assertEqual(self.requests.patch.call_args.kwargs['params'], dict(id='eq.synthetic-order'))
