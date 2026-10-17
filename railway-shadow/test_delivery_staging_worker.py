import copy
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request
import delivery_staging_worker as w

class DeliveryWorkerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = json.loads(subprocess.check_output(['node', '-e',
            "process.stdout.write(JSON.stringify({cases:require('./staging-delivery/test_cases').makeCases()}))"], cwd=w.ROOT))
        cls.batch = w.compare(cls.source)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = str(Path(self.temp.name) / 'delivery-staging.sqlite3')
        self.journal = w.Journal(self.path)

    def tearDown(self):
        self.journal.close()
        self.temp.cleanup()

    def count(self, table):
        return self.journal.db.execute('SELECT count(*) FROM ' + table).fetchone()[0]

    def test_disabled_gate_does_not_inspect_other_config_or_create_files(self):
        for value in (None, '', 'false', 'TRUE', '1'):
            self.assertIsNone(w.configuration({'MASTER_WOK_DELIVERY_STAGING_ENABLED':value}))
        env = {**os.environ, 'MASTER_WOK_DELIVERY_STAGING_ENABLED':'false',
               'MASTER_WOK_DELIVERY_JOURNAL':str(Path(self.temp.name)/'untouched.sqlite3')}
        r = subprocess.run(['python3', str(w.ROOT/'railway-shadow/delivery_staging_worker.py')],env=env,capture_output=True,text=True)
        self.assertEqual(r.returncode,0)
        self.assertEqual(json.loads(r.stdout)['networkRequests'],0)
        self.assertFalse(Path(env['MASTER_WOK_DELIVERY_JOURNAL']).exists())

    def test_scope_and_private_configuration(self):
        env = {'MASTER_WOK_DELIVERY_STAGING_ENABLED':'true','RAILWAY_ENVIRONMENT_NAME':'master-wok-staging',
               'MASTER_WOK_DELIVERY_SOURCE_URL':w.SOURCE_URL,'MASTER_WOK_MANAGEMENT_READ_TOKEN':'private',
               'MASTER_WOK_DELIVERY_HEALTH_TOKEN':'x'*32,'MASTER_WOK_DELIVERY_JOURNAL':self.path}
        self.assertIsNotNone(w.configuration(env))
        for name,value in [('RAILWAY_ENVIRONMENT_NAME','production'),('MASTER_WOK_DELIVERY_SOURCE_URL','https://ubyjrrsvbbqomitpaidb.supabase.co'),
                           ('MASTER_WOK_DELIVERY_SOURCE_URL',w.SOURCE_URL+'/'),('MASTER_WOK_DELIVERY_JOURNAL','/data/monitor.sqlite3'),
                           ('MASTER_WOK_DELIVERY_HEALTH_TOKEN','short')]:
            with self.assertRaises(w.WorkerError):w.configuration({**env,name:value})

    def test_real_model_to_durable_journal_and_restart_deduplication(self):
        self.assertTrue(w.run_once(self.journal,lambda:self.source,clock=lambda:100))
        self.assertEqual(self.count('observations'),12)
        self.assertEqual(self.count('presence'),12)
        self.journal.close();self.journal=w.Journal(self.path)
        self.assertTrue(w.run_once(self.journal,lambda:self.source,clock=lambda:160))
        self.assertEqual(self.count('observations'),12)
        self.assertEqual(self.count('polls'),2)
        stored=[json.loads(row[0]) for row in self.journal.db.execute('SELECT record FROM observations')]
        self.assertEqual(sorted(stored,key=lambda r:r['observationKey']),sorted(self.batch['records'],key=lambda r:r['observationKey']))

    def test_failure_retry_keeps_prior_records_and_marks_unhealthy(self):
        self.journal.commit(self.batch,100)
        def failed():raise RuntimeError('secret-token-and-private-address')
        self.assertFalse(w.run_once(self.journal,failed,clock=lambda:110))
        self.assertFalse(w.health(self.path,111))
        self.assertEqual(self.count('observations'),12)
        self.assertTrue(w.run_once(self.journal,lambda:self.source,clock=lambda:120))
        self.assertTrue(w.health(self.path,121))
        self.assertFalse(w.health(self.path,301))
        self.assertFalse(w.health(self.path,119))

    def test_failed_transaction_rolls_back_records_presence_and_success(self):
        self.journal.commit(self.batch,100)
        self.journal.db.execute("CREATE TRIGGER fail_insert BEFORE INSERT ON presence WHEN NEW.case_key='DRIVER_BUSY' BEGIN SELECT RAISE(ABORT,'simulated disk failure'); END")
        self.assertFalse(w.run_once(self.journal,lambda:self.source,lambda _:self.batch,clock=lambda:110))
        self.assertEqual(self.count('presence'),12)
        self.assertEqual(self.count('observations'),12)
        self.assertEqual(self.journal.db.execute("SELECT count(*) FROM polls WHERE status='OBSERVED'").fetchone()[0],1)
        self.assertFalse(w.health(self.path,111))

    def test_record_tampering_and_content_conflict_fail_closed(self):
        for field,value in [('verified',True),('dataOrigin','LIVE'),('buildHash','x'),('reasonCode','address text')]:
            batch=copy.deepcopy(self.batch);batch['records'][0][field]=value
            with self.assertRaises(w.WorkerError):self.journal.commit(batch,100)
        batch=copy.deepcopy(self.batch);batch['records'][0]['extra']='address'
        with self.assertRaises(w.WorkerError):self.journal.commit(batch,100)
        self.journal.commit(self.batch,100)
        key=self.batch['records'][0]['observationKey']
        self.journal.db.execute('UPDATE observations SET record=? WHERE key=?', ('{}',key));self.journal.db.commit()
        with self.assertRaises(w.WorkerError):self.journal.commit(self.batch,110)
        self.assertEqual(self.count('polls'),1)

    def test_missing_case_removes_presence_without_deleting_history(self):
        self.journal.commit(self.batch,100)
        small={'caseKeys':[self.batch['caseKeys'][0]],'records':self.batch['records'][:2]}
        self.journal.commit(small,110)
        self.assertEqual(self.count('presence'),2)
        self.assertEqual(self.count('observations'),12)

    def test_single_writer_and_source_identity_guard(self):
        with self.assertRaises(BlockingIOError):w.Journal(self.path)
        self.journal.db.execute("UPDATE worker_meta SET identity='other-project'");self.journal.db.commit()
        self.assertFalse(w.health(self.path,100))
        self.journal.close()
        with self.assertRaises(w.WorkerError):w.Journal(self.path)
        self.journal=w.Journal(str(Path(self.temp.name)/'other.sqlite3'))

    def test_transport_uses_fixed_readonly_endpoint_and_rejects_role_or_size(self):
        class Response:
            status=200
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self,n):return self.body
        response=Response();response.body=json.dumps([{'source_role':'supabase_read_only_user','staging_source':self.source}]).encode()
        with patch.object(w,'build_opener') as opener:
            opener.return_value.open.return_value=response
            self.assertEqual(w.fetch_source('private'),self.source)
            request=opener.return_value.open.call_args.args[0]
            self.assertEqual(request.full_url,w.ENDPOINT)
            self.assertEqual(json.loads(request.data),{'query':w.QUERY})
            self.assertNotIn('private',request.full_url)
            response.body=b'[{"source_role":"postgres"}]'
            with self.assertRaises(w.WorkerError):w.fetch_source('private')
            response.body=b'x'*5_000_001
            with self.assertRaises(w.WorkerError):w.fetch_source('private')
        with self.assertRaises(w.WorkerError):w.NoRedirect().redirect_request(None,None,None,None,None,None)
        self.assertIn('current_user AS source_role',w.QUERY)
        self.assertIn('LIMIT 51',w.QUERY)
        self.assertNotIn('INSERT ',w.QUERY.upper())

    def test_node_timeout_and_secrets_are_not_passed_to_bridge(self):
        with patch.dict(os.environ, {'MASTER_WOK_MANAGEMENT_READ_TOKEN':'secret'}):
            with patch.object(w.subprocess,'run',side_effect=subprocess.TimeoutExpired('node',60)) as runner:
                self.assertFalse(w.run_once(self.journal,lambda:self.source))
                self.assertNotIn('MASTER_WOK_MANAGEMENT_READ_TOKEN',runner.call_args.kwargs['env'])
                self.assertEqual(runner.call_args.kwargs['timeout'],60)
        self.assertEqual(self.count('observations'),0)
        self.assertFalse(w.health(self.path))

    def test_malformed_bridge_results_never_commit_success(self):
        for batch in (None, {}, {'caseKeys':[], 'records':[]},
                      {'caseKeys':self.batch['caseKeys'], 'records':self.batch['records'][:1]}):
            self.assertFalse(w.run_once(self.journal,lambda:self.source,lambda _:batch))
        self.assertEqual(self.count('observations'),0)
        self.assertEqual(self.journal.db.execute("SELECT count(*) FROM polls WHERE status='OBSERVED'").fetchone()[0],0)

    def test_authenticated_health_does_not_expose_records(self):
        self.journal.commit(self.batch,w.now())
        state={'okay':True};server=w.serve_health(self.path,'x'*32,state,0)
        url='http://127.0.0.1:'+str(server.server_address[1])
        try:
            for route,status in [('/healthz',401),('/other',404)]:
                with self.assertRaises(urllib.error.HTTPError) as err:urllib.request.urlopen(url+route)
                self.assertEqual(err.exception.code,status)
            request=urllib.request.Request(url+'/healthz',headers={'Authorization':'Bearer '+'x'*32})
            with urllib.request.urlopen(request) as response:
                self.assertEqual(json.load(response),{'status':'HEALTHY','verified':False,'dataOrigin':'SYNTHETIC_STAGING'})
            state['okay']=False
            with self.assertRaises(urllib.error.HTTPError) as err:urllib.request.urlopen(request)
            self.assertEqual(err.exception.code,503)
        finally:server.shutdown();server.server_close()

if __name__=='__main__':unittest.main()
