import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import unittest
import urllib.request
import urllib.error

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('evidence_worker',ROOT/'staging-delivery/evidence_worker.py')
w=importlib.util.module_from_spec(spec);spec.loader.exec_module(w)

class EvidenceStagingWorkerTests(unittest.TestCase):
    def test_default_off_and_environment_guard(self):
        self.assertIsNone(w.configuration({}))
        env={'MASTER_WOK_EVIDENCE_STAGING_ENABLED':'true','RAILWAY_ENVIRONMENT_NAME':'master-wok-production-shadow'}
        with self.assertRaises(ValueError):w.configuration(env)
        r=subprocess.run([sys.executable,str(ROOT/'staging-delivery/evidence_worker.py')],env={**os.environ,'MASTER_WOK_EVIDENCE_STAGING_ENABLED':'false'},capture_output=True,text=True,timeout=10)
        self.assertEqual(r.returncode,0);self.assertIn('DISABLED',r.stdout);self.assertIn('"networkRequests": 0',r.stdout)
    def test_private_health_reports_failure_and_recovery_without_public_domain(self):
        class Journal:
            healthy=False
            def health(self,days):return {'healthy':self.healthy}
        journal=Journal();state={'observed':False};server=w.serve(journal,'x'*32,state,0)
        try:
            self.assertEqual(w.probe(server,'x'*32),{'authenticatedHealthStatus':503,'unauthenticatedHealthStatus':401})
            journal.healthy=True;state['observed']=True
            self.assertEqual(w.probe(server,'x'*32),{'authenticatedHealthStatus':200,'unauthenticatedHealthStatus':401})
            state['observed']=False
            self.assertEqual(w.probe(server,'x'*32)['authenticatedHealthStatus'],503)
            with self.assertRaises(urllib.error.HTTPError) as error:urllib.request.urlopen('http://127.0.0.1:'+str(server.server_address[1])+'/other')
            try:self.assertEqual(error.exception.code,404)
            finally:error.exception.close()
        finally:server.shutdown();server.server_close()
    def test_fixed_scope_and_no_configurable_production_source(self):
        self.assertEqual(w.PROJECT,'hvrqgufqjslvgiohgkvu')
        self.assertEqual(w.DAY,'2099-01-17')
        self.assertTrue(w.DB.endswith('/delivery-evidence.sqlite3'))

if __name__=='__main__':unittest.main()
