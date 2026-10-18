import json
from pathlib import Path
import tempfile
import unittest
from delivery_comparison_controller import ComparisonController
from delivery_comparison_journal import DeliveryComparisonJournal
from delivery_comparison_backup import backup,restore
from test_delivery_retrospective_journal import aggregate
from shadow_collector import timestamp

class ControllerTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        self.path=self.root/'delivery-comparison.sqlite3'
        self.j=DeliveryComparisonJournal(self.path,'a'*64,'RETROSPECTIVE_CONDITIONAL',enabled=True)
        self.now=timestamp('2026-10-18T17:00:00Z').timestamp();self.calls=[]
        self.candidate=dict(sourceIdentity='a'*64,sourceHash='b'*64,buildHash='c'*64,
            observedStatus='completed',serviceDate='2026-10-17')
        self.c=ComparisonController(self.j,enabled=True,allow_capture=True,request_limit=2,clock=lambda:self.now)

    def tearDown(self):self.j.close();self.tmp.cleanup()
    def read(self):return dict(self.candidate)
    def capture(self,candidate):
        self.calls.append(candidate)
        return dict(result=aggregate(),capturedAt='2026-10-18T17:00:00Z')
    def backed(self):return dict(status='BACKUP_VERIFIED',verifiedRestore=True,verifiedAt=self.now)
    def cycle(self,**kw):
        args=dict(read_candidate=self.read,capture=self.capture,backup=self.backed);args.update(kw)
        return self.c.cycle(**args)

    def test_disabled_touches_no_callbacks_or_tables(self):
        disabled=ComparisonController(None)
        def refuse(*args):raise AssertionError('disabled callback')
        self.assertEqual(disabled.cycle(refuse,refuse,refuse)['status'],'DISABLED')

    def test_success_dedup_and_budget_survive_reopen(self):
        self.assertFalse(self.c.healthy());self.assertEqual(self.cycle()['reservedRequests'],2)
        self.assertTrue(self.c.healthy());self.assertEqual(self.cycle()['reasonCode'],'ALREADY_RECORDED')
        self.j.close();self.j=DeliveryComparisonJournal(self.path,'a'*64,'RETROSPECTIVE_CONDITIONAL',enabled=True)
        self.c=ComparisonController(self.j,enabled=True,allow_capture=True,request_limit=2,clock=lambda:self.now)
        self.candidate['sourceHash']='d'*64
        self.assertEqual(self.cycle()['reasonCode'],'REQUEST_BUDGET_EXHAUSTED')
        self.assertFalse(self.c.healthy());self.assertEqual(len(self.calls),1)
        with self.assertRaises(Exception):ComparisonController(self.j,enabled=True,request_limit=4)

    def test_failure_reservation_never_refunded_or_retried_and_errors_redacted(self):
        def fail(candidate):self.calls.append(candidate);raise OSError('PRIVATE_ADDRESS_SECRET')
        self.assertEqual(self.cycle(capture=fail)['status'],'UNVERIFIED')
        self.assertEqual(self.cycle()['reasonCode'],'PRIOR_CAPTURE_UNVERIFIED')
        self.assertEqual(len(self.calls),1);self.assertFalse(self.c.healthy())
        raw=str(self.j.db.execute('select * from controller_events').fetchall())
        self.assertNotIn('PRIVATE_ADDRESS_SECRET',raw)

    def test_invalid_capture_or_candidate_cannot_be_recorded(self):
        self.candidate['address']='private'
        self.assertEqual(self.cycle()['status'],'UNVERIFIED');self.assertFalse(self.calls)
        del self.candidate['address']
        self.assertEqual(self.cycle(capture=lambda c:dict(result=aggregate(),capturedAt='2020-01-01T00:00:00Z'))['status'],'UNVERIFIED')
        self.assertEqual(self.j.db.execute('select count(*) from observations').fetchone()[0],0)

    def test_backup_failure_and_staleness_fail_health(self):
        self.cycle(backup=lambda:dict(status='BACKUP_FAILED',verifiedRestore=False))
        self.assertFalse(self.c.healthy())
        self.cycle();self.assertTrue(self.c.healthy())
        self.now+=181;self.assertFalse(self.c.healthy())

    def test_restore_preserves_consumed_quota(self):
        self.cycle();p=self.root/'snapshot.sqlite3';meta=backup(self.j,p)
        directory=self.root/'restored';directory.mkdir();dest=directory/'delivery-comparison.sqlite3'
        restore(p,dest,'a'*64,'RETROSPECTIVE_CONDITIONAL',meta['sha256'])
        other=DeliveryComparisonJournal(dest,'a'*64,'RETROSPECTIVE_CONDITIONAL',enabled=True)
        try:
            c=ComparisonController(other,enabled=True,allow_capture=True,request_limit=2,clock=lambda:self.now)
            candidate=dict(self.candidate,sourceHash='d'*64)
            r=c.cycle(lambda:candidate,self.capture,self.backed)
            self.assertEqual(r['reasonCode'],'REQUEST_BUDGET_EXHAUSTED');self.assertEqual(len(self.calls),1)
        finally:other.close()

    def test_stoppable_loop_and_empty_source_make_no_capture(self):
        class Stop:
            stopped=False
            def is_set(self):return self.stopped
            def wait(self,seconds):self.stopped=True
        events=[]
        self.c.run(Stop(),lambda:None,self.capture,self.backed,events.append)
        self.assertEqual(events[0]['reasonCode'],'NO_CANDIDATE');self.assertFalse(self.calls)

    def test_capture_has_separate_default_off_gate(self):
        self.c=ComparisonController(self.j,enabled=True,request_limit=2,clock=lambda:self.now)
        self.assertEqual(self.cycle()['reasonCode'],'CAPTURE_DISABLED')
        self.assertFalse(self.calls)
        self.assertEqual(self.j.db.execute('select count(*) from capture_reservations').fetchone()[0],0)

    def test_cached_backup_requires_actual_recent_verification_time(self):
        for at in [None,self.now-7201,self.now+1,float('nan'),True]:
            r=self.cycle(backup=lambda:dict(status='BACKUP_VERIFIED',verifiedRestore=True,verifiedAt=at))
            self.assertEqual(r['status'],'UNVERIFIED');self.assertFalse(self.c.healthy())

    def test_private_health_labels_conditional_evidence_and_fails_closed(self):
        from delivery_comparison_worker import serve_health
        from urllib.request import Request,build_opener,ProxyHandler
        from urllib.error import HTTPError
        server=serve_health(self.c,'s'*32,0,data_origin='CONDITIONAL_RETROSPECTIVE')
        opener=build_opener(ProxyHandler({}))
        url='http://127.0.0.1:'+str(server.server_address[1])+'/healthz'
        def get(auth=True):
            req=Request(url,headers={'Authorization':'Bearer '+'s'*32} if auth else {})
            try:
                with opener.open(req,timeout=2) as response:return response.status,json.load(response)
            except HTTPError as error:
                code=error.code;error.close();return code,None
        try:
            self.assertEqual(get(False)[0],401);self.assertEqual(get()[0],503)
            self.cycle();status,body=get()
            self.assertEqual(status,200);self.assertEqual(body['dataOrigin'],'CONDITIONAL_RETROSPECTIVE')
            self.assertFalse(body['verified']);self.now+=181;self.assertEqual(get()[0],503)
        finally:server.shutdown();server.server_close()
