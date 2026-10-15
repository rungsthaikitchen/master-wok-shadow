import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from urllib.parse import parse_qs, urlsplit

spec = importlib.util.spec_from_file_location('collector', Path(__file__).with_name('shadow_collector.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
SECRET = 'synthetic-test-key-not-a-real-secret-12345'
DAY = '2026-10-14'

def snapshot(status='confirmed', qty=1):
    return {'orders': [{'id':'order-1', 'created_at':'2026-10-14T14:00:00Z',
        'preferred_time':'2026-10-14T17:00:00Z', 'proposed_time':None,
        'confirmed_time':None, 'status':status, 'is_test':False, 'name':'DO_NOT_STORE'}],
        'items':[{'id':'line-1','order_id':'order-1','item_id':'pad-thai','qty':qty,
                  'modifiers':[{'id':'tofu','name':'DO_NOT_STORE','delta':1}]}]}

def assessment(day, rows):
    return {'verified':False, 'observations':[{'orderId':row['orderId'],'status':'GREEN'} for row in rows]}

class Source:
    def __init__(self, snapshots):
        self.snapshots = iter(snapshots)
        self.calls = 0
    def snapshot(self, day):
        self.calls += 1
        return next(self.snapshots)

class Tests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.filename = str(Path(self.temp.name) / 'monitor.sqlite3')
        self.store = m.MonitorStore(self.filename, 'test-build-identity')
    def tearDown(self):
        self.store.close()
        self.temp.cleanup()
    def test_disabled_has_no_calls(self):
        source = Source([])
        self.assertEqual(m.Collector(source,self.store,SECRET,assessment).poll(DAY), {'state':'DISABLED'})
        self.assertEqual(source.calls,0)
        self.assertEqual(self.store.db.execute('select count(*) from polls').fetchone()[0],0)
    def test_normalization_minimizes_and_pseudonymizes(self):
        normalized=m.normalize(snapshot(),SECRET)
        payload=m.canonical(normalized)
        self.assertNotIn('DO_NOT_STORE',payload)
        self.assertNotIn('order-1',payload)
        self.assertEqual(len(normalized[0]['orderId']),64)
        self.assertEqual(normalized[0]['lines'][0]['mods'],[{'id':'tofu'}])
    def test_restart_and_unchanged_poll_dedup(self):
        data=snapshot()
        result=m.Collector(Source([data,data]),self.store,SECRET,assessment,True).poll(DAY)
        self.assertEqual(result['state'],'OBSERVED')
        self.store.close()
        self.store=m.MonitorStore(self.filename,'test-build-identity')
        m.Collector(Source([data,data]),self.store,SECRET,assessment,True).poll(DAY)
        self.assertEqual(self.store.db.execute('select count(*) from states').fetchone()[0],1)
        self.assertEqual(self.store.db.execute('select count(*) from polls').fetchone()[0],2)
        summary=self.store.summary()
        self.assertEqual(summary['prediction'],'UNVERIFIED')
        self.assertEqual(summary['observedStatusVsHypotheticalHint'][DAY+'/confirmed/GREEN'],1)
    def test_state_cycle_is_preserved(self):
        for status in ['pending','confirmed','pending']:
            data=snapshot(status)
            m.Collector(Source([data,data]),self.store,SECRET,assessment,True).poll(DAY)
        self.assertEqual(self.store.db.execute('select count(*) from states').fetchone()[0],3)
    def test_no_partial_sample_when_source_changes(self):
        result=m.Collector(Source([snapshot(),snapshot(qty=2)]),self.store,SECRET,assessment,True).poll(DAY)
        self.assertEqual(result['reason'],'SOURCE_CHANGED_DURING_READ')
        self.assertEqual(self.store.db.execute('select count(*) from states').fetchone()[0],0)
    def test_model_failure_still_records_observed_state_without_green(self):
        def fail(*args): raise RuntimeError('PRIVATE_ERROR')
        result=m.Collector(Source([snapshot(),snapshot()]),self.store,SECRET,fail,True).poll(DAY)
        self.assertEqual(result['reason'],'REPLAY_UNAVAILABLE')
        self.assertEqual(self.store.db.execute('select model_hint,prediction from states').fetchone(),('UNVERIFIED','UNVERIFIED'))
        self.assertNotIn('PRIVATE_ERROR',m.canonical(self.store.summary()))
    def test_storage_failure_returns_uncertainty(self):
        class BrokenStore:
            def record(self,*args): raise OSError('disk full')
            def failure(self,*args): raise OSError('disk full')
        result=m.Collector(Source([snapshot(),snapshot()]),BrokenStore(),SECRET,assessment,True).poll(DAY)
        self.assertEqual(result['reason'],'PERSISTENCE_FAILED')
    def test_build_or_key_change_rejected(self):
        with self.assertRaisesRegex(m.ShadowError,'IDENTITY_CHANGED'):
            other=m.MonitorStore(self.filename,'other-build')
    def test_no_naive_timestamps_and_invalid_qty(self):
        with self.assertRaises(m.ShadowError): m.timestamp('2026-10-14T17:00:00')
        for qty in [0,True,1.5,101]:
            with self.assertRaises(m.ShadowError): m.normalize(snapshot(qty=qty),SECRET)
    def test_cancelled_rejected_proposal_and_different_day_not_replayed(self):
        for status in ['cancelled','customer_declined_time']:
            row=m.normalize(snapshot(status),SECRET)
            row[0]['confirmed_time']='2026-10-14T17:00:00Z'
            self.assertEqual(m.replay_rows(DAY,row),[])
        rows=m.normalize(snapshot('pending'),SECRET)
        rows[0]['proposed_time']='2026-10-14T18:00:00Z'
        self.assertEqual(m.replay_rows(DAY,rows),[])
        self.assertEqual(m.replay_rows('2026-10-15',m.normalize(snapshot(),SECRET)),[])
    def test_london_dst_day_bounds(self):
        for day,hours in [('2026-03-29',23),('2026-10-25',25)]:
            start,end=m.day_bounds(day)
            self.assertEqual((m.timestamp(end)-m.timestamp(start)).total_seconds()/3600,hours)
    def test_paging_query_projection_and_item_batches(self):
        data=snapshot()
        urls=[]
        def transport(url,headers):
            urls.append(url)
            query=parse_qs(urlsplit(url).query)
            self.assertNotIn('customers',query['select'][0])
            if '/orders?' in url:
                self.assertIn('confirmed_time.gte.',query['or'][0])
                self.assertEqual(query['is_test'],['eq.false'])
                return data['orders'],'0-0/1'
            return data['items'],'0-0/1'
        source=m.ReadOnlySource('https://synthetic.supabase.co','not-a-real-key',transport)
        loaded=source.snapshot(DAY)
        self.assertEqual(len(loaded['orders']),1)
        self.assertEqual(len(urls),2)
    def test_changed_page_count_duplicate_and_missing_page_fail(self):
        for pages in [ [([{'id':'a'}],'0-0/2'),([], '*/3')],
                       [([{'id':'a'}],'0-0/2'),([{'id':'a'}], '1-1/2')],
                       [([{'id':'a'}],'0-0/2'),([], '*/2')] ]:
            iterator=iter(pages)
            source=m.ReadOnlySource('https://synthetic.supabase.co','test',lambda *args:next(iterator),page_size=1)
            with self.assertRaises(m.ShadowError): source._pages('orders',{'select':m.ORDER_FIELDS})
    def test_missing_count_and_unsafe_origins_fail(self):
        for url in ['http://synthetic.supabase.co','https://other.test','https://synthetic.supabase.co/path','https://user:pass@synthetic.supabase.co']:
            with self.assertRaises(m.ShadowError): m.ReadOnlySource(url,'test')
        source=m.ReadOnlySource('https://synthetic.supabase.co','test',lambda *args:([], '*/0'))
        self.assertEqual(source._pages('orders',{}),[])
        source=m.ReadOnlySource('https://synthetic.supabase.co','test',lambda *args:([], '*/*'))
        with self.assertRaises(m.ShadowError): source._pages('orders',{})
    def test_real_node_bridge_on_synthetic_data(self):
        result=m.run_replay(DAY,m.replay_rows(DAY,m.normalize(snapshot(),SECRET)))
        self.assertFalse(result['verified'])
        self.assertEqual(result['observations'][0]['status'],'GREEN')
    def test_unknown_menu_item_never_produces_green(self):
        rows=m.replay_rows(DAY,m.normalize(snapshot(),SECRET))
        rows[0]['lines'][0]['itemId']='unknown-menu-dish'
        with self.assertRaises(m.ShadowError): m.run_replay(DAY,rows)
    def test_source_partial_order_without_items_unverified(self):
        data=snapshot();data['items']=[]
        result=m.Collector(Source([data,data]),self.store,SECRET,enabled=True).poll(DAY)
        self.assertEqual(result['reason'],'REPLAY_UNAVAILABLE')
    def test_redirection_is_refused(self):
        with self.assertRaises(m.ShadowError):
            m.NoRedirect().redirect_request(None,None,None,None,None,None)


class PresenceTests(unittest.TestCase):
    def test_absence_is_recorded_without_inventing_cancellation(self):
        with tempfile.TemporaryDirectory() as temp:
            store=m.MonitorStore(str(Path(temp)/'sample.db'),'identity')
            try:
                rows=m.normalize(snapshot(),SECRET)
                store.record(DAY,rows,assessment(DAY,m.replay_rows(DAY,rows)))
                self.assertEqual(store.summary()['latestOrderStates'],1)
                store.record(DAY,[],{'observations':[]})
                self.assertEqual(store.summary()['latestOrderStates'],0)
                self.assertEqual(store.db.execute('select count(*) from states').fetchone()[0],1)
                store.failure(DAY,'COLLECTOR_ERROR')
                self.assertTrue(store.summary()['stale'])
            finally: store.close()


class BoundaryTests(unittest.TestCase):
    def test_disabled_entrypoint_ignores_invalid_live_configuration(self):
        import subprocess, os
        result=subprocess.run(['python3',str(Path(__file__).with_name('shadow_collector.py')),'--once'],
            env={**os.environ,'MASTER_WOK_COLLECTOR_ENABLED':'false','MASTER_WOK_SUPABASE_URL':'invalid',
                 'MASTER_WOK_MONITOR_DB':'/DO_NOT_CREATE/monitor.db'},capture_output=True,text=True,check=True)
        self.assertEqual(json.loads(result.stdout),{'state':'DISABLED'})
    def test_http_transport_is_get_only(self):
        from unittest.mock import patch
        requests=[]
        class Response:
            status=200
            headers={'Content-Range':'*/0'}
            def read(self,limit): return b'[]'
            def __enter__(self): return self
            def __exit__(self,*args): pass
        class Opener:
            def open(self,request,timeout):
                requests.append(request)
                return Response()
        with patch.object(m,'build_opener',return_value=Opener()):
            source=m.ReadOnlySource('https://synthetic.supabase.co','synthetic-key')
            source.snapshot(DAY)
        self.assertEqual(len(requests),1)
        self.assertEqual(requests[0].get_method(),'GET')
        self.assertIsNone(requests[0].data)
        with self.assertRaises(m.ShadowError): source._pages('customers',{})
    def test_committed_sqlite_sample_survives_process_exit_without_close(self):
        import subprocess
        with tempfile.TemporaryDirectory() as temp:
            filename=str(Path(temp)/'monitor.db')
            module=str(Path(__file__).with_name('shadow_collector.py'))
            script="""import importlib.util,sys,os
spec=importlib.util.spec_from_file_location('collector',sys.argv[1])
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
store=m.MonitorStore(sys.argv[2],'crash-test')
store.record('2026-10-14',[],{'observations':[]})
os._exit(0)
"""
            subprocess.run(['python3','-c',script,module,filename],check=True)
            store=m.MonitorStore(filename,'crash-test')
            try: self.assertEqual(store.db.execute('select count(*) from polls').fetchone()[0],1)
            finally: store.close()

if __name__=='__main__': unittest.main(verbosity=2)
