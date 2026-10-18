import json
import tempfile
import unittest
from pathlib import Path
from retrospective_comparison_import import run
from test_delivery_retrospective_journal import aggregate
from shadow_collector import timestamp

class ImportTests(unittest.TestCase):
    def test_disabled_does_not_read_input(self):
        def refuse(n):raise AssertionError('read while disabled')
        self.assertEqual(run({},refuse)['status'],'DISABLED')

    def test_staging_only_and_offline_import(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=str(Path(tmp)/'delivery-comparison.sqlite3')
            env=dict(MASTER_WOK_RETROSPECTIVE_IMPORT_ENABLED='true',
                RAILWAY_PROJECT_ID='7821ad5b-f5c2-4ab4-9206-c3d76eefd4c8',
                RAILWAY_ENVIRONMENT_ID='c1b8fad6-dbfc-4188-b4b5-a5dbfbf53279',
                MASTER_WOK_RETROSPECTIVE_DB=p)
            data=dict(result=aggregate(),sourceHash='b'*64,buildHash='c'*64,
                      sourceIdentity='a'*64,observedStatus='completed',capturedAt='2026-10-18T16:37:52Z')
            r=run(env,lambda n:json.dumps(data),clock=lambda:timestamp(data['capturedAt']).timestamp())
            self.assertEqual(r['status'],'RECORDED');self.assertEqual(r['networkRequests'],0)
            env['RAILWAY_ENVIRONMENT_ID']='production'
            with self.assertRaises(Exception):run(env,lambda n:json.dumps(data))
