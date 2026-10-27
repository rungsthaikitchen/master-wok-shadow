import json
import time
import unittest
from unittest.mock import patch
from event_staff_command_trial import configuration,arguments,command,CASES,http_trial
from contextlib import contextmanager
from event_capture_journal import EventCaptureError
from event_cutover_trial import FLAGS
from event_checkout_trial import EXTRA_FLAGS
class StaffTrialTests(unittest.TestCase):
 def env(self):
  e={k:'false' for k in (*FLAGS,*EXTRA_FLAGS,'MASTER_WOK_CHECKOUT_TRIAL_ENABLED','MASTER_WOK_FULL_CHECKOUT_TRIAL_ENABLED')}
  e.update(MASTER_WOK_STAFF_COMMAND_TRIAL_ENABLED='true',MASTER_WOK_STAFF_COMMAND_TRIAL_END_EPOCH='1600',RAILWAY_PROJECT_ID='7821ad5b-f5c2-4ab4-9206-c3d76eefd4c8',RAILWAY_ENVIRONMENT_ID='c1b8fad6-dbfc-4188-b4b5-a5dbfbf53279',RAILWAY_SERVICE_ID='012e5ef6-6225-4ab3-95f5-894583db7e83',MASTER_WOK_EVENT_RUNTIME_SCOPE='SYNTHETIC_STAGING_EVENTS')
  return e
 def test_default_off_before_reading_connection(self):
  with patch('event_staff_command_trial.connection_parameters',side_effect=AssertionError('read')):self.assertIsNone(configuration({}))
 def test_exact_scope_and_all_other_flags_off(self):
  e=self.env()
  with patch('event_staff_command_trial.connection_parameters',return_value={}):self.assertEqual(configuration(e,1000)[0],1600)
  for key,value in [('RAILWAY_ENVIRONMENT_ID','production'),('MASTER_WOK_FULL_CHECKOUT_TRIAL_ENABLED','true'),('MASTER_WOK_NEW_UNKNOWN_ENABLED','true')]:
   with self.subTest(key=key),self.assertRaises(EventCaptureError):configuration(dict(e,**{key:value}),1000)
 def test_deadline_bounded(self):
  for value in ['nan','inf','0','1000','1601','bad']:
   with self.subTest(value=value),self.assertRaises(EventCaptureError):configuration(dict(self.env(),MASTER_WOK_STAFF_COMMAND_TRIAL_END_EPOCH=value),1000)
 def test_only_fixed_fixture_and_command_fields(self):
  f=CASES[0];c=command(f);self.assertEqual(arguments(f,c)[0],f['route'])
  for change in [{'orderId':CASES[1]['order']},{'actorId':'a'*64},{'expectedRevision':True},{'action':'mark_paid'},{'target':'2026-10-28T21:00:00Z'},{'commandId':'not-uuid'}]:
   with self.subTest(change=change),self.assertRaises(EventCaptureError):arguments(f,dict(c,**change))
 def test_bundled_node_signed_loopback_and_lost_success_contract(self):
  ledger={}
  class Fake:
   class budget:
    @staticmethod
    def take(_):pass
   @contextmanager
   def writer(self):yield self
   def execute(self,sql,args):
    command_id=args[1];revision=3 if args[5]=='offer' else 4
    result=dict(status='ALREADY_RECORDED' if command_id in ledger else 'RECORDED',revision=revision);ledger[command_id]=result
    class Result:
     def fetchone(self):return [result]
    return Result()
   def state(self,_):return dict(eventCount=4,auditRows=2)
  result=http_trial(Fake(),CASES[-1],time.time()+60)
  self.assertEqual(result['httpRequests'],3);self.assertEqual(len(ledger),2)
if __name__=='__main__':unittest.main()
