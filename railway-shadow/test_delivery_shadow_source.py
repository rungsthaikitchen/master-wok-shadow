import copy
import json
import unittest
import subprocess
from delivery_shadow_source import prepare_snapshot, read_delivery_snapshot, QUERY
from shadow_collector import ShadowError

PROJECT='ubyjrrsvbbqomitpaidb'
SECRET='rehearsal-secret-not-a-runtime-token'*2

def fixture():
    return [{'source_role':'supabase_read_only_user','observed_at':'2026-10-17T16:00:00+00:00',
             'orders':[{'id':'private-order-uuid','created_at':'2026-10-17T12:00:00Z','preferred_time':'2026-10-17T18:00:00Z',
             'proposed_time':None,'confirmed_time':None,'status':'confirmed','is_test':False,'order_type':'delivery',
             'delivery_fee_band':'FREE','has_coordinates':True,'customer_name':'PRIVATE NAME','customer_lat':53.7,'customer_lng':-1.6}],
             'items':[{'id':'private-item-uuid','order_id':'private-order-uuid','item_id':'panang-curry','qty':1,
                       'modifiers':[{'id':'chicken','customer_note':'PRIVATE NOTE'}]}]}]

class DeliverySourceTests(unittest.TestCase):
    def test_default_off_precedes_credentials_or_transport(self):
        def refused(_):raise AssertionError('network')
        self.assertEqual(read_delivery_snapshot(transport=refused)['status'],'DISABLED')
        self.assertEqual(read_delivery_snapshot(enabled='true',transport=refused)['status'],'DISABLED')

    def test_fixed_atomic_read_and_bounded_parameters(self):
        seen=[]
        def transport(payload):seen.append(payload);return fixture()
        s=read_delivery_snapshot('https://'+PROJECT+'.supabase.co','read-token',SECRET,'2026-10-17',enabled=True,transport=transport)
        self.assertEqual(seen,[{'query':QUERY,'parameters':['2026-10-16T23:00:00+00:00','2026-10-17T23:00:00+00:00',501,5001]}])
        self.assertEqual(s['orders'][0]['orderType'],'delivery')
        self.assertEqual(s['orders'][0]['deliveryFeeBand'],'FREE')
        self.assertNotIn('customer_address',QUERY)
        self.assertNotIn('route_miles',QUERY)
        self.assertNotIn('INSERT',QUERY)

    def test_privacy_and_alias_namespace_and_hashes(self):
        raw=fixture();before=copy.deepcopy(raw)
        s=prepare_snapshot(raw,'2026-10-17',PROJECT,SECRET)
        text=json.dumps(s)
        for secret in ['private-order-uuid','private-item-uuid','PRIVATE NAME','PRIVATE NOTE','customer_lat','customer_lng',SECRET]:
            self.assertNotIn(secret,text)
        self.assertEqual(raw,before)
        same=prepare_snapshot(raw,'2026-10-17',PROJECT,SECRET)
        self.assertEqual(s,same)
        changed=prepare_snapshot(raw,'2026-10-17',PROJECT,'another-private-secret'*3)
        self.assertNotEqual(s['sourceIdentity'],changed['sourceIdentity'])
        self.assertNotEqual(s['orders'][0]['orderId'],changed['orders'][0]['orderId'])
        raw[0]['observed_at']='2026-10-17T16:01:00Z'
        self.assertEqual(s['snapshotHash'],prepare_snapshot(raw,'2026-10-17',PROJECT,SECRET)['snapshotHash'])
        raw[0]['orders'][0]['confirmed_time']='2026-10-17T18:10:00Z'
        self.assertNotEqual(s['snapshotHash'],prepare_snapshot(raw,'2026-10-17',PROJECT,SECRET)['snapshotHash'])

    def test_source_role_filter_duplicates_orphans_and_bad_timestamps_refused(self):
        changes=[lambda s:s[0].update(source_role='postgres'),lambda s:s[0]['orders'][0].update(is_test=True),
          lambda s:s[0]['orders'].append(copy.deepcopy(s[0]['orders'][0])),
          lambda s:s[0]['items'].append(copy.deepcopy(s[0]['items'][0])),lambda s:s[0]['items'][0].update(order_id='orphan'),
          lambda s:s[0]['orders'][0].update(created_at='2026-10-17T19:00:00Z'),
          lambda s:s[0]['orders'][0].update(confirmed_time='invalid'),
          lambda s:s[0]['orders'][0].update(confirmed_time=''),lambda s:s[0]['orders'][0].pop('order_type')]
        for change in changes:
            raw=fixture();change(raw)
            with self.assertRaises((ShadowError,ValueError)):prepare_snapshot(raw,'2026-10-17',PROJECT,SECRET)

    def test_empty_state_and_missing_type_are_explicit_not_delivery_guesses(self):
        raw=fixture();raw[0]['orders'][0]['order_type']=None;raw[0]['orders'][0]['has_coordinates']=False
        s=prepare_snapshot(raw,'2026-10-17',PROJECT,SECRET)
        self.assertEqual(s['orders'][0]['orderType'],'UNKNOWN')
        self.assertEqual(s['orders'][0]['coordinateEvidence'],'MISSING_OR_INVALID')
        raw[0]['orders']=[];raw[0]['items']=[]
        s=prepare_snapshot(raw,'2026-10-17',PROJECT,SECRET)
        self.assertEqual(s['orderCount'],0)

    def test_cross_language_readiness_uses_real_normalizer_output(self):
        from pathlib import Path
        s=prepare_snapshot(fixture(),'2026-10-17',PROJECT,SECRET)
        root=Path(__file__).resolve().parents[1]
        script="const fs=require('fs');process.stdout.write(JSON.stringify(require('./master-wok-delivery-evidence-audit').auditDeliveryEvidence(JSON.parse(fs.readFileSync(0,'utf8')),{enabled:true})))"
        r=subprocess.run(['node','-e',script],cwd=root,input=json.dumps(s),text=True,capture_output=True,check=True)
        audit=json.loads(r.stdout)
        self.assertEqual(audit['status'],'OBSERVED')
        self.assertEqual(audit['deliveryOrders'],1)
        self.assertIsNone(audit['recommendation'])
        self.assertIn('DIRECTIONAL_ROUTE_DURATIONS_UNAVAILABLE',audit['records'][0]['reasonCodes'])
        self.assertFalse(audit['verified'])

    def test_overflow_and_unapproved_origin_fail_before_partial_success(self):
        with self.assertRaises(ShadowError):read_delivery_snapshot('https://unapproved.supabase.co','t',SECRET,'2026-10-17',enabled=True)
        raw=fixture();raw[0]['orders']=[{**raw[0]['orders'][0],'id':str(i)} for i in range(501)]
        with self.assertRaises(ShadowError):prepare_snapshot(raw,'2026-10-17',PROJECT,SECRET)

if __name__=='__main__':unittest.main()
