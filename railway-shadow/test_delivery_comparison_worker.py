import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from urllib.request import Request,build_opener,ProxyHandler
from urllib.error import HTTPError
from delivery_comparison_journal import DeliveryComparisonJournal,ComparisonError
from delivery_comparison_backup import backup,restore
import delivery_comparison_worker as w

class WorkerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.batch=w.fixture_batch()
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.path=Path(self.temp.name)/'delivery-comparison.sqlite3'
        self.j=DeliveryComparisonJournal(self.path,w.IDENTITY,'SYNTHETIC_STAGING',enabled=True);self.m=w.Monitor()
    def tearDown(self):self.j.close();self.temp.cleanup()
    def cycle(self,**kw):return w.run_once(self.j,self.m,assessor=lambda:self.batch,clock=lambda:100,**kw)

    def test_off_and_production_or_secret_configuration_refused(self):
        self.assertIsNone(w.configuration({}))
        env={'MASTER_WOK_COMPARISON_STAGING_ENABLED':'true','RAILWAY_ENVIRONMENT_NAME':'master-wok-staging',
             'MASTER_WOK_COMPARISON_JOURNAL':str(self.path),'MASTER_WOK_COMPARISON_HEALTH_TOKEN':'t'*32}
        self.assertEqual(w.configuration(env)[0],self.path)
        for key,value in [('RAILWAY_ENVIRONMENT_NAME','production'),('DATABASE_URL','secret'),('MASTER_WOK_STAGING_GOOGLE_ROUTES_KEY','secret')]:
            with self.assertRaises(ComparisonError):w.configuration({**env,key:value})

    def test_cycles_restart_and_valid_backup_restore(self):
        self.assertEqual(self.cycle()['backup'],'LOCAL_VERIFIED');self.assertTrue(self.m.healthy(101))
        self.j.close();self.j=DeliveryComparisonJournal(self.path,w.IDENTITY,'SYNTHETIC_STAGING',enabled=True)
        self.cycle()
        self.assertEqual(self.j.db.execute('SELECT count(*) FROM snapshots').fetchone()[0],1)
        self.assertEqual(self.j.db.execute('SELECT count(*) FROM observation_events').fetchone()[0],2)
        p=Path(self.temp.name)/'explicit.sqlite3';info=backup(self.j,p)
        dest=Path(self.temp.name)/'restore.sqlite3'
        self.assertEqual(restore(p,dest,w.IDENTITY,'SYNTHETIC_STAGING',info['sha256']),info['counts'])
        with self.assertRaises(ComparisonError):restore(p,dest,w.IDENTITY,'SYNTHETIC_STAGING',info['sha256'])

    def test_restore_rejects_corruption_wrong_identity_and_existing_destination(self):
        self.cycle();p=Path(self.temp.name)/'snapshot.sqlite3';info=backup(self.j,p)
        for identity,sha in [('b'*64,info['sha256']),(w.IDENTITY,'0'*64)]:
            dest=Path(self.temp.name)/'no.sqlite3'
            with self.assertRaises(ComparisonError):restore(p,dest,identity,'SYNTHETIC_STAGING',sha)
            self.assertFalse(dest.exists())

    def test_failed_backup_and_assessment_make_health_fail_then_recover(self):
        self.cycle()
        def fail(*_):raise OSError('SECRET must never escape')
        r=self.cycle(snapshot=fail)
        self.assertEqual(r['status'],'UNVERIFIED');self.assertNotIn('SECRET',json.dumps(r));self.assertFalse(self.m.healthy(101))
        r=w.run_once(self.j,self.m,assessor=fail,clock=lambda:100)
        self.assertEqual(r['status'],'UNVERIFIED');self.assertFalse(self.m.healthy(101))
        self.cycle();self.assertTrue(self.m.healthy(101));self.assertFalse(self.m.healthy(281))

    def test_local_health_authentication_staleness_failure_and_recovery(self):
        token='x'*32;server=w.serve_health(self.m,token,0);opener=build_opener(ProxyHandler({}))
        url='http://127.0.0.1:'+str(server.server_address[1])+'/healthz'
        def status(auth=True):
            request=Request(url,headers={'Authorization':'Bearer '+token} if auth else {})
            try:
                with opener.open(request,timeout=2) as response:return response.status
            except HTTPError as e:
                code=e.code;e.close();return code
        try:
            self.assertEqual(status(False),401);self.assertEqual(status(),503)
            self.m.failed=False;self.m.last_success=w.time.time();self.assertEqual(status(),200)
            self.m.last_success-=181;self.assertEqual(status(),503)
            self.m.last_success=w.time.time();self.m.failed=True;self.assertEqual(status(),503)
        finally:server.shutdown();server.server_close()

    def test_backup_refuses_existing_file_without_changing_it(self):
        p=Path(self.temp.name)/'keep';p.write_text('keep')
        with self.assertRaises(ComparisonError):backup(self.j,p)
        self.assertEqual(p.read_text(),'keep')

    def test_actual_worker_entrypoint_persists_and_probes_private_health(self):
        import os
        import select
        import subprocess
        env={k:v for k,v in os.environ.items() if k in ('PATH','TZ','LANG')}
        path=Path(self.temp.name)/'entrypoint'/'delivery-comparison.sqlite3'
        env.update(MASTER_WOK_COMPARISON_STAGING_ENABLED='true',RAILWAY_ENVIRONMENT_NAME='master-wok-staging',
                   MASTER_WOK_COMPARISON_JOURNAL=str(path),MASTER_WOK_COMPARISON_HEALTH_TOKEN='z'*32,PORT='0')
        process=subprocess.Popen(['python',str(w.ROOT/'railway-shadow/delivery_comparison_worker.py')],env=env,
                                 stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        try:
            self.assertTrue(select.select([process.stdout],[],[],10)[0])
            result=json.loads(process.stdout.readline())
            self.assertEqual(result['status'],'OBSERVED');self.assertEqual(result['authenticatedHealthStatus'],200)
            self.assertEqual(result['unauthenticatedHealthStatus'],401)
        finally:
            process.terminate()
            try:process.communicate(timeout=5)
            except subprocess.TimeoutExpired:process.kill();process.communicate()
        self.assertEqual(process.returncode,0)
        self.assertTrue(path.exists());self.assertTrue((path.parent/'comparison-latest-backup.sqlite3').exists())
