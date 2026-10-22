"""Offline SDK and exact supplied backend tests. Never uses real credentials."""
import contextlib
import hashlib
import io
import os
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import Mock, patch
import httpx
from rtk_supabase_credentials import backend_key, create_backend_client, rest_headers

ROOT = Path(__file__).resolve().parent
SECRET = 'sb_secret_SYNTHETIC_REVIEW_ONLY'
LEGACY = 'eyJ_SYNTHETIC_REVIEW_ONLY'
URL = 'https://synthetic.invalid'


class CredentialTests(unittest.TestCase):
    def test_explicit_new_key_takes_precedence(self):
        self.assertEqual(backend_key(dict(SUPABASE_SECRET_KEY=SECRET, SUPABASE_SERVICE_ROLE_KEY=LEGACY)), SECRET)

    def test_invalid_explicit_key_never_silently_falls_back(self):
        for value in ['', ' '+SECRET, 'sb_publishable_example', LEGACY, SECRET+'\n', None]:
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, '^SUPABASE_SECRET_KEY_INVALID$'):
                backend_key(dict(SUPABASE_SECRET_KEY=value, SUPABASE_SERVICE_ROLE_KEY=LEGACY))

    def test_unconfigured_and_legacy_are_preserved(self):
        self.assertIsNone(backend_key({}))
        self.assertEqual(backend_key(dict(SUPABASE_SERVICE_ROLE_KEY=LEGACY)), LEGACY)
        self.assertEqual(rest_headers(LEGACY)['Authorization'], 'Bearer '+LEGACY)
        with patch('supabase.create_client', return_value='legacy-client') as factory:
            self.assertEqual(create_backend_client(URL, LEGACY), 'legacy-client')
        factory.assert_called_once_with(URL, LEGACY)

    def test_direct_http_new_key_is_apikey_only(self):
        self.assertEqual(rest_headers(SECRET), {'apikey': SECRET, 'Content-Type': 'application/json'})

    def make_client(self, seen):
        def receive(request):
            seen.append(request)
            self.assertEqual(request.url.host, 'synthetic.invalid')
            self.assertEqual(request.headers['apikey'], SECRET)
            self.assertNotIn('authorization', request.headers)
            return httpx.Response(200, json=[dict(id='synthetic-order')])
        client = create_backend_client(URL, SECRET, transport=httpx.MockTransport(receive))
        self.addCleanup(client.options.httpx_client.close)
        return client

    def test_real_sdk_select_insert_update_use_apikey_only(self):
        seen=[]; client=self.make_client(seen)
        self.assertEqual(client.table('orders').select('id').eq('id','synthetic-order').execute().data,
                         [dict(id='synthetic-order')])
        client.table('loyalty_accounts').insert(dict(id='synthetic-account')).execute()
        client.table('orders').update(dict(status='synthetic')).eq('id','synthetic-order').execute()
        self.assertEqual([r.method for r in seen], ['GET','POST','PATCH'])
        self.assertFalse(client.options.persist_session)
        self.assertFalse(client.options.auto_refresh_token)

    def test_sdk_transport_refuses_another_origin_before_sending(self):
        seen=[]; client=self.make_client(seen)
        with self.assertRaisesRegex(ValueError,'SUPABASE_REQUEST_ORIGIN_REFUSED'):
            client.options.httpx_client.get('https://other.invalid/rest/v1/orders')
        self.assertEqual(seen, [])

    def test_no_request_or_secret_appears_in_startup_output(self):
        seen=[]; output=io.StringIO()
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            self.make_client(seen)
        self.assertEqual(seen, [])
        self.assertNotIn(SECRET,output.getvalue())

    def test_unrelated_user_authorization_is_preserved(self):
        seen=[]
        def receive(request):
            seen.append(request)
            self.assertEqual(request.headers['authorization'], 'Bearer synthetic-user-jwt')
            return httpx.Response(200,json=[])
        client=create_backend_client(URL,SECRET,transport=httpx.MockTransport(receive))
        self.addCleanup(client.options.httpx_client.close)
        client.options.httpx_client.get(URL+'/rest/v1/orders',headers={'Authorization':'Bearer synthetic-user-jwt'})
        self.assertEqual(len(seen),1)

    @unittest.skipUnless(os.getenv('MASTER_WOK_REVIEW_SERVER_PATH'),'exact supplied backend required')
    def test_patch_applies_and_backend_uses_same_key_for_sdk_and_direct_rest(self):
        source=Path(os.environ['MASTER_WOK_REVIEW_SERVER_PATH'])
        self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(),
                         'ad15337033c5b4a91816e2c5875460dcff1364d43e6a9619be8aa8a1d6412d88')
        notifications=types.ModuleType('notifications')
        notifications.send_timing_notification=Mock(side_effect=AssertionError('notification refused'))
        requests=types.ModuleType('requests')
        requests.get=Mock(return_value=Mock(json=lambda:[dict(id='synthetic-order',proposed_time=None,status='proposed')]))
        requests.patch=Mock(return_value=Mock())
        with tempfile.TemporaryDirectory() as tmp:
            target=Path(tmp)/'server.py';target.write_bytes(source.read_bytes())
            result=subprocess.run(['patch','--batch','--silent',str(target),str(ROOT/'server-secret-key.py.patch')],capture_output=True,text=True,timeout=5)
            self.assertEqual(result.returncode,0,result.stderr)
            # This independent credential patch must also compose with the
            # earlier default-off staging route patch, without enabling it.
            composed=Path(tmp)/'composed.py';composed.write_bytes(target.read_bytes())
            result=subprocess.run(['patch','--batch','--silent',str(composed),str(ROOT/'server.py.patch')],capture_output=True,text=True,timeout=5)
            self.assertEqual(result.returncode,0,result.stderr)
            for mode in ['missing','legacy','new']:
                env={} if mode=='missing' else dict(SUPABASE_URL=URL,SUPABASE_SERVICE_ROLE_KEY=LEGACY)
                if mode=='new':env['SUPABASE_SECRET_KEY']=SECRET
                seen=[]
                def factory(url,key):
                    self.assertEqual(key, SECRET if mode=='new' else LEGACY)
                    return self.make_client(seen)
                with patch.dict(os.environ,env,clear=True), patch.dict(sys.modules,{'notifications':notifications,'requests':requests}), patch('rtk_supabase_credentials.create_backend_client',side_effect=factory) as create, contextlib.redirect_stdout(io.StringIO()) as output:
                    module=runpy.run_path(str(target),run_name='offline_secret_key_review')
                    self.assertEqual(module['app'].test_client().get('/').status_code,200)
                    if mode=='missing':
                        create.assert_not_called()
                    else:
                        create.assert_called_once()
                        module['find_order']('synthetic-order',None)
                        headers=requests.get.call_args.kwargs['headers']
                        self.assertEqual(headers,rest_headers(SECRET if mode=='new' else LEGACY))
                self.assertNotIn(SECRET,output.getvalue())
                self.assertNotIn(LEGACY,output.getvalue())
                self.assertEqual(seen,[])
        notifications.send_timing_notification.assert_not_called()


if __name__ == '__main__':
    unittest.main()
