import contextlib
import importlib.util
import io
from pathlib import Path
import unittest
from unittest.mock import Mock

spec = importlib.util.spec_from_file_location("probe", Path(__file__).with_name("email-staff-provider-probe.py"))
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class ProbeTest(unittest.TestCase):
    def setUp(self):
        self.env = {"MASTER_WOK_CHANNEL_PROBE_ENABLED": "true",
                    "SUPABASE_URL": "https://hvrqgufqjslvgiohgkvu.supabase.co",
                    "MASTER_WOK_CHANNEL_PROBE_EMAIL": probe.EMAIL,
                    "BREVO_API_KEY": "fixture", "PUSHOVER_APP_TOKEN": "fixture", "PUSHOVER_USER_KEY": "fixture"}

    def test_guards_prevent_all_provider_calls(self):
        for key, value in [("MASTER_WOK_CHANNEL_PROBE_ENABLED", "false"),
                           ("SUPABASE_URL", "https://production.invalid"),
                           ("MASTER_WOK_CHANNEL_PROBE_EMAIL", "other@example.invalid"),
                           ("BREVO_API_KEY", ""), ("PUSHOVER_APP_TOKEN", ""), ("PUSHOVER_USER_KEY", "")]:
            factory = Mock()
            with self.assertRaises(ValueError):
                probe.run_probe({**self.env, key: value}, factory)
            factory.assert_not_called()

    def test_exactly_the_two_approved_channels_without_retry_or_sms(self):
        factory = Mock()
        factory.return_value.send.return_value = {"outcome": "uncertain", "providerId": "private-fixture-id"}
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            probe.run_probe(self.env, factory)
        factory.assert_called_once()
        messages = [call.args[0] for call in factory.return_value.send.call_args_list]
        self.assertEqual([message["channel"] for message in messages], ["email", "pushover"])
        self.assertEqual(messages[0]["recipient"], probe.EMAIL)
        self.assertIn("no order booked", messages[0]["subject"])
        self.assertEqual(messages[1]["title"], "RTK STAGING TEST")
        self.assertNotIn("private-fixture-id", output.getvalue())
        self.assertNotIn(probe.EMAIL, output.getvalue())


if __name__ == "__main__":
    unittest.main()
