from pathlib import Path
import tempfile
import unittest
import continuous_comparison_staging as worker
from test_retrospective_recovery import DiskObjectStore
from test_retrospective_recovery_once import environment

def config():
    env=environment()
    env.update(MASTER_WOK_CONTINUOUS_STAGING_ENABLED='true',
        RAILWAY_SERVICE_NAME='master-wok-continuous-comparison-staging',
        MASTER_WOK_CONTINUOUS_SCOPE='FIXED_SYNTHETIC_CAPTURE_ONLY',
        MASTER_WOK_CONTINUOUS_REQUEST_LIMIT='2',MASTER_WOK_CONTINUOUS_HEALTH_TOKEN='s'*32,PORT='0')
    return env

class Cycles:
    def __init__(self,count):self.count=count
    def is_set(self):return self.count<=0
    def wait(self,seconds):self.count-=1

class ContinuousTests(unittest.TestCase):
    def test_disabled_actual_entrypoint_needs_no_privilege_changes(self):
        import subprocess,json
        from unittest.mock import patch
        with patch.object(worker.os,'geteuid',side_effect=AssertionError('disabled privilege lookup')):
            worker.bootstrap({})
        result=subprocess.run(['python',str(Path(worker.__file__))],env={'PATH':__import__('os').environ['PATH']},
            capture_output=True,text=True,timeout=10)
        self.assertEqual(result.returncode,0)
        self.assertEqual(json.loads(result.stdout)['status'],'DISABLED')

    def test_disabled_and_source_secrets_refused(self):
        events=[];worker.run({},emit=events.append)
        self.assertEqual(events[0]['status'],'DISABLED')
        for change in [dict(RAILWAY_ENVIRONMENT_ID='production'),dict(MASTER_WOK_STAGING_GOOGLE_ROUTES_KEY='private')]:
            env=config();env.update(change)
            with self.assertRaises(Exception):worker.configuration(env)

    def test_daemon_cycles_restart_auth_health_and_bounded_uploads(self):
        from urllib.request import Request,build_opener,ProxyHandler
        from urllib.error import HTTPError
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);store=DiskObjectStore(root/'objects');events=[];servers=[]
            opener=build_opener(ProxyHandler({}))
            def ready(server):servers.append(server)
            def emit(event):
                events.append(event)
                url='http://127.0.0.1:'+str(servers[-1].server_address[1])+'/healthz'
                with opener.open(Request(url,headers={'Authorization':'Bearer '+'s'*32}),timeout=2) as response:
                    self.assertEqual(response.status,200)
                with self.assertRaises(HTTPError) as raised:opener.open(url,timeout=2)
                self.assertEqual(raised.exception.code,401);raised.exception.close()
            args=dict(directory=root/'volume',client_factory=lambda _:store,ready=ready,emit=emit)
            worker.run(config(),stop=Cycles(3),**args)
            self.assertEqual(events[0]['reasonCode'],'CONDITIONAL_AGGREGATE_RECORDED')
            self.assertEqual(events[1]['reasonCode'],'ALREADY_RECORDED')
            self.assertEqual(len(list(store.root.rglob('*.sqlite3'))),1)
            worker.run(config(),stop=Cycles(2),**args)
            self.assertEqual(events[3]['reasonCode'],'ALREADY_RECORDED')
            self.assertEqual(len(list(store.root.rglob('*.sqlite3'))),2)
            self.assertTrue(all(e['googleRequests']==0 for e in events))
            # Third startup cannot exceed the durable two-attempt cloud budget.
            events=[]
            worker.run(config(),stop=Cycles(1),directory=root/'volume',client_factory=lambda _:store,emit=events.append)
            self.assertEqual(events[0]['status'],'UNVERIFIED')
            self.assertEqual(len(list(store.root.rglob('*.sqlite3'))),2)

    def test_corrupt_cloud_readback_never_reports_success(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);store=DiskObjectStore(root/'objects');store.corrupt=True;events=[]
            worker.run(config(),stop=Cycles(1),directory=root/'volume',client_factory=lambda _:store,emit=events.append)
            self.assertEqual(events[0]['status'],'UNVERIFIED')
