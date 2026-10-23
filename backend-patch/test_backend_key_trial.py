import ast
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import httpx

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'railway-shadow'))
import backend_key_trial_staging as trial
from rtk_supabase_credentials import create_backend_client


class FakePostgrest:
    """Stateful HTTP test double; SQL constraints are checked separately in staging."""
    def __init__(self):
        self.rows={name:[] for name in trial.TABLES.values()}
        self.fail_patch=False
    def handle(self,request):
        table=request.url.path.rsplit('/',1)[-1]
        if request.method=='PATCH' and self.fail_patch:
            self.fail_patch=False
            return httpx.Response(503,json={'message':'synthetic failure'})
        rows=self.rows[table]
        def matches(row):
            for key,value in request.url.params.multi_items():
                if key not in ('select','limit','order') and str(row.get(key))!=value.removeprefix('eq.'):
                    return False
            return True
        matched=[row for row in rows if matches(row)]
        body=json.loads(request.content) if request.content else None
        if request.method=='POST':
            body=dict(body)
            body.setdefault('id','44444444-4444-4444-8444-444444444423')
            body.setdefault('loyalty_settled',False)
            rows.append(body);matched=[body]
        elif request.method=='PATCH':
            for row in matched:row.update(body)
        elif request.method=='DELETE':
            self.rows[table]=[row for row in rows if not matches(row)]
        if 'limit' in request.url.params:matched=matched[:int(request.url.params['limit'])]
        return httpx.Response(200,json=matched)


class BackendKeyTrialTests(unittest.TestCase):
    def client(self,db):
        guard=trial.transport(httpx.MockTransport(db.handle))
        client=create_backend_client(trial.URL,'sb_secret_SYNTHETIC_ONLY',transport=guard)
        self.addCleanup(client.options.httpx_client.close)
        return client,guard

    def test_actual_sdk_and_extracted_handlers_complete_then_cleanup(self):
        db=FakePostgrest();client,guard=self.client(db)
        with contextlib.redirect_stdout(io.StringIO()):result=trial.exercise(client,'sb_secret_SYNTHETIC_ONLY',guard)
        self.assertEqual(result['status'],'PASSED')
        self.assertEqual(result['fixtureRowsRemaining'],0)
        self.assertGreater(result['fixtureWrites'],0)
        self.assertLessEqual(result['requests'],64)
        self.assertEqual(result['edgeBoundary'],'LOCAL_STUB')
        self.assertTrue(all(not rows for rows in db.rows.values()))

    def test_legacy_false_success_is_caught_by_persisted_state_check(self):
        db=FakePostgrest();db.fail_patch=True;client,guard=self.client(db)
        with contextlib.redirect_stdout(io.StringIO()),self.assertRaises(ValueError):
            trial.exercise(client,'sb_secret_SYNTHETIC_ONLY',guard)
        self.assertTrue(all(not rows for rows in db.rows.values()))

    def test_preexisting_fixture_refuses_without_deleting_it(self):
        db=FakePostgrest();db.rows[trial.TABLES['orders']].append(dict(id=trial.ORDER))
        client,guard=self.client(db)
        with self.assertRaises(ValueError):trial.exercise(client,'sb_secret_SYNTHETIC_ONLY',guard)
        self.assertEqual(guard.writes,0)
        self.assertEqual(len(db.rows[trial.TABLES['orders']]),1)

    def test_transport_refuses_production_real_tables_rpc_and_budget_overrun(self):
        calls=[]
        guard=trial.transport(httpx.MockTransport(lambda r:calls.append(r) or httpx.Response(200,json=[])))
        self.addCleanup(guard.close)
        for method,url,headers in [
            ('GET','https://ubyjrrsvbbqomitpaidb.supabase.co/rest/v1/master_wok_credential_orders',{}),
            ('GET',trial.URL+'/rest/v1/orders',{}),
            ('POST',trial.URL+'/rest/v1/rpc/anything',{}),
            ('GET',trial.URL+'/rest/v1/'+trial.TABLES['orders'],{'Authorization':'Bearer secret'})]:
            with self.assertRaises(ValueError):guard.handle_request(httpx.Request(method,url,headers=headers))
        self.assertEqual(calls,[])
        guard.calls=64
        with self.assertRaises(ValueError):guard.handle_request(httpx.Request('GET',trial.URL+'/rest/v1/'+trial.TABLES['orders']))
        self.assertEqual(calls,[])

    def test_disabled_scope_and_existing_marker_make_no_requests(self):
        with patch.dict(os.environ,{},clear=True),patch.object(trial,'transport') as network,contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(trial.main(),0)
        network.assert_not_called();self.assertEqual(json.loads(output.getvalue())['status'],'DISABLED')
        env=dict(trial.IDENTITY,MASTER_WOK_BACKEND_KEY_TRIAL_ENABLED='true',MASTER_WOK_STAGING_SECRET_KEY='sb_secret_SYNTHETIC_ONLY')
        for bad in [dict(RAILWAY_ENVIRONMENT_ID='production'),dict(MASTER_WOK_KEY_COMPATIBILITY_ENABLED='true'),dict(MASTER_WOK_STAGING_SECRET_KEY='eyJold')]:
            with self.assertRaises(ValueError):trial.configuration(dict(env,**bad))
        with tempfile.TemporaryDirectory() as tmp:
            marker=Path(tmp)/'started';marker.touch()
            with patch.dict(os.environ,env,clear=True),patch.object(trial,'MARKER',marker),patch.object(trial,'transport') as network,contextlib.redirect_stdout(io.StringIO()) as output:
                self.assertEqual(trial.main(),0)
            network.assert_not_called();self.assertEqual(json.loads(output.getvalue())['status'],'ALREADY_ATTEMPTED')

    @unittest.skipUnless(os.getenv('MASTER_WOK_REVIEW_SERVER_PATH'),'deployment archive required')
    def test_extracts_match_exact_source_including_decorators(self):
        source=Path(os.environ['MASTER_WOK_REVIEW_SERVER_PATH']).read_text()
        manifest=json.loads(trial.FIXTURE.with_suffix('.manifest.json').read_text())
        self.assertEqual(hashlib.sha256(source.encode()).hexdigest(),manifest['sourceSha256'])
        fixture=trial.FIXTURE.read_text()
        def functions(text):
            lines=text.splitlines(True);found={}
            for node in ast.parse(text).body:
                if isinstance(node,ast.FunctionDef) and node.name in manifest['functions']:
                    start=min([node.lineno]+[d.lineno for d in node.decorator_list])-1
                    found[node.name]=''.join(lines[start:node.end_lineno])
            return found
        actual,extracted=functions(source),functions(fixture)
        self.assertEqual(actual,extracted)
        self.assertEqual(set(actual),set(manifest['functions']))
        for name,segment in extracted.items():self.assertEqual(hashlib.sha256(segment.encode()).hexdigest(),manifest['functions'][name])


if __name__=='__main__':unittest.main()
