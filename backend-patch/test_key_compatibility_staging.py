import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'railway-shadow'))
import key_compatibility_staging as smoke


class StagingSmokeTests(unittest.TestCase):
    def env(self):
        return dict(smoke.IDENTITY,MASTER_WOK_KEY_COMPATIBILITY_ENABLED='true',
                    MASTER_WOK_STAGING_SECRET_KEY='sb_secret_SYNTHETIC_ONLY')

    def test_disabled_does_not_read_credentials_touch_marker_or_call_provider(self):
        with tempfile.TemporaryDirectory() as tmp:
            marker=Path(tmp)/'attempt'
            factory=Mock(side_effect=AssertionError('network refused'))
            self.assertEqual(smoke.check({},marker=marker,sdk_factory=factory),dict(status='DISABLED',requests=0))
            self.assertFalse(marker.exists());factory.assert_not_called()

    def test_production_identity_and_other_trials_refuse_before_network(self):
        for change in [dict(RAILWAY_ENVIRONMENT_ID='production'),dict(RAILWAY_SERVICE_ID='wrong'),dict(MASTER_WOK_EVENT_RUNTIME_ENABLED='true'),dict(MASTER_WOK_CUTOVER_TRIAL_ENABLED='true'),dict(MASTER_WOK_STAGING_SECRET_KEY='eyJ-legacy'),dict(MASTER_WOK_STAGING_SECRET_KEY='')]:
            with self.subTest(change=change), tempfile.TemporaryDirectory() as tmp:
                marker=Path(tmp)/'attempt';factory=Mock()
                with self.assertRaises(ValueError):smoke.check(dict(self.env(),**change),marker=marker,sdk_factory=factory)
                self.assertFalse(marker.exists());factory.assert_not_called()

    def test_two_read_only_calls_and_durable_no_repeat(self):
        with tempfile.TemporaryDirectory() as tmp:
            marker=Path(tmp)/'attempt';client=Mock()
            client.table.return_value.select.return_value.limit.return_value.execute.return_value.data=[]
            factory=Mock(return_value=client)
            response=Mock(status_code=200);response.json.return_value=[]
            get=Mock(return_value=response)
            result=smoke.check(self.env(),marker=marker,sdk_factory=factory,http_get=get)
            self.assertEqual(result['status'],'PASSED');self.assertEqual(result['writes'],0)
            factory.assert_called_once_with(smoke.URL,self.env()['MASTER_WOK_STAGING_SECRET_KEY'])
            client.table.assert_called_once_with('orders')
            client.table.return_value.select.assert_called_once_with('id')
            client.table.return_value.select.return_value.limit.assert_called_once_with(0)
            client.options.httpx_client.close.assert_called_once()
            self.assertEqual(get.call_args.kwargs['params'],dict(select='id',limit='0'))
            self.assertNotIn('Authorization',get.call_args.kwargs['headers'])
            self.assertFalse(get.call_args.kwargs['allow_redirects']);response.close.assert_called_once()
            self.assertEqual(smoke.check(self.env(),marker=marker,sdk_factory=factory,http_get=get)['status'],'ALREADY_ATTEMPTED')
            self.assertEqual(factory.call_count,1);self.assertEqual(get.call_count,1)

    def test_failure_consumes_attempt_and_does_not_call_direct_rest(self):
        with tempfile.TemporaryDirectory() as tmp:
            marker=Path(tmp)/'attempt';factory=Mock(side_effect=RuntimeError('PRIVATE KEY'))
            get=Mock()
            with self.assertRaises(RuntimeError):smoke.check(self.env(),marker=marker,sdk_factory=factory,http_get=get)
            self.assertEqual(smoke.check(self.env(),marker=marker,sdk_factory=factory,http_get=get)['status'],'ALREADY_ATTEMPTED')
            get.assert_not_called()

    def test_nonempty_sdk_result_refuses_and_closes(self):
        with tempfile.TemporaryDirectory() as tmp:
            client=Mock();client.table.return_value.select.return_value.limit.return_value.execute.return_value.data=[{'id':'synthetic'}]
            get=Mock()
            with self.assertRaisesRegex(ValueError,'SDK_EMPTY_RESULT_REQUIRED'):
                smoke.check(self.env(),marker=Path(tmp)/'attempt',sdk_factory=Mock(return_value=client),http_get=get)
            get.assert_not_called();client.options.httpx_client.close.assert_called_once()

    def test_main_never_logs_exception_details_or_secret(self):
        output=io.StringIO()
        with patch.object(smoke,'check',side_effect=RuntimeError('PRIVATE_SECRET')),contextlib.redirect_stdout(output):
            self.assertEqual(smoke.main(),1)
        self.assertEqual(json.loads(output.getvalue())['status'],'FAILED')
        self.assertNotIn('PRIVATE',output.getvalue())


if __name__=='__main__':unittest.main()
