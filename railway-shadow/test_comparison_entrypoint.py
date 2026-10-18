import unittest
from unittest.mock import patch
import comparison_entrypoint as e

class EntrypointTests(unittest.TestCase):
    def test_disabled_drops_privileges_without_touching_volume(self):
        with patch.object(e.os,'geteuid',return_value=0),patch.object(e.os,'setgroups') as groups,patch.object(e.os,'setgid') as gid,patch.object(e.os,'setuid') as uid,patch.object(e.Path,'mkdir') as mkdir:
            e.prepare({});mkdir.assert_not_called();groups.assert_called_once_with([]);gid.assert_called_once_with(10001);uid.assert_called_once_with(10001)

    def test_enabled_prepares_only_dedicated_directory_before_dropping_root(self):
        env={'MASTER_WOK_COMPARISON_STAGING_ENABLED':'true','RAILWAY_ENVIRONMENT_NAME':'master-wok-staging',
             'MASTER_WOK_COMPARISON_JOURNAL':'/data/master-wok-comparison/delivery-comparison.sqlite3','MASTER_WOK_COMPARISON_HEALTH_TOKEN':'x'*32}
        with patch.object(e.os,'geteuid',return_value=0),patch.object(e.os,'setgroups'),patch.object(e.os,'setgid'),patch.object(e.os,'setuid'),patch.object(e.os,'chown') as chown,patch.object(e.os,'chmod'),patch.object(e.Path,'mkdir') as mkdir,patch.object(e.Path,'is_symlink',return_value=False):
            e.prepare(env);mkdir.assert_called_once_with(mode=0o700,exist_ok=True);chown.assert_called_once_with(e.DIRECTORY,10001,10001)
            with patch.object(e.Path,'is_symlink',return_value=True):
                with self.assertRaisesRegex(RuntimeError,'SYMLINK'):e.prepare(env)
            with self.assertRaisesRegex(RuntimeError,'DEDICATED'):e.prepare({**env,'MASTER_WOK_COMPARISON_JOURNAL':'/other/delivery-comparison.sqlite3'})
