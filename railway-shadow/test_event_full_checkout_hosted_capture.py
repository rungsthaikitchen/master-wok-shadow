"""Independent replay of the actual synthetic hosted export, never live orders."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import event_full_checkout_trial as trial

class HostedFullCaptureTests(unittest.TestCase):
 def packets(self):return json.loads((trial.ROOT/'fixtures/checkout-full-hosted-capture-27-oct.json').read_text())
 def test_hosted_complete_exports_are_private_free_and_have_no_actual_decisions(self):
  packets=self.packets();self.assertEqual(set(packets),{f['name'] for f in trial.CASES})
  self.assertEqual(sum(x['eventCount'] for x in packets.values()),6)
  for f in trial.CASES:
   packet=packets[f['name']];self.assertEqual(packet['eventCount'],2 if f['name']=='http' else 1)
   self.assertEqual(len(packet['batch']['events']),packet['eventCount']);trial.verify_packet(f,packet)
 def test_actual_hosted_http_export_replays_and_recovers_without_a_booking_decision(self):
  with tempfile.TemporaryDirectory() as tmp,patch.object(trial,'DIRECTORY',Path(tmp)):
   self.assertEqual(trial.replay_packet(self.packets()['http']),dict(events=2,actualDecisions=0,recoveryVerified=True))
if __name__=='__main__':unittest.main()
