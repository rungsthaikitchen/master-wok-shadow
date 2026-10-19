import copy
import json
from pathlib import Path
import tempfile
import unittest
from event_capture_journal import EventCaptureJournal,EventCaptureError,ROOT,invoke_node,snapshot,restore_snapshot,verify_store

IDENTITY='a'*64

def fixture(count=None):
    batch=json.loads((ROOT/'fixtures/chronological-synthetic-service.json').read_text())
    if count is not None:
        batch['events']=batch['events'][:count]
        batch['coverage'].update(eventCount=count,lastSequence=count,throughAt=batch['events'][-1]['at'])
    return batch

class CaptureTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.path=self.root/'event-capture.sqlite3'
        self.now=1000
        self.j=EventCaptureJournal(self.path,IDENTITY,enabled=True,clock=lambda:self.now)
    def tearDown(self):self.j.close();self.tmp.cleanup()

    def test_full_pipeline_deduplicates_persists_and_survives_restart(self):
        batch=fixture();result=self.j.enqueue(batch)
        self.assertEqual(result['status'],'QUEUED')
        self.assertEqual(self.j.db.execute('SELECT count(*) FROM observations').fetchone()[0],0)
        self.assertEqual(self.j.enqueue(batch)['status'],'ALREADY_QUEUED')
        self.assertEqual(self.j.run_once(enabled=True)['observations'],5)
        self.assertEqual(self.j.db.execute('SELECT state FROM batches').fetchone()[0],'ACKED')
        rows=[json.loads(r[0]) for r in self.j.db.execute('SELECT payload FROM observations')]
        self.assertEqual(sum(r['prediction']=='GREEN' for r in rows),4)
        self.assertEqual(sum(r['prediction']=='UNVERIFIED' for r in rows),1)
        self.assertNotIn('lines',json.dumps(rows));self.assertNotIn('customer',json.dumps(rows))
        self.j.close();self.j=EventCaptureJournal(self.path,IDENTITY,enabled=True,clock=lambda:self.now)
        self.assertEqual(self.j.run_once(enabled=True)['status'],'IDLE')
        self.assertEqual(verify_store(self.j.db,IDENTITY)['observations'],5)

    def test_prefix_extension_never_rewrites_earlier_observations(self):
        self.j.enqueue(fixture(4));self.j.run_once(enabled=True)
        before=self.j.db.execute('SELECT key,payload FROM observations ORDER BY key').fetchall()
        self.j.enqueue(fixture());self.j.run_once(enabled=True)
        after=dict(self.j.db.execute('SELECT key,payload FROM observations'))
        for key,payload in before:self.assertEqual(after[key],payload)
        self.assertEqual(len(after),5)
        changed=fixture();changed['events'][0]['order']['targetAt']='2026-10-17T17:10:00Z'
        with self.assertRaises(EventCaptureError):self.j.enqueue(changed)
        self.assertEqual(self.j.db.execute('SELECT count(*) FROM batches').fetchone()[0],2)

    def test_crashed_lease_expires_and_old_token_cannot_ack(self):
        self.j.enqueue(fixture());old=self.j.claim();self.assertIsNone(self.j.claim())
        self.now+=61;new=self.j.claim()
        result=invoke_node(new['batch'])
        with self.assertRaises(EventCaptureError):self.j.complete(old,result)
        self.assertEqual(self.j.complete(new,result)['status'],'RECORDED')

    def test_persist_failure_rolls_back_observations_and_ack_and_retry_is_bounded(self):
        self.j.enqueue(fixture())
        def fail():raise OSError('PRIVATE_SOURCE_SECRET')
        for _ in range(3):
            r=self.j.run_once(enabled=True,before_commit=fail)
            self.assertEqual(r['status'],'UNVERIFIED');self.assertNotIn('PRIVATE_SOURCE_SECRET',str(r))
            self.assertEqual(self.j.db.execute('SELECT count(*) FROM observations').fetchone()[0],0)
        self.assertEqual(self.j.db.execute('SELECT state FROM batches').fetchone()[0],'FAILED')
        self.assertEqual(self.j.run_once(enabled=True)['status'],'IDLE')

    def test_extra_private_fields_and_gaps_rejected_without_storage(self):
        for change in [lambda b:b['events'][0]['order'].update(address='PRIVATE'),
                       lambda b:b['events'][1].update(sequence=99),lambda b:b['coverage'].update(complete=False)]:
            b=fixture();change(b)
            with self.assertRaises(Exception):self.j.enqueue(b)
        self.assertEqual(self.j.db.execute('SELECT count(*) FROM events').fetchone()[0],0)
        self.assertEqual(self.j.run_once(invoke=lambda _:self.fail('disabled'))['status'],'DISABLED')
        with self.assertRaises(EventCaptureError):EventCaptureJournal(self.root/'disabled/event-capture.sqlite3',IDENTITY)

    def test_source_watermark_cannot_claim_coverage_then_insert_past_events(self):
        prefix=fixture(4);prefix['coverage']['throughAt']='2026-10-17T22:00:00Z'
        self.j.enqueue(prefix)
        with self.assertRaises(EventCaptureError):self.j.enqueue(fixture())
        self.assertEqual(self.j.db.execute('SELECT count(*) FROM events').fetchone()[0],4)

    def test_snapshot_restore_keeps_ack_and_detects_corruption(self):
        self.j.enqueue(fixture());self.j.run_once(enabled=True)
        p=self.root/'snapshot.sqlite3';receipt=snapshot(self.j,p)
        dest=self.root/'restored/event-capture.sqlite3';dest.parent.mkdir()
        self.assertEqual(restore_snapshot(p,dest,IDENTITY,receipt['sha256'])['observations'],5)
        restored=EventCaptureJournal(dest,IDENTITY,enabled=True)
        try:self.assertEqual(restored.run_once(enabled=True)['status'],'IDLE')
        finally:restored.close()
        self.j.db.execute("UPDATE observations SET payload=replace(payload,'GREEN','AMBER') WHERE payload LIKE '%GREEN%'");self.j.db.commit()
        with self.assertRaises(EventCaptureError):snapshot(self.j,self.root/'bad.sqlite3')

    def test_fixed_fixture_entrypoint_refuses_live_keys_and_restarts_without_duplicates(self):
        from event_capture_staging import run
        self.assertEqual(run({})['status'],'DISABLED')
        env=dict(MASTER_WOK_EVENT_CAPTURE_FIXTURE_ENABLED='true',MASTER_WOK_EVENT_CAPTURE_SCOPE='LOCAL_FIXED_SYNTHETIC_FIXTURE',
            MASTER_WOK_EVENT_CAPTURE_DIRECTORY=str(self.root/'runner'))
        first=run(env);self.assertEqual(first['worker'],'RECORDED')
        second=run(env);self.assertEqual(second['worker'],'IDLE')
        self.assertEqual(second['summary']['counts']['observations'],5)
        self.assertEqual(second['backup'],'LOCAL_BACKUP_VERIFIED')
        for key in ['RAILWAY_PROJECT_ID','MASTER_WOK_MANAGEMENT_READ_TOKEN','MASTER_WOK_STAGING_GOOGLE_ROUTES_KEY']:
            with self.assertRaises(EventCaptureError):run(dict(env,**{key:'refused'}))

    def test_lease_payload_tampering_cannot_ack_different_source_content(self):
        self.j.enqueue(fixture());message=self.j.claim()
        result=invoke_node(message['batch'])
        message['batch']['coverage']['throughAt']='2026-10-17T22:01:00Z'
        result['coverageThroughAt']=message['batch']['coverage']['throughAt']
        with self.assertRaises(EventCaptureError):self.j.complete(message,result)
        self.assertEqual(self.j.db.execute('SELECT count(*) FROM observations').fetchone()[0],0)
        self.assertEqual(self.j.db.execute('SELECT state FROM batches').fetchone()[0],'LEASED')

    def test_incremental_prefix_fingerprints_match_exact_canonical_batches(self):
        from event_capture_journal import digest,prefix_digests
        events=fixture()['events'];hashes=prefix_digests(events)
        for event in events:self.assertEqual(hashes[event['sequence']],digest(events[:event['sequence']]))

    def test_failed_capture_cannot_be_reported_healthy_just_because_worker_is_idle(self):
        from event_capture_staging import run
        from event_capture_journal import digest,SCOPE
        directory=self.root/'failed-runner';identity=digest(dict(scope=SCOPE,fixture=fixture()))
        j=EventCaptureJournal(directory/'event-capture.sqlite3',identity,enabled=True)
        try:
            j.enqueue(fixture())
            for _ in range(3):j.run_once(enabled=True,invoke=lambda batch:dict(status='UNVERIFIED'))
        finally:j.close()
        result=run(dict(MASTER_WOK_EVENT_CAPTURE_FIXTURE_ENABLED='true',
            MASTER_WOK_EVENT_CAPTURE_SCOPE='LOCAL_FIXED_SYNTHETIC_FIXTURE',MASTER_WOK_EVENT_CAPTURE_DIRECTORY=str(directory)))
        self.assertEqual(result['worker'],'IDLE');self.assertEqual(result['status'],'UNVERIFIED')
        self.assertTrue(result['summary']['failed'])
