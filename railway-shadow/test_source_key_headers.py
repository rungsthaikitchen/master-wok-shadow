"""Header compatibility only; all transport is fake, no production credentials."""
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('source_key_review', Path(__file__).with_name('shadow_collector.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class SourceKeyHeaderTests(unittest.TestCase):
    def fake_opener(self, requests, pages):
        class Response:
            status = 200
            def __init__(self, data, count):
                self.data = data
                self.headers = {'Content-Range': count}
            def read(self, limit):
                return json.dumps(self.data).encode()
            def __enter__(self): return self
            def __exit__(self, *args): pass
        class Opener:
            def open(self, request, timeout):
                requests.append(request)
                return Response(*pages.pop(0))
        return Opener()

    def test_new_secret_and_publishable_headers_stay_get_only_for_both_tables(self):
        for key in ['sb_secret_SYNTHETIC_ONLY', 'sb_publishable_SYNTHETIC_ONLY']:
            with self.subTest(key_kind=key.split('_')[1]):
                requests = []
                pages = [([{'id': 'synthetic-order'}], '0-0/1'),
                         ([{'id': 'synthetic-item', 'order_id': 'synthetic-order'}], '0-0/1')]
                with patch.object(m, 'build_opener', return_value=self.fake_opener(requests, pages)) as factory:
                    result = m.ReadOnlySource('https://synthetic.supabase.co', key).snapshot('2026-10-24')
                self.assertEqual(len(result['orders']), 1)
                self.assertEqual(len(result['items']), 1)
                self.assertEqual(len(requests), 2)
                factory.assert_called_with(m.NoRedirect)
                for request in requests:
                    headers = {k.lower(): v for k, v in request.header_items()}
                    self.assertEqual(headers['apikey'], key)
                    self.assertNotIn('authorization', headers)
                    self.assertEqual(headers['prefer'], 'count=exact')
                    self.assertEqual(request.get_method(), 'GET')
                    self.assertIsNone(request.data)

    def test_legacy_header_behavior_is_preserved(self):
        requests = []
        key = 'eyJ_SYNTHETIC_LEGACY_ONLY'
        with patch.object(m, 'build_opener', return_value=self.fake_opener(requests, [([], '*/0')])):
            m.ReadOnlySource('https://synthetic.supabase.co', key).snapshot('2026-10-24')
        headers = {k.lower(): v for k, v in requests[0].header_items()}
        self.assertEqual(headers['authorization'], 'Bearer ' + key)

    def test_bad_new_keys_and_invalid_types_fail_sanitized_before_transport(self):
        for key in ['sb_secret_', 'sb_publishable_', 'sb_unknown_PRIVATE', 'sb_secret_PRIVATE\n',
                    ' sb_secret_PRIVATE', 'sb_publishable_PRIVATE space', None, 42, False]:
            with self.subTest(key_type=type(key).__name__), patch.object(m, 'build_opener') as factory:
                with self.assertRaisesRegex(m.ShadowError, '^INVALID_SOURCE_CONFIG$'):
                    m.ReadOnlySource('https://synthetic.supabase.co', key)
                factory.assert_not_called()

    def test_management_pat_still_uses_the_read_only_query_endpoint_and_bearer(self):
        requests = []
        pat = 'sbp_SYNTHETIC_READ_ONLY'
        with patch.object(m, 'build_opener', return_value=self.fake_opener(requests, [([{'synthetic': 1}], '')])):
            result = m.ManagementReadOnlySource('https://synthetic.supabase.co', pat)._query({'query': 'select 1'})
        self.assertEqual(result, [{'synthetic': 1}])
        self.assertEqual(requests[0].full_url, 'https://api.supabase.com/v1/projects/synthetic/database/query/read-only')
        self.assertEqual(requests[0].get_method(), 'POST')
        headers = {k.lower(): v for k, v in requests[0].header_items()}
        self.assertEqual(headers['authorization'], 'Bearer ' + pat)

    def test_redirect_refusal_is_unchanged(self):
        with self.assertRaisesRegex(m.ShadowError, '^REDIRECT_REFUSED$'):
            m.NoRedirect().redirect_request(None, None, 302, 'Found', {}, 'https://other.invalid')


if __name__ == '__main__': unittest.main()
