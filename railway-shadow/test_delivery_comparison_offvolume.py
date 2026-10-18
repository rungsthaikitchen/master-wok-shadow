import copy
import io
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
from delivery_comparison_journal import DeliveryComparisonJournal
import delivery_comparison_worker as w
import delivery_comparison_offvolume as b
from delivery_comparison_source import record_saved_snapshot
from delivery_shadow_source import prepare_snapshot
from test_delivery_shadow_source import fixture,PROJECT,SECRET
from shadow_collector import timestamp
from delivery_evidence_journal import run_audit

class Client:
    def __init__(self):self.objects={};self.bad=False;self.closed=False;self.manifest_failure=False
    def put_object(self,**kw):
        if self.manifest_failure and kw['Key'].endswith('.json'):raise OSError('secret')
        self.objects[kw['Key']]=kw['Body']
    def get_object(self,**kw):return {'Body':io.BytesIO(b'corrupt' if self.bad else self.objects[kw['Key']])}
    def close(self):self.closed=True

class OffvolumeTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.path=Path(self.temp.name)/'delivery-comparison.sqlite3'
        self.j=DeliveryComparisonJournal(self.path,w.IDENTITY,'SYNTHETIC_STAGING',enabled=True)
        self.j.append_synthetic(w.fixture_batch(),100)
        self.client=Client();self.clock=100
        self.job=b.ComparisonBackup(SimpleNamespace(bucket='synthetic-test'),source=self.path,client_factory=lambda _:self.client,clock=lambda:self.clock)
    def tearDown(self):self.j.close();self.temp.cleanup()
    def test_round_trip_manifest_health_and_expiry(self):
        self.assertFalse(self.job.healthy());r=self.job.run_once()
        self.assertEqual(r['status'],'BACKUP_VERIFIED');self.assertTrue(self.job.healthy());self.assertTrue(self.client.closed)
        self.assertEqual(len(self.client.objects),2)
        self.clock+=7201;self.assertFalse(self.job.healthy())
    def test_corruption_and_manifest_failure_never_report_verified(self):
        for attr in ['bad','manifest_failure']:
            self.client=Client();setattr(self.client,attr,True)
            result=self.job.run_once();self.assertEqual(result['status'],'BACKUP_FAILED');self.assertFalse(self.job.healthy())
            self.assertNotIn('secret',str(result))
    def test_disabled_and_wrong_scope_refused_before_transport(self):
        self.assertIsNone(b.configuration({}))
        with self.assertRaises(Exception):b.configuration({'MASTER_WOK_COMPARISON_BACKUP_ENABLED':'true'})
    def test_saved_snapshot_bridge_default_off_and_records_only_unverified(self):
        calls=[]
        self.assertEqual(record_saved_snapshot(None,lambda:calls.append(1),clock=lambda:0)['status'],'DISABLED');self.assertFalse(calls)
        s=prepare_snapshot(fixture(),'2026-10-17',PROJECT,SECRET)
        path=Path(self.temp.name)/'real'/'delivery-comparison.sqlite3'
        j=DeliveryComparisonJournal(path,s['sourceIdentity'],'SAVED_STATE_ONLY',enabled=True)
        try:
            at=timestamp(s['observedAt']).timestamp()
            r=record_saved_snapshot(j,lambda:s,enabled=True,clock=lambda:at)
            self.assertEqual(r['status'],'RECORDED');self.assertEqual(r['prediction'],'UNVERIFIED')
            self.assertEqual(j.summary()['observedStatusVsHypothetical'][0]['prediction'],'UNVERIFIED')
            wrong=copy.deepcopy(s);wrong['sourceRole']='postgres'
            self.assertEqual(record_saved_snapshot(j,lambda:wrong,enabled=True,clock=lambda:at)['status'],'UNVERIFIED')
        finally:j.close()

    def test_saved_bridge_refuses_mismatched_audit_without_writes(self):
        s=prepare_snapshot(fixture(),'2026-10-17',PROJECT,SECRET)
        j=DeliveryComparisonJournal(Path(self.temp.name)/'saved'/'delivery-comparison.sqlite3',s['sourceIdentity'],'SAVED_STATE_ONLY',enabled=True)
        try:
            audit=run_audit(s);audit['snapshotHash']='b'*64
            r=record_saved_snapshot(j,lambda:s,enabled=True,clock=lambda:timestamp(s['observedAt']).timestamp(),assessor=lambda _:audit)
            self.assertEqual(r['status'],'UNVERIFIED');self.assertEqual(j.summary()['latestRecords'],0)
        finally:j.close()

    def test_health_fails_when_polling_succeeds_but_backup_is_unverified(self):
        from urllib.request import Request,build_opener,ProxyHandler
        from urllib.error import HTTPError
        monitor=w.Monitor();monitor.failed=False;monitor.last_success=w.time.time()
        state={'backup':False};server=w.serve_health(monitor,'x'*32,0,extra_health=lambda:state['backup'])
        request=Request('http://127.0.0.1:'+str(server.server_address[1])+'/healthz',headers={'Authorization':'Bearer '+'x'*32})
        opener=build_opener(ProxyHandler({}))
        try:
            with self.assertRaises(HTTPError) as raised:opener.open(request,timeout=2)
            self.assertEqual(raised.exception.code,503);raised.exception.close()
            state['backup']=True
            with opener.open(request,timeout=2) as response:self.assertEqual(response.status,200)
        finally:server.shutdown();server.server_close()
