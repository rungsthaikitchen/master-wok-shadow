import contextlib
import io
import json
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch
from event_capture_journal import EventCaptureError
from event_runtime_http import serve_api
import event_command_route_trial as trial

class RouteTrialTests(unittest.TestCase):
 def env(self):
  env={k:'false' for k in (*trial.FLAGS,*trial.EXTRA_FLAGS)}
  env.update(MASTER_WOK_COMMAND_ROUTE_TRIAL_ENABLED='true',MASTER_WOK_COMMAND_ROUTE_TRIAL_END_EPOCH='1500',RAILWAY_PROJECT_ID='7821ad5b-f5c2-4ab4-9206-c3d76eefd4c8',RAILWAY_ENVIRONMENT_ID='c1b8fad6-dbfc-4188-b4b5-a5dbfbf53279',RAILWAY_SERVICE_ID='012e5ef6-6225-4ab3-95f5-894583db7e83',MASTER_WOK_EVENT_RUNTIME_SCOPE='SYNTHETIC_STAGING_EVENTS')
  for kind in ('READER','WRITER'):env['MASTER_WOK_EVENT_'+kind+'_DSN']='postgresql://master_wok_event_'+kind.lower()+'_login:synthetic@db.hvrqgufqjslvgiohgkvu.supabase.co/postgres'
  return env
 def test_disabled_never_constructs_connections_or_observer(self):
  with patch.object(trial,'connection_parameters',side_effect=AssertionError()),patch.object(trial,'RoutedObserver',side_effect=AssertionError()),contextlib.redirect_stdout(io.StringIO()) as out:trial.main({})
  self.assertEqual(json.loads(out.getvalue())['sourceRequests'],0)
 def test_scope_deadline_other_runners_and_production_dsn_refused(self):
  self.assertEqual(trial.configuration(self.env(),now=1000)[0],1500)
  for key in ('RAILWAY_ENVIRONMENT_ID','MASTER_WOK_CUTOVER_RESPONSE_HTTP_ENABLED','MASTER_WOK_EVENT_RUNTIME_SCOPE'):
   env=self.env();env.pop(key)
   with self.subTest(key=key),self.assertRaises(EventCaptureError):trial.configuration(env,now=1000)
  for value in ('1000','1601','nan','inf'):
   env=self.env();env['MASTER_WOK_COMMAND_ROUTE_TRIAL_END_EPOCH']=value
   with self.assertRaises(EventCaptureError):trial.configuration(env,now=1000)
  env=self.env();env['MASTER_WOK_EVENT_WRITER_DSN']=env['MASTER_WOK_EVENT_WRITER_DSN'].replace('hvrqgufqjslvgiohgkvu','ubyjrrsvbbqomitpaidb')
  with self.assertRaises(EventCaptureError):trial.configuration(env,now=1000)
 def test_budgets_persist_and_do_not_restart_the_trial(self):
  with tempfile.TemporaryDirectory() as tmp:
   path=Path(tmp)/'attempts.sqlite3';b=trial.Budget(path,2000,clock=lambda:1000);b.take('started')
   with self.assertRaises(EventCaptureError):trial.Budget(path,2000,clock=lambda:1000).take('started')
   for _ in range(16):b.take('write')
   with self.assertRaises(EventCaptureError):b.take('write')
   with self.assertRaises(EventCaptureError):trial.Budget(path,2000,clock=lambda:2000).take('read')
 def test_http_rehearsal_aborts_on_unexpected_response(self):
  seen=[]
  server,thread=serve_api(trial.CASES[0][1],'o'*32,'h'*32,lambda p:seen.append(p),lambda:False,cutover_response=lambda body:dict(status='WRONG'))
  try:
   with self.assertRaisesRegex(EventCaptureError,'COMMAND_ROUTE_HTTP_RESULT_REFUSED'):trial.exercise_http(server,'o'*32,b's'*32,lambda p:seen.append(p),trial.time.time()+30)
   self.assertEqual(seen,[])
  finally:server.shutdown();server.server_close();thread.join(timeout=2)
 def test_http_deadline_prevents_even_first_call(self):
  class Server:server_port=1
  with self.assertRaisesRegex(EventCaptureError,'COMMAND_ROUTE_DEADLINE_REFUSED'):trial.exercise_http(Server(),'o'*32,b's'*32,lambda _:None,0)

if __name__=='__main__':unittest.main()
