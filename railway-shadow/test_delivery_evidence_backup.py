import copy
import hashlib
import io
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch,Mock

import delivery_evidence_backup as b
from delivery_evidence_journal import DeliveryEvidenceJournal,run_audit,EvidenceError
from delivery_shadow_source import prepare_snapshot
from test_delivery_shadow_source import fixture,PROJECT,SECRET
from test_delivery_evidence_journal import DAY,AT

class Store:
    def __init__(self):self.objects={};self.calls=[];self.corrupt=False;self.failed=False;self.bodies=[]
    def put_object(self,**kw):
        self.calls.append(('put',kw['Key']))
        if self.failed:raise RuntimeError('PRIVATE_ACCESS_KEY_SECRET')
        self.objects[kw['Key']]=kw['Body']
    def get_object(self,**kw):
        self.calls.append(('get',kw['Key']))
        body=io.BytesIO(b'bad' if self.corrupt else self.objects[kw['Key']]);self.bodies.append(body)
        return {'Body':body}
    def close(self):pass

class DeliveryEvidenceBackupTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.audit=run_audit(prepare_snapshot(fixture(),DAY,PROJECT,SECRET))
        cls.identity=cls.audit['sourceIdentity']
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.path=Path(self.temp.name)/'delivery-evidence.sqlite3'
        self.j=DeliveryEvidenceJournal(self.path,self.identity,PROJECT,enabled=True);self.j.commit(self.audit,AT)
        self.store=Store();self.clock=[AT]
        self.cfg=b.BackupConfig('https://t3.storageapi.dev','private-backup-bucket','auto','PRIVATE_ACCESS','PRIVATE_SECRET')
        self.events=[]
        self.worker=b.BackupWorker(self.cfg,self.identity,source=self.path,project=PROJECT,
            client_factory=lambda _:self.store,clock=lambda:self.clock[0],emit=self.events.append)
    def tearDown(self):self.worker.close();self.j.close();self.temp.cleanup()
    def env(self):
        return {'MASTER_WOK_EVIDENCE_BACKUP_ENABLED':'true','MASTER_WOK_DELIVERY_EVIDENCE_ENABLED':'true',
          'RAILWAY_PROJECT_ID':'7821ad5b-f5c2-4ab4-9206-c3d76eefd4c8',
          'RAILWAY_ENVIRONMENT_ID':'b61e66e7-dbaa-4343-9ca6-5e6f0f5d7612',
          'RAILWAY_ENVIRONMENT_NAME':'master-wok-production-shadow',
          'RAILWAY_SERVICE_NAME':'master-wok-delivery-evidence-production','RAILWAY_VOLUME_MOUNT_PATH':'/data',
          'MASTER_WOK_BACKUP_ENDPOINT':self.cfg.endpoint,'MASTER_WOK_BACKUP_BUCKET':self.cfg.bucket,
          'MASTER_WOK_BACKUP_REGION':self.cfg.region,'MASTER_WOK_BACKUP_ACCESS_KEY_ID':self.cfg.access_key,
          'MASTER_WOK_BACKUP_SECRET_ACCESS_KEY':self.cfg.secret_key}
    def test_disabled_does_not_require_credentials_or_sdk(self):
        for value in (None,'false','TRUE','1'):self.assertIsNone(b.configuration({'MASTER_WOK_EVIDENCE_BACKUP_ENABLED':value}))
    def test_scope_and_endpoint_and_bucket_guards(self):
        self.assertEqual(b.configuration(self.env()),self.cfg)
        for field,value in [('RAILWAY_ENVIRONMENT_ID','staging'),('RAILWAY_SERVICE_NAME','kitchen'),
          ('MASTER_WOK_DELIVERY_EVIDENCE_ENABLED','false'),('RAILWAY_VOLUME_MOUNT_PATH',''),
          ('MASTER_WOK_BACKUP_ENDPOINT','http://t3.storageapi.dev'),('MASTER_WOK_BACKUP_ENDPOINT','https://evil.example'),
          ('MASTER_WOK_BACKUP_ENDPOINT','https://t3.storageapi.dev@evil.example'),
          ('MASTER_WOK_BACKUP_ENDPOINT','https://t3.storageapi.dev/path'),('MASTER_WOK_BACKUP_BUCKET','../other'),
          ('MASTER_WOK_BACKUP_SECRET_ACCESS_KEY',''),('MASTER_WOK_BACKUP_URL_STYLE','auto')]:
            with self.subTest(field=field,value=value),self.assertRaises(EvidenceError):b.configuration({**self.env(),field:value})
        self.assertNotIn(self.cfg.secret_key,repr(self.cfg));self.assertNotIn(self.cfg.access_key,repr(self.cfg))
    def test_real_wal_snapshot_upload_download_restore_and_manifest(self):
        before=self.j.db.execute('SELECT count(*) FROM evidence_polls').fetchone()[0]
        self.assertEqual(self.worker.run_once()['status'],'BACKUP_VERIFIED')
        self.assertTrue(self.worker.healthy())
        self.assertEqual([x[0] for x in self.store.calls],['put','get','put'])
        manifest=json.loads(next(v for k,v in self.store.objects.items() if k.endswith('.json')))
        self.assertEqual(manifest['counts']['evidence_states'],1)
        target=Path(self.temp.name)/'restore.sqlite3'
        counts=b.restore_download(self.store,self.cfg.bucket,manifest['key'],target,manifest['sha256'],self.identity,PROJECT)
        self.assertEqual(counts,manifest['counts']);self.assertEqual(target.stat().st_mode&0o777,0o600)
        self.assertEqual(before,self.j.db.execute('SELECT count(*) FROM evidence_polls').fetchone()[0])
        self.assertTrue(all(body.closed for body in self.store.bodies))
        self.assertNotIn('orderId',json.dumps(self.events));self.assertNotIn(self.identity,json.dumps(self.events))
    def test_download_corruption_does_not_publish_manifest_or_mark_success(self):
        self.store.corrupt=True
        self.assertEqual(self.worker.run_once()['status'],'BACKUP_FAILED');self.assertFalse(self.worker.healthy())
        self.assertFalse(any(k.endswith('.json') for k in self.store.objects))
        self.assertTrue(self.store.bodies[0].closed)
    def test_failure_after_success_immediately_unhealthy_then_recovery(self):
        self.worker.run_once();self.store.failed=True
        event=self.worker.run_once();self.assertFalse(self.worker.healthy())
        self.assertNotIn('PRIVATE',json.dumps(event))
        self.store.failed=False;self.worker.run_once();self.assertTrue(self.worker.healthy())
    def test_never_successful_stale_and_future_clock_unhealthy(self):
        self.assertFalse(self.worker.healthy());self.worker.run_once()
        self.clock[0]+=b.MAX_AGE+1;self.assertFalse(self.worker.healthy())
        self.clock[0]=AT-1;self.assertFalse(self.worker.healthy())
    def test_snapshot_includes_new_commits_without_blocking_writer(self):
        self.worker.run_once();self.j.commit(self.audit,AT+1);self.worker.run_once()
        manifests=[json.loads(v) for k,v in self.store.objects.items() if k.endswith('.json')]
        self.assertEqual([m['counts']['evidence_polls'] for m in manifests],[1,2])
        self.assertEqual(len(self.store.objects),4)
    def test_source_identity_mismatch_prevents_any_upload(self):
        self.worker.identity='f'*64
        self.assertEqual(self.worker.run_once()['status'],'BACKUP_FAILED');self.assertEqual(self.store.calls,[])
    def test_missing_source_not_created(self):
        self.worker.source=Path(self.temp.name)/'absent.sqlite3'
        self.worker.run_once();self.assertFalse(self.worker.source.exists());self.assertEqual(self.store.calls,[])
    def test_empty_journal_not_a_successful_backup(self):
        self.j.close();self.path.unlink()
        self.j=DeliveryEvidenceJournal(self.path,self.identity,PROJECT,enabled=True)
        self.worker.run_once();self.assertFalse(self.worker.healthy());self.assertEqual(self.store.calls,[])
    def test_size_cap_prevents_upload(self):
        with patch.object(b,'MAX_BYTES',10):self.worker.run_once()
        self.assertEqual(self.store.calls,[]);self.assertFalse(self.worker.healthy())
    def test_snapshot_and_restore_cannot_overwrite_existing_files(self):
        with self.assertRaises(FileExistsError):b.snapshot(self.path,self.path,self.identity,PROJECT)
        with self.assertRaises(EvidenceError):b.restore_download(self.store,self.cfg.bucket,
            b.PREFIX+self.identity+'/2026-10-17T16-00-00Z-'+'a'*32+'.sqlite3',self.path,'a'*64,self.identity,PROJECT)
        self.assertEqual(self.store.calls,[])
    def test_restore_wrong_identity_rejected_and_removed(self):
        self.worker.run_once();m=json.loads(next(v for k,v in self.store.objects.items() if k.endswith('.json')))
        path=Path(self.temp.name)/'rejected.sqlite3'
        with self.assertRaises(EvidenceError):b.restore_download(self.store,self.cfg.bucket,m['key'],path,m['sha256'],'f'*64,PROJECT)
        self.assertFalse(path.exists());self.assertTrue(self.store.bodies[-1].closed)
    def test_restore_key_and_hash_scope_guards_before_network(self):
        for key,checksum in [('other/key','a'*64),(b.PREFIX+self.identity+'/2026-10-17T16-00-00Z-'+'a'*32+'.sqlite3','bad')]:
            with self.assertRaises(EvidenceError):b.restore_download(self.store,self.cfg.bucket,key,Path(self.temp.name)/'new.sqlite3',checksum,self.identity,PROJECT)
        self.assertEqual(self.store.calls,[])
    def test_scheduler_selects_hourly_success_and_five_minute_retry(self):
        for status,delay in [('BACKUP_VERIFIED',b.INTERVAL),('BACKUP_FAILED',b.RETRY)]:
            with patch.object(self.worker,'run_once',return_value={'status':status}),patch.object(self.worker.stop,'wait',side_effect=lambda n:self.worker.stop.set()) as wait:
                self.worker.stop.clear();self.worker.start();self.worker.thread.join(timeout=2)
                wait.assert_called_once_with(delay)
    def test_sdk_uses_explicit_credentials_tls_virtual_style_and_bounded_retries(self):
        import boto3
        with patch.object(boto3,'client',return_value='client') as factory:
            self.assertEqual(b.s3_client(self.cfg),'client')
            kw=factory.call_args.kwargs
            self.assertEqual(kw['aws_secret_access_key'],self.cfg.secret_key)
            self.assertEqual(kw['endpoint_url'],self.cfg.endpoint)
            self.assertNotIn('verify',kw)
            self.assertEqual(kw['config'].s3['addressing_style'],'virtual')
            self.assertEqual(kw['config'].retries['total_max_attempts'],2)
    def test_actual_sdk_wire_shapes_put_get_and_manifest_without_network(self):
        from botocore.stub import Stubber,ANY
        from botocore.response import StreamingBody
        client=b.s3_client(self.cfg)
        original=self.store.get_object
        # Capture deterministic snapshot bytes first, then replay through the actual SDK.
        self.worker.run_once();data=next(v for k,v in self.store.objects.items() if not k.endswith('.json'))
        body=StreamingBody(io.BytesIO(data),len(data))
        with Stubber(client) as stub:
            stub.add_response('put_object',{}, {'Bucket':self.cfg.bucket,'Key':ANY,'Body':ANY,'ContentType':'application/vnd.sqlite3','Metadata':ANY})
            stub.add_response('get_object',{'Body':body},{'Bucket':self.cfg.bucket,'Key':ANY})
            stub.add_response('put_object',{}, {'Bucket':self.cfg.bucket,'Key':ANY,'Body':ANY,'ContentType':'application/json'})
            self.worker.client_factory=lambda _:client
            self.assertEqual(self.worker.run_once()['status'],'BACKUP_VERIFIED');stub.assert_no_pending_responses()

    def test_recover_from_lost_original_database_and_resume_journal(self):
        self.worker.run_once();m=json.loads(next(v for k,v in self.store.objects.items() if k.endswith('.json')))
        self.j.close()
        for suffix in ('','-wal','-shm','.lock'):Path(str(self.path)+suffix).unlink(missing_ok=True)
        recovered=Path(self.temp.name)/'replacement-volume';recovered.mkdir(mode=0o700)
        target=recovered/'delivery-evidence.sqlite3'
        b.restore_download(self.store,self.cfg.bucket,m['key'],target,m['sha256'],self.identity,PROJECT)
        self.j=DeliveryEvidenceJournal(target,self.identity,PROJECT,enabled=True)
        self.j.commit(self.audit,AT+1)
        self.assertEqual(self.j.db.execute('SELECT count(*) FROM evidence_states').fetchone()[0],1)
        self.assertEqual(self.j.db.execute('SELECT count(*) FROM evidence_polls').fetchone()[0],2)

    def test_staging_smoke_disabled_scope_and_real_local_restore_contract(self):
        import delivery_evidence_backup_smoke as smoke
        with patch('builtins.print'),patch.object(smoke,'storage_configuration') as cfg:
            self.assertEqual(smoke.main({}),0);cfg.assert_not_called()
            self.assertEqual(smoke.main({'MASTER_WOK_BACKUP_SMOKE_ENABLED':'true'}),1);cfg.assert_not_called()
        env={**self.env(),'MASTER_WOK_BACKUP_SMOKE_ENABLED':'true',
             'RAILWAY_ENVIRONMENT_ID':'c1b8fad6-dbfc-4188-b4b5-a5dbfbf53279',
             'RAILWAY_ENVIRONMENT_NAME':'master-wok-staging','RAILWAY_SERVICE_NAME':'master-wok-evidence-backup-acceptance'}
        real_worker=b.BackupWorker
        def worker(config,identity,**kw):return real_worker(config,identity,client_factory=lambda _:self.store,**kw)
        with patch('builtins.print') as output,patch.object(smoke,'BackupWorker',side_effect=worker):
            self.assertEqual(smoke.main(env),0)
            result=json.loads(output.call_args.args[0]);self.assertEqual(result['sourceRequests'],0)
            self.assertTrue(result['verifiedRestore']);self.assertEqual(result['scope'],'SYNTHETIC_STAGING_ONLY')

    def test_offline_recovery_tool_checks_manifest_and_refuses_live_directory(self):
        from restore_delivery_evidence import restore
        self.worker.run_once()
        key=next(k for k in self.store.objects if not k.endswith('.json'))
        src=Path(self.temp.name)/'download.sqlite3';src.write_bytes(self.store.objects[key])
        meta=Path(self.temp.name)/'download.json';meta.write_bytes(self.store.objects[key+'.json'])
        destination=Path(self.temp.name)/'new-volume';destination.mkdir(mode=0o700)
        result=restore(src,meta,destination/'delivery-evidence.sqlite3',self.identity)
        self.assertEqual(result['status'],'RESTORE_VERIFIED')
        self.assertEqual(result['counts']['evidence_states'],1)
        with self.assertRaises(EvidenceError):restore(src,meta,destination/'delivery-evidence.sqlite3',self.identity)
        rejected=Path(self.temp.name)/'bad-volume';rejected.mkdir()
        src.write_bytes(b'corrupt')
        with self.assertRaises(EvidenceError):restore(src,meta,rejected/'delivery-evidence.sqlite3',self.identity)
        self.assertEqual(list(rejected.iterdir()),[])

if __name__=='__main__':unittest.main()
