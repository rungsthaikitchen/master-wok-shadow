import unittest
from private_source_role_check import run,QUERY

class RoleCheckTests(unittest.TestCase):
    def env(self):
        return dict(MASTER_WOK_PRIVATE_SOURCE_CHECK_ENABLED='true',
            RAILWAY_PROJECT_ID='7821ad5b-f5c2-4ab4-9206-c3d76eefd4c8',
            RAILWAY_ENVIRONMENT_ID='c1b8fad6-dbfc-4188-b4b5-a5dbfbf53279',
            RAILWAY_ENVIRONMENT_NAME='master-wok-staging',RAILWAY_SERVICE_NAME='master-wok-private-source-check',
            MASTER_WOK_MANAGEMENT_READ_TOKEN='synthetic-token')
    def test_disabled_and_wrong_scope_do_not_call_source(self):
        def refuse(*args):raise AssertionError('called')
        self.assertEqual(run({},transport=refuse)['status'],'DISABLED')
        env=self.env();env['RAILWAY_ENVIRONMENT_ID']='production'
        self.assertEqual(run(env,transport=refuse)['sourceRequests'],0)

    def test_exact_metadata_query_and_restricted_role_proof(self):
        calls=[]
        result=run(self.env(),transport=lambda p:(calls.append(p) or [dict(source_role='supabase_read_only_user',read_only='on')]))
        self.assertEqual(calls,[{'query':QUERY}]);self.assertNotIn('public.orders',QUERY)
        self.assertEqual(result['status'],'READ_ONLY_CONNECTION_CONFIRMED')
        self.assertFalse(result['orderDataRead'])
        for response in [[dict(source_role='postgres',read_only='on')],[dict(source_role='supabase_read_only_user',read_only='off')]]:
            self.assertEqual(run(self.env(),transport=lambda p:response)['status'],'UNVERIFIED')

    def test_error_is_redacted_and_never_retried(self):
        calls=[]
        def fail(p):calls.append(1);raise OSError('PRIVATE_TOKEN')
        result=run(self.env(),transport=fail)
        self.assertEqual(len(calls),1);self.assertNotIn('PRIVATE_TOKEN',str(result))
