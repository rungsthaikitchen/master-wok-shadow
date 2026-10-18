import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
from delivery_minimal_candidate import prepare
from delivery_private_bridge import PrivateCandidateBridge,BRIDGE
from delivery_comparison_controller import ComparisonController
from delivery_comparison_journal import DeliveryComparisonJournal,canonical
from test_delivery_minimal_candidate import fixture,PROJECT,SECRET,ORIGIN

class BridgeTests(unittest.TestCase):
    def test_default_off_never_reads_or_invokes(self):
        def fail(*args):raise AssertionError('disabled callback')
        self.assertIsNone(PrivateCandidateBridge(fail,invoke=fail).read_candidate())
        self.assertIsNone(PrivateCandidateBridge(lambda:None,enabled=True,invoke=fail).read_candidate())

    def test_real_python_node_controller_path_is_private_deduplicated_and_simulated(self):
        calls=[]
        def reader():return prepare(fixture(),'2026-10-17',PROJECT,SECRET,ORIGIN,clock=time.time)
        def invoke(payload,capture):
            if capture:calls.append(1)
            script="const {run}=require('./master-wok-private-route-bridge');let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',async()=>{const r=await run(JSON.parse(s),{enabled:true,allowLiveRequests:true,stage:'staging',apiKey:'synthetic',transport:async()=>({status:200,data:{routes:[{duration:'480s'}]}})});process.stdout.write(JSON.stringify(r));});"
            raw=subprocess.check_output(['node','-e',script],input=canonical(payload),text=True,
                cwd=BRIDGE.parent,timeout=15,env={'PATH':os.environ['PATH']})
            return json.loads(raw)
        b=PrivateCandidateBridge(reader,enabled=True,allow_capture=True,api_key='synthetic',staging=True,invoke=invoke)
        first=b.read_candidate()
        with tempfile.TemporaryDirectory() as folder:
            j=DeliveryComparisonJournal(Path(folder)/'delivery-comparison.sqlite3',first['sourceIdentity'],
                'RETROSPECTIVE_CONDITIONAL',enabled=True)
            try:
                c=ComparisonController(j,enabled=True,allow_capture=True,request_limit=2)
                backup=lambda:dict(status='BACKUP_VERIFIED',verifiedRestore=True,verifiedAt=time.time())
                result=c.cycle(b.read_candidate,b.capture,backup)
                self.assertEqual(result['reasonCode'],'CONDITIONAL_AGGREGATE_RECORDED')
                result=c.cycle(b.read_candidate,b.capture,backup)
                self.assertEqual(result['reasonCode'],'ALREADY_RECORDED');self.assertEqual(len(calls),1)
                raw=''.join(row[0] for row in j.db.execute('SELECT payload FROM observations'))
                for word in ['privateJson','panang-curry','latitude','durationSeconds','synthetic-order']:
                    self.assertNotIn(word,raw)
                with self.assertRaises(Exception):b.capture(dict(first,sourceHash='f'*64))
            finally:j.close()

    def test_default_subprocess_preflight_does_not_inherit_provider_key(self):
        def reader():return prepare(fixture(),'2026-10-17',PROJECT,SECRET,ORIGIN,clock=time.time)
        b=PrivateCandidateBridge(reader,enabled=True)
        candidate=b.read_candidate()
        self.assertEqual(candidate['observedStatus'],'completed')
        with self.assertRaises(Exception):b.capture(candidate)

    def test_capture_consumes_binding_even_when_process_fails(self):
        def reader():return prepare(fixture(),'2026-10-17',PROJECT,SECRET,ORIGIN,clock=time.time)
        b=PrivateCandidateBridge(reader,enabled=True,allow_capture=True,staging=True,api_key='synthetic')
        candidate=b.read_candidate()
        b.invoke=lambda *args:(_ for _ in ()).throw(OSError('private'))
        with self.assertRaises(Exception):b.capture(candidate)
        self.assertIsNone(b.prepared)
        with self.assertRaises(Exception):b.capture(candidate)
