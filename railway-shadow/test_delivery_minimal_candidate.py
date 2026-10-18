import copy
import json
import time
import unittest
from datetime import datetime,timezone
from delivery_minimal_candidate import prepare,read,QUERY

PROJECT='hvrqgufqjslvgiohgkvu';SECRET='synthetic-secret-'*3
ORIGIN=dict(point=dict(lat=51.5,lng=-0.12),verified=True,provenance='OWNER_VERIFIED_KITCHEN_ORIGIN')
def fixture():
    return [dict(source_role='supabase_read_only_user',read_only='on',
        observed_at=datetime.now(timezone.utc).isoformat(),order_count=3,item_count=5,
        earlier_count=0,tie_count=1,snapshot_hash='a'*64,
        orders=[dict(id='synthetic-order',created_at='2026-10-17T15:45:00Z',preferred_time='2026-10-17T16:00:00Z',
            proposed_time='2026-10-17T16:30:00Z',confirmed_time='2026-10-17T16:30:00Z',
            status='completed',is_test=False,order_type='delivery',customer_lat=51.51,customer_lng=-0.13)],
        items=[dict(id='synthetic-line',order_id='synthetic-order',item_id='panang-curry',qty=1,modifiers=[dict(id='chicken')])])]

def prepared(raw=None):return prepare(fixture() if raw is None else raw,'2026-10-17',PROJECT,SECRET,ORIGIN,clock=time.time)

class MinimalTests(unittest.TestCase):
    def test_verified_empty_service_returns_no_candidate(self):
        raw=fixture();raw[0].update(order_count=0,item_count=0,earlier_count=0,tie_count=0,orders=None,items=[])
        self.assertIsNone(prepared(raw))
        raw[0]['item_count']=1
        with self.assertRaises(Exception):prepared(raw)

    def test_single_private_candidate_normalised_and_confirmed_preserved(self):
        raw=fixture();raw[0]['orders'][0]['name']='SHOULD_NOT_ESCAPE'
        r=prepared(raw);p=json.loads(r['privateJson'])
        self.assertEqual(len(p['source']['orders']),1)
        self.assertEqual(p['source']['totalSavedOrderCount'],3)
        self.assertEqual(p['source']['orders'][0]['confirmed_time'],'2026-10-17T16:30:00+00:00')
        self.assertNotIn('SHOULD_NOT_ESCAPE',r['privateJson']);self.assertNotIn('synthetic-order',r['privateJson'])
        self.assertEqual(set(p['points']),{'KITCHEN','CANDIDATE'})

    def test_default_off_never_calls_transport(self):
        self.assertEqual(read(clock=time.time,transport=lambda p:self.fail('called'))['status'],'DISABLED')

    def test_exact_readonly_query_and_project_guard(self):
        calls=[]
        r=read('https://'+PROJECT+'.supabase.co','synthetic-token','2026-10-17',SECRET,ORIGIN,
            enabled=True,approved_project=PROJECT,clock=time.time,transport=lambda p:(calls.append(p) or fixture()))
        self.assertEqual(calls[0]['query'],QUERY);self.assertEqual(len(calls[0]['parameters']),2)
        self.assertIn('FROM public.orders',QUERY);self.assertIn('public.order_items',QUERY)
        self.assertEqual(r['observedStatus'],'completed')
        with self.assertRaises(Exception):read('https://evil.example',enabled=True,approved_project=PROJECT,clock=time.time)

    def test_coverage_role_timestamp_and_coordinate_failures(self):
        for k,v in [('source_role','postgres'),('read_only','off'),('order_count',501),('item_count',5001),
                    ('earlier_count',1),('tie_count',2),('observed_at','2020-01-01T00:00:00Z')]:
            raw=fixture();raw[0][k]=v
            with self.assertRaises(Exception):prepared(raw)
        for change in [dict(customer_lat=True),dict(order_type='collection'),dict(confirmed_time=None),dict(status='pending')]:
            raw=fixture();raw[0]['orders'][0].update(change)
            with self.assertRaises(Exception):prepared(raw)

    def test_invalid_origin_and_secret_refused_before_query(self):
        for origin,secret in [(dict(ORIGIN,verified=False),SECRET),(dict(ORIGIN,provenance='GUESSED'),SECRET),(ORIGIN,'short')]:
            calls=[]
            with self.assertRaises(Exception):read('https://'+PROJECT+'.supabase.co','synthetic-token',
                '2026-10-17',secret,origin,enabled=True,approved_project=PROJECT,clock=time.time,
                transport=lambda p:calls.append(p))
            self.assertEqual(calls,[])

    def test_orphan_duplicate_and_malformed_items_refused(self):
        for change in [lambda r:r[0]['items'][0].update(order_id='other'),
            lambda r:r[0]['items'].append(copy.deepcopy(r[0]['items'][0])),
            lambda r:r[0]['items'][0].update(modifiers='invalid')]:
            raw=fixture();change(raw)
            with self.assertRaises(Exception):prepared(raw)
