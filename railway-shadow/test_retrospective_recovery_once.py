from pathlib import Path
import tempfile
import unittest
from retrospective_recovery_once import run,configuration
from test_retrospective_recovery import DiskObjectStore

def environment():
    return dict(MASTER_WOK_RETROSPECTIVE_RECOVERY_ENABLED='true',
        RAILWAY_PROJECT_ID='7821ad5b-f5c2-4ab4-9206-c3d76eefd4c8',
        RAILWAY_ENVIRONMENT_ID='c1b8fad6-dbfc-4188-b4b5-a5dbfbf53279',
        RAILWAY_ENVIRONMENT_NAME='master-wok-staging',
        RAILWAY_SERVICE_NAME='master-wok-retrospective-recovery',
        RAILWAY_VOLUME_MOUNT_PATH='/data',MASTER_WOK_RETROSPECTIVE_RECOVERY_SCOPE='SYNTHETIC_AGGREGATES_ONLY',
        MASTER_WOK_BACKUP_ENDPOINT='https://t3.storageapi.dev',MASTER_WOK_BACKUP_BUCKET='offline-fixture',
        MASTER_WOK_BACKUP_REGION='auto',MASTER_WOK_BACKUP_ACCESS_KEY_ID='synthetic',
        MASTER_WOK_BACKUP_SECRET_ACCESS_KEY='synthetic')

class OnceTests(unittest.TestCase):
    def test_disabled_no_config_or_files(self):
        with tempfile.TemporaryDirectory() as folder:
            p=Path(folder)/'unused'
            self.assertEqual(run({},directory=p)['status'],'DISABLED')
            self.assertFalse(p.exists())

    def test_two_invocations_retain_events_and_verify_backups(self):
        with tempfile.TemporaryDirectory() as folder:
            p=Path(folder);store=DiskObjectStore(p/'objects')
            args=dict(directory=p/'volume',client_factory=lambda _:store,clock=lambda:1792341472)
            first=run(environment(),**args);second=run(environment(),**args)
            self.assertEqual(first['beforeEvents'],0);self.assertEqual(first['afterEvents'],1)
            self.assertEqual(second['beforeEvents'],1);self.assertEqual(second['afterEvents'],2)
            self.assertTrue(second['priorVolumeDataPresent']);self.assertEqual(second['googleRequests'],0)
            self.assertEqual(second['status'],'RECOVERY_REHEARSAL_PASSED')

    def test_wrong_environment_and_corrupt_backup_fail_closed(self):
        env=environment();env['RAILWAY_ENVIRONMENT_ID']='production'
        with self.assertRaises(Exception):configuration(env)
        with tempfile.TemporaryDirectory() as folder:
            p=Path(folder);store=DiskObjectStore(p/'objects');store.corrupt=True
            with self.assertRaises(Exception):run(environment(),directory=p/'volume',client_factory=lambda _:store)
