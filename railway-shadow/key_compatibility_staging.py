"""One-shot, read-only staging credential check. Disabled unless explicitly enabled."""
import json
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend-patch'))
from rtk_supabase_credentials import backend_key, create_backend_client, rest_headers

URL = 'https://hvrqgufqjslvgiohgkvu.supabase.co'
MARKER = Path('/data/key-compatibility-23-oct-v1.started')
IDENTITY = {
    'RAILWAY_PROJECT_ID': '7821ad5b-f5c2-4ab4-9206-c3d76eefd4c8',
    'RAILWAY_ENVIRONMENT_ID': 'c1b8fad6-dbfc-4188-b4b5-a5dbfbf53279',
    'RAILWAY_SERVICE_ID': '012e5ef6-6225-4ab3-95f5-894583db7e83',
}
OTHER_FLAGS = (
    'MASTER_WOK_EVENT_RUNTIME_ENABLED', 'MASTER_WOK_EVENT_RUNTIME_TRIAL_ENABLED',
    'MASTER_WOK_EVENT_CLOUD_BACKUP_ENABLED', 'MASTER_WOK_EVENT_SOAK_ENABLED',
    'MASTER_WOK_SIGNED_HTTP_TRIAL_ENABLED', 'MASTER_WOK_BOOKING_HTTP_TRIAL_ENABLED',
    'MASTER_WOK_TERMINAL_HTTP_TRIAL_ENABLED', 'MASTER_WOK_DELIVERY_HTTP_TRIAL_ENABLED',
    'MASTER_WOK_CONTINUOUS_STAGING_ENABLED', 'MASTER_WOK_PREPARED_STAGING_ENABLED',
    'MASTER_WOK_TRANSFER_TRIAL_ENABLED', 'MASTER_WOK_TRANSFER_MONITOR_ENABLED',
    'MASTER_WOK_TRANSFER_MONITOR_RECOVERY_ENABLED', 'MASTER_WOK_CUTOVER_TRIAL_ENABLED',
)


def check(env, *, marker=MARKER, sdk_factory=create_backend_client, http_get=None):
    if env.get('MASTER_WOK_KEY_COMPATIBILITY_ENABLED') != 'true':
        return dict(status='DISABLED', requests=0)
    if any(env.get(k) != v for k, v in IDENTITY.items()):
        raise ValueError('STAGING_IDENTITY_REFUSED')
    if any(env.get(k, 'false') != 'false' for k in OTHER_FLAGS):
        raise ValueError('OTHER_TRIAL_ENABLED')
    # No fallback to the production or old service-role variable.
    key = backend_key({'SUPABASE_SECRET_KEY': env.get('MASTER_WOK_STAGING_SECRET_KEY')})
    if marker.parent.is_symlink() or not marker.parent.is_dir():
        raise ValueError('PERSISTENT_DIRECTORY_REQUIRED')
    try:
        fd = os.open(marker, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        return dict(status='ALREADY_ATTEMPTED', requests=0)
    with os.fdopen(fd, 'w') as handle:
        handle.write('staging-key-compatibility-v1\n')
        handle.flush()
        os.fsync(handle.fileno())

    # A durable attempt marker prevents a restart/redeploy from repeating calls,
    # even when one call fails. No customer rows are requested or printed.
    client = sdk_factory(URL, key)
    try:
        client.options.httpx_client.timeout = 5
        data = client.table('orders').select('id').limit(0).execute().data
        if data != []:
            raise ValueError('SDK_EMPTY_RESULT_REQUIRED')
    finally:
        client.options.httpx_client.close()

    if http_get is None:
        import requests
        http_get = requests.get
    response = http_get(URL + '/rest/v1/orders',
                        params={'select': 'id', 'limit': '0'},
                        headers=rest_headers(key), timeout=5, allow_redirects=False)
    try:
        if response.status_code != 200 or response.json() != []:
            raise ValueError('REST_EMPTY_RESULT_REQUIRED')
    finally:
        response.close()
    return dict(status='PASSED', requests=2, source='STAGING_ONLY',
                customerRows=0, writes=0, notifications=0,
                bookingLifecycleVerified=False)


def main():
    try:
        result = check(os.environ)
    except Exception:
        # Never include exception text, headers, connection details or secrets.
        print(json.dumps(dict(status='FAILED', reason='CHECK_DID_NOT_COMPLETE',
                              retryAutomatically=False)), flush=True)
        return 1
    result['buildSha'] = os.environ.get('RAILWAY_GIT_COMMIT_SHA', 'UNAVAILABLE')
    print(json.dumps(result, sort_keys=True), flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
