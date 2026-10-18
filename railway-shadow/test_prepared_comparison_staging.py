import copy
import json
from pathlib import Path
import tempfile
import time
import unittest
from urllib.request import Request,build_opener,ProxyHandler
from urllib.error import HTTPError
from prepared_comparison_staging import run,configuration,PreparedMonitor
from delivery_comparison_journal import DeliveryComparisonJournal
from delivery_comparison_backup import backup,restore
from delivery_private_bridge import PrivateCandidateBridge
from test_delivery_minimal_candidate import fixture,prepared

class PreparedStagingTests(unittest.TestCase):
    def env(self):
        return dict(MASTER_WOK_PREPARED_STAGING_ENABLED='true',
            RAILWAY_PROJECT_ID='7821ad5b-f5c2-4ab4-9206-c3d76eefd4c8',
            RAILWAY_ENVIRONMENT_ID='c1b8fad6-dbfc-4188-b4b5-a5dbfbf53279',
            RAILWAY_ENVIRONMENT_NAME='master-wok-staging',RAILWAY_SERVICE_NAME='master-wok-continuous-comparison-staging',
            RAILWAY_SERVICE_ID='012e5ef6-6225-4ab3-95f5-894583db7e83',
            RAILWAY_VOLUME_MOUNT_PATH='/data',MASTER_WOK_PRIVATE_PREFLIGHT_ORIGIN='{"lat":51.5,"lng":-0.12}',
            MASTER_WOK_PSEUDONYM_KEY='synthetic-secret-'*3,MASTER_WOK_MANAGEMENT_READ_TOKEN='synthetic',
            MASTER_WOK_PREPARED_HEALTH_TOKEN='h'*32,MASTER_WOK_PREPARED_SERVICE_DATE='2026-10-17',
            MASTER_WOK_PREPARED_MAX_CYCLES='1',PORT='0')

    def test_disabled_and_wrong_scope_never_read(self):
        events=[]
        run({},emit=events.append,transport=lambda _:self.fail('source called'))
        self.assertEqual(events[0]['status'],'DISABLED')
        for change in [dict(RAILWAY_ENVIRONMENT_ID='production'),dict(MASTER_WOK_STAGING_GOOGLE_ROUTES_KEY='x'),
            dict(MASTER_WOK_PREPARED_MAX_CYCLES='0'),dict(MASTER_WOK_PRIVATE_PREFLIGHT_ORIGIN='{}')]:
            env=self.env();env.update(change)
            with self.assertRaises(Exception):configuration(env)

    def test_runtime_real_node_persistence_restore_restart_and_health(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);events=[];calls=[];servers=[]
            def transport(payload):calls.append(payload);return fixture()
            def factory(j):
                def save():
                    n=len(list(root.glob('snapshot-*.sqlite3')))
                    p=root/('snapshot-%d.sqlite3'%n);meta=backup(j,p)
                    restore(p,root/('restored-%d.sqlite3'%n),j.identity,j.scope,meta['sha256'])
                    return dict(status='BACKUP_VERIFIED',verifiedRestore=True,verifiedAt=time.time())
                return save
            run(self.env(),directory=root/'journal',transport=transport,backup_factory=factory,
                emit=events.append,ready=servers.append)
            self.assertEqual(events[0]['preparation'],'PREPARED');self.assertEqual(len(calls),1)
            run(self.env(),directory=root/'journal',transport=transport,backup_factory=factory,emit=events.append)
            self.assertEqual(events[-1]['reasonCode'],'STAGING_CYCLE_BUDGET_EXHAUSTED')
            self.assertEqual(len(calls),1)
            c=configuration(self.env())
            j=DeliveryComparisonJournal(root/'journal/delivery-comparison.sqlite3',c['identity'],'PREPARED_ONLY',enabled=True)
            try:
                self.assertEqual(j.summary()['latestRecords'],1)
                payload=json.loads(j.db.execute('SELECT payload FROM observations').fetchone()[0])
                self.assertEqual(payload['prediction'],'UNVERIFIED');self.assertEqual(payload['preparation'],'PREPARED')
                for private in ['customer_lat','synthetic-order','privateJson','51.51']:
                    self.assertNotIn(private,'\n'.join(j.db.iterdump()))
                with self.assertRaises(Exception):j.append_prepared(dict(payload,address='PRIVATE'),time.time())
            finally:j.close()

    def test_failed_source_consumes_budget_and_cannot_expand_limit(self):
        with tempfile.TemporaryDirectory() as folder:
            calls=[];events=[]
            def fail(payload):
                calls.append(1)
                raise OSError('PRIVATE_SOURCE_SECRET')
            kwargs=dict(directory=Path(folder),transport=fail,
                backup_factory=lambda j:lambda:self.fail('backup after source failure'),emit=events.append)
            run(self.env(),**kwargs)
            self.assertEqual(events[-1]['status'],'UNVERIFIED')
            self.assertNotIn('PRIVATE_SOURCE_SECRET',str(events))
            run(self.env(),**kwargs)
            self.assertEqual(events[-1]['reasonCode'],'STAGING_CYCLE_BUDGET_EXHAUSTED')
            self.assertEqual(len(calls),1)
            env=self.env();env['MASTER_WOK_PREPARED_MAX_CYCLES']='2'
            with self.assertRaises(Exception):run(env,**kwargs)
            self.assertEqual(len(calls),1)

    def test_prepared_cloud_backup_roundtrip_and_scope_separation(self):
        from delivery_comparison_offvolume import ComparisonBackup
        from test_delivery_comparison_offvolume import Client
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as folder:
            candidate_bridge=PrivateCandidateBridge(lambda:prepared(),enabled=True)
            candidate=candidate_bridge.read_candidate()
            j=DeliveryComparisonJournal(Path(folder)/'delivery-comparison.sqlite3',candidate['sourceIdentity'],'PREPARED_ONLY',enabled=True)
            try:
                j.append_prepared(candidate,time.time())
                j.append_prepared_empty('2026-10-17',time.time())
                client=Client()
                cloud=ComparisonBackup(SimpleNamespace(bucket='synthetic'),source=j.path,
                    identity=j.identity,scope=j.scope,client_factory=lambda _:client)
                self.assertEqual(cloud.run_once()['status'],'BACKUP_VERIFIED')
                self.assertTrue(cloud.healthy())
                self.assertTrue(all('/PREPARED_ONLY/' in k for k in client.objects))
                with self.assertRaises(Exception):j.append_synthetic({},time.time())
                with self.assertRaises(Exception):j.append_prepared(dict(candidate,address='private'),time.time())
                client.bad=True
                self.assertEqual(cloud.run_once()['status'],'BACKUP_FAILED')
                self.assertFalse(cloud.healthy())
            finally:j.close()

    def test_monitor_backup_failure_empty_and_authenticated_health(self):
        from delivery_comparison_worker import serve_health
        with tempfile.TemporaryDirectory() as folder:
            c=configuration(self.env());j=DeliveryComparisonJournal(Path(folder)/'delivery-comparison.sqlite3',c['identity'],'PREPARED_ONLY',enabled=True)
            bridge=PrivateCandidateBridge(lambda:prepared(),enabled=True)
            receipt=dict(status='BACKUP_VERIFIED',verifiedRestore=True,verifiedAt=time.time())
            now=[time.time()]
            monitor=PreparedMonitor(j,bridge,lambda:receipt,'2026-10-17',clock=lambda:now[0])
            server=serve_health(monitor,'h'*32,0,data_origin='PREPARED_SAVED_STATE')
            opener=build_opener(ProxyHandler({}))
            def get(auth=True):
                request=Request('http://127.0.0.1:%d/healthz'%server.server_address[1],headers={'Authorization':'Bearer '+'h'*32} if auth else {})
                try:
                    with opener.open(request,timeout=2) as r:return r.status,json.load(r)
                except HTTPError as e:
                    status=e.code;e.close();return status,None
            try:
                self.assertEqual(get(False)[0],401);self.assertEqual(get()[0],503)
                self.assertEqual(monitor.cycle()['preparation'],'PREPARED')
                self.assertIsNone(bridge.prepared);self.assertEqual(get()[0],200)
                self.assertEqual(get()[1]['dataOrigin'],'PREPARED_SAVED_STATE')
                receipt['verifiedAt']=now[0]-7201
                self.assertEqual(monitor.cycle()['status'],'UNVERIFIED');self.assertEqual(get()[0],503)
                bridge.reader=lambda:None;receipt['verifiedAt']=now[0]
                self.assertEqual(monitor.cycle()['preparation'],'NO_CANDIDATE')
                self.assertEqual(j.summary()['latestRecords'],0)
                now[0]+=181;self.assertEqual(get()[0],503)
            finally:server.shutdown();server.server_close();j.close()
