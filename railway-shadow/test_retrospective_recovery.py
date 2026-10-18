"""Synthetic aggregate rehearsal. Storage transport is injected, never networked."""
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from delivery_comparison_journal import DeliveryComparisonJournal, ComparisonError
from delivery_comparison_backup import backup,restore
from delivery_comparison_offvolume import ComparisonBackup
from test_delivery_retrospective_journal import aggregate
from shadow_collector import timestamp

IDENTITY='d'*64  # Dedicated synthetic rehearsal identity, never a customer source.
SCOPE='RETROSPECTIVE_CONDITIONAL'

class DiskObjectStore:
    def __init__(self,root):
        self.root=root;self.corrupt=False;self.fail_manifest=False;self.calls=[]
    def path(self,key):
        return self.root / key
    def put_object(self,**kw):
        self.calls.append(('put',kw['Key']))
        if self.fail_manifest and kw['Key'].endswith('.json'):raise OSError('private failure')
        p=self.path(kw['Key']);p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(kw['Body'])
    def get_object(self,**kw):
        self.calls.append(('get',kw['Key']))
        return {'Body':io.BytesIO(b'corrupt' if self.corrupt else self.path(kw['Key']).read_bytes())}
    def close(self):pass

class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        self.path=self.root/'active'/'delivery-comparison.sqlite3'
        self.j=DeliveryComparisonJournal(self.path,IDENTITY,SCOPE,enabled=True)
        self.capture='2026-10-18T16:37:52Z';self.now=timestamp(self.capture).timestamp()
        self.store=DiskObjectStore(self.root/'object-store')
        self.job=ComparisonBackup(SimpleNamespace(bucket='offline-rehearsal'),source=self.path,
            identity=IDENTITY,scope=SCOPE,clock=lambda:self.now,client_factory=lambda _:self.store)
        self.append()

    def tearDown(self):self.j.close();self.tmp.cleanup()

    def append(self):
        return self.j.append_retrospective(aggregate(),source_hash='e'*64,build_hash='f'*64,
            observed_status='completed',captured_at=self.capture,at=self.now)

    def test_restart_local_backup_offvolume_readback_restore_and_new_append(self):
        before=self.j.summary();self.j.close()
        self.j=DeliveryComparisonJournal(self.path,IDENTITY,SCOPE,enabled=True)
        self.assertEqual(self.j.summary(),before)
        self.append()
        local=self.root/'local-backup.sqlite3';meta=backup(self.j,local)
        self.assertEqual(meta['counts']['observations'],1)
        self.assertEqual(meta['counts']['observation_events'],2)
        self.assertFalse(self.job.healthy())
        self.assertEqual(self.job.run_once()['status'],'BACKUP_VERIFIED')
        self.assertTrue(self.job.healthy())
        manifest_path=next(self.store.root.rglob('*.json'))
        manifest=json.loads(manifest_path.read_text())
        self.assertEqual(manifest['scope'],SCOPE)
        restored=self.root/'recovered';restored.mkdir()
        dest=restored/'delivery-comparison.sqlite3'
        counts=restore(self.store.path(manifest['key']),dest,IDENTITY,SCOPE,manifest['sha256'])
        self.assertEqual(counts,meta['counts'])
        recovered=DeliveryComparisonJournal(dest,IDENTITY,SCOPE,enabled=True)
        try:
            self.assertEqual(recovered.summary(),before)
            recovered.append_retrospective(aggregate(),source_hash='e'*64,build_hash='f'*64,
                observed_status='completed',captured_at=self.capture,at=self.now)
            self.assertEqual(recovered.db.execute('select count(*) from observation_events').fetchone()[0],3)
        finally:recovered.close()
        with self.assertRaises(ComparisonError):
            restore(local,dest,IDENTITY,SCOPE,meta['sha256'])

    def test_corruption_failed_manifest_and_expiry_fail_health_then_recover(self):
        self.assertEqual(self.job.run_once()['status'],'BACKUP_VERIFIED')
        for attr in ['corrupt','fail_manifest']:
            setattr(self.store,attr,True)
            self.assertEqual(self.job.run_once()['status'],'BACKUP_FAILED')
            self.assertFalse(self.job.healthy())
            setattr(self.store,attr,False)
            self.assertEqual(self.job.run_once()['status'],'BACKUP_VERIFIED')
            self.assertTrue(self.job.healthy())
        self.now+=7201;self.assertFalse(self.job.healthy())

    def test_wrong_scope_never_uploads_and_bad_restore_never_installs(self):
        wrong=ComparisonBackup(SimpleNamespace(bucket='offline'),source=self.path,
            identity=IDENTITY,scope='SYNTHETIC_STAGING',client_factory=lambda _:self.store)
        self.assertEqual(wrong.run_once()['status'],'BACKUP_FAILED')
        self.assertEqual(self.store.calls,[])
        p=self.root/'backup.sqlite3';meta=backup(self.j,p)
        dest=self.root/'restored.sqlite3'
        for identity,scope,sha in [('a'*64,SCOPE,meta['sha256']),
            (IDENTITY,'SAVED_STATE_ONLY',meta['sha256']),(IDENTITY,SCOPE,'0'*64)]:
            with self.assertRaises(ComparisonError):restore(p,dest,identity,scope,sha)
            self.assertFalse(dest.exists())

    def test_failed_write_preserves_backup_and_next_healthy_backup(self):
        self.job.run_once()
        self.j.db.execute("CREATE TRIGGER fail_event BEFORE INSERT ON observation_events BEGIN SELECT RAISE(ABORT,'write failed'); END")
        with self.assertRaises(Exception):self.append()
        self.assertEqual(self.j.db.execute('select count(*) from observation_events').fetchone()[0],1)
        self.assertEqual(self.job.run_once()['status'],'BACKUP_VERIFIED')
        self.j.db.execute('DROP TRIGGER fail_event');self.append()
        self.assertEqual(self.j.db.execute('select count(*) from observation_events').fetchone()[0],2)

    def test_authenticated_health_tracks_verified_backup_failure_and_recovery(self):
        from urllib.request import Request,build_opener,ProxyHandler
        from urllib.error import HTTPError
        import delivery_comparison_worker as worker
        monitor=worker.Monitor();monitor.failed=False;monitor.last_success=worker.time.time()
        server=worker.serve_health(monitor,'s'*32,0,extra_health=self.job.healthy)
        opener=build_opener(ProxyHandler({}))
        url='http://127.0.0.1:'+str(server.server_address[1])+'/healthz'
        def status(auth=True):
            request=Request(url,headers={'Authorization':'Bearer '+'s'*32} if auth else {})
            try:
                with opener.open(request,timeout=2) as response:return response.status
            except HTTPError as error:
                code=error.code;error.close();return code
        try:
            self.assertEqual(status(False),401)
            self.assertEqual(status(),503)
            self.job.run_once();self.assertEqual(status(),200)
            self.store.corrupt=True;self.job.run_once();self.assertEqual(status(),503)
            self.store.corrupt=False;self.job.run_once();self.assertEqual(status(),200)
            self.now+=7201;self.assertEqual(status(),503)
        finally:server.shutdown();server.server_close()
