import unittest
from private_source_preflight import run,QUERY,SYNTHETIC_QUERY
import test_private_source_role_check as role_tests
from test_delivery_minimal_candidate import fixture

class PreflightTests(unittest.TestCase):
    def env(self):
        env=role_tests.RoleCheckTests().env()
        env.update(MASTER_WOK_PRIVATE_PREFLIGHT_ENABLED='true',MASTER_WOK_PSEUDONYM_KEY='synthetic-secret-'*3)
        return env
    def test_default_off_and_wrong_scope_make_no_calls(self):
        def refuse(*args):raise AssertionError('called')
        self.assertEqual(run({},transport=refuse)['status'],'DISABLED')
        env=self.env();env['RAILWAY_ENVIRONMENT_ID']='production'
        self.assertEqual(run(env,transport=refuse)['sourceRequests'],0)
    def test_two_read_cases_and_refusal_of_incomplete_saved_state(self):
        queries=[]
        def transport(payload):
            queries.append(payload['query']);raw=fixture()
            for field in ('created_at','preferred_time','proposed_time','confirmed_time'):
                raw[0]['orders'][0][field]=raw[0]['orders'][0][field].replace('2026-10-17','2026-10-15')
            if payload['query']==QUERY:raw[0]['orders'][0]['order_type']=None
            return raw
        def invoke(payload,capture):
            self.assertFalse(capture)
            return dict(status='PREPARED',bindingHash=payload['bindingHash'],candidate=dict(
                sourceHash='a'*64,sourceIdentity=payload['sourceIdentity'],buildHash='b'*64,
                observedStatus='completed',serviceDate='2026-10-15'))
        result=run(self.env(),transport=transport,invoke=invoke)
        self.assertEqual(result['status'],'PREFLIGHT_ACCEPTANCE_PASSED')
        self.assertEqual(result['cases']['saved']['status'],'UNVERIFIED')
        self.assertEqual(result['cases']['synthetic']['status'],'PREPARED')
        self.assertEqual(queries,[QUERY,SYNTHETIC_QUERY]);self.assertEqual(result['googleRequests'],0)
        self.assertNotIn('public.orders',SYNTHETIC_QUERY)
        self.assertNotIn('public.order_items',SYNTHETIC_QUERY)
    def test_provider_key_refused_before_source(self):
        for change in [dict(MASTER_WOK_STAGING_GOOGLE_ROUTES_KEY='private')]:
            env=self.env();env.update(change);calls=[]
            result=run(env,transport=lambda p:calls.append(p))
            self.assertEqual(result['status'],'UNVERIFIED');self.assertFalse(calls)
