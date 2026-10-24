import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from event_capture_journal import EventCaptureError
import event_cutover_trial as trial

class CutoverTrialTests(unittest.TestCase):
 def env(self):
  env={key:'false' for key in trial.FLAGS}
  env.update(MASTER_WOK_CUTOVER_TRIAL_ENABLED='true',MASTER_WOK_CUTOVER_TRIAL_END_EPOCH='1500',RAILWAY_PROJECT_ID='7821ad5b-f5c2-4ab4-9206-c3d76eefd4c8',RAILWAY_ENVIRONMENT_ID='c1b8fad6-dbfc-4188-b4b5-a5dbfbf53279',RAILWAY_SERVICE_ID='012e5ef6-6225-4ab3-95f5-894583db7e83',MASTER_WOK_EVENT_RUNTIME_SCOPE='SYNTHETIC_STAGING_EVENTS')
  for role in ('READER','WRITER'):env['MASTER_WOK_EVENT_'+role+'_DSN']='postgresql://master_wok_event_'+role.lower()+'_login:unit-test-only@db.hvrqgufqjslvgiohgkvu.supabase.co/postgres'
  return env
 def test_disabled_never_constructs_database_client(self):
  output=io.StringIO()
  with patch.object(trial,'connection_parameters',side_effect=AssertionError('network configuration touched')),contextlib.redirect_stdout(output):trial.main({})
  self.assertEqual(json.loads(output.getvalue()),dict(status='DISABLED',sourceRequests=0,verified=False))
 def test_exact_staging_and_explicit_other_flags_required(self):
  env=self.env();self.assertEqual(trial.configuration(env,now=1000)[0],1500)
  for key in ('RAILWAY_PROJECT_ID','RAILWAY_ENVIRONMENT_ID','RAILWAY_SERVICE_ID','MASTER_WOK_EVENT_RUNTIME_SCOPE',*trial.FLAGS):
   with self.subTest(key=key):
    altered=dict(env);altered.pop(key)
    with self.assertRaisesRegex(EventCaptureError,'CUTOVER_TRIAL_SCOPE_REFUSED'):trial.configuration(altered,now=1000)
  env['MASTER_WOK_EVENT_RUNTIME_ENABLED']='true'
  with self.assertRaisesRegex(EventCaptureError,'CUTOVER_TRIAL_SCOPE_REFUSED'):trial.configuration(env,now=1000)
 def test_production_dsn_and_extended_deadlines_refused(self):
  env=self.env();env['MASTER_WOK_EVENT_WRITER_DSN']=env['MASTER_WOK_EVENT_WRITER_DSN'].replace('hvrqgufqjslvgiohgkvu','ubyjrrsvbbqomitpaidb')
  with self.assertRaisesRegex(EventCaptureError,'STAGING_DATABASE_CONNECTION_REQUIRED'):trial.configuration(env,now=1000)
  for value in ('1000','1601','nan','inf','invalid'):
   env=self.env();env['MASTER_WOK_CUTOVER_TRIAL_END_EPOCH']=value
   with self.subTest(value=value),self.assertRaisesRegex(EventCaptureError,'CUTOVER_TRIAL_DEADLINE_REFUSED'):trial.configuration(env,now=1000)
 def test_expired_fixtures_refused_before_dsn_configuration(self):
  expiry=trial.datetime.fromisoformat(trial.OFFER_AT).timestamp()
  for now in (expiry,expiry+86400):
   env=self.env();env['MASTER_WOK_CUTOVER_TRIAL_END_EPOCH']=str(now+300)
   with self.subTest(now=now),patch.object(trial,'connection_parameters',side_effect=AssertionError('credentials inspected')):
    with self.assertRaisesRegex(EventCaptureError,'CUTOVER_TRIAL_FIXTURES_EXPIRED'):trial.configuration(env,now=now)
 def test_refresh_preserves_old_fixture_history_and_matches_prepared_sql(self):
  sql=(Path(__file__).resolve().parent.parent/'staging-events/cutover-concurrency-fixtures-25-oct.sql').read_text()
  identities=[value for case in trial.CASES for value in case[1:4]]
  self.assertEqual(len(set(identities)),12)
  self.assertNotIn('a6b17a1d-2df6-42e4-8ebb-5ffc37a4ad36',identities)
  for case in trial.CASES:
   self.assertIn(case[1],sql);self.assertIn(case[2],sql);self.assertIn(case[3],sql)
  self.assertEqual(sql.count('SET enabled=false'),4)
  self.assertNotIn('DELETE ',sql);self.assertNotIn('ON CONFLICT',sql)
  self.assertIn(trial.FIXTURE_DAY,sql)
  self.assertNotEqual(str(trial.DIRECTORY),'/data/cutover-trial-21-oct')
 def test_offer_uses_refreshed_target_through_real_query_boundary(self):
  seen=[]
  class Conn:
   def execute(self,query,params):
    seen.append((query,params));return self
   def fetchone(self):return ('RECORDED',)
  class Budget:
   def take(self,kind):self.kind=kind
  budget=Budget();obj=trial.Trial(None,{},budget)
  self.assertEqual(obj.offer(Conn(),trial.CASES[0],'unit-offer'),'RECORDED')
  self.assertEqual(budget.kind,'write')
  self.assertEqual(seen,[(trial.APPLY,[trial.CASES[0][1],'unit-offer',trial.CASES[0][3],'offer',trial.OFFER_AT,None])])
 def test_budget_survives_restart_and_limits_failed_attempts(self):
  with tempfile.TemporaryDirectory() as directory:
   path=Path(directory)/'attempts.sqlite3';first=trial.Budget(path,2000,clock=lambda:1000);first.take('started');first.take('write')
   restarted=trial.Budget(path,2000,clock=lambda:1000)
   with self.assertRaisesRegex(EventCaptureError,'BUDGET_EXHAUSTED'):restarted.take('started')
   for _ in range(5):restarted.take('write')
   with self.assertRaisesRegex(EventCaptureError,'BUDGET_EXHAUSTED'):restarted.take('write')
   with self.assertRaisesRegex(EventCaptureError,'BUDGET_REFUSED'):restarted.take('seed')
   self.assertEqual(restarted.summary(),{'started':1,'write':6})
   expired=trial.Budget(path,2000,clock=lambda:2000)
   with self.assertRaisesRegex(EventCaptureError,'BUDGET_REFUSED'):expired.take('probe')
 def test_probe_rejects_arbitrary_sql_without_connecting(self):
  obj=trial.Trial(None,{},None)
  with self.assertRaisesRegex(EventCaptureError,'QUERY_REFUSED'):obj.probe('DELETE FROM public.orders',[])
 def test_symlink_budget_refused(self):
  with tempfile.TemporaryDirectory() as directory:
   path=Path(directory);(path/'actual').write_text('');(path/'link').symlink_to(path/'actual')
   with self.assertRaisesRegex(EventCaptureError,'PATH_REFUSED'):trial.Budget(path/'link',2000,clock=lambda:1000)

if __name__=='__main__':unittest.main()
