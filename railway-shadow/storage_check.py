"""One-shot synthetic engine/volume check. Never reads credentials or calls REST.
Uses storage-check.sqlite3 beside the configured monitor DB, never the monitor DB.
"""
from __future__ import annotations
import os
from pathlib import Path
from shadow_collector import MonitorStore, ShadowError, run_replay, canonical


def check():
    database = Path(os.environ.get('MASTER_WOK_MONITOR_DB', ''))
    mount = Path(os.environ.get('RAILWAY_VOLUME_MOUNT_PATH', ''))
    if not database.is_absolute() or not mount.is_absolute():
        raise ShadowError('PERSISTENT_VOLUME_CONFIGURATION_REQUIRED')
    if not database.resolve().is_relative_to(mount.resolve()) or database.resolve() == mount.resolve():
        raise ShadowError('DATABASE_OUTSIDE_VOLUME')
    result = run_replay('2026-10-14', [{
        'orderId': 'synthetic-storage-check', 'placedAt': '2026-10-13T12:00:00Z',
        'readyMinute': 1080, 'lines': [{'itemId': 'pad-thai', 'qty': 1, 'mods': []}]
    }])
    if len(result['observations']) != 1 or result['observations'][0]['status'] != 'GREEN':
        raise ShadowError('SYNTHETIC_ENGINE_CHECK_FAILED')
    filename = database.parent / 'storage-check.sqlite3'
    identity = 'master-wok-synthetic-storage-check-v1'
    store = MonitorStore(str(filename), identity)
    try:
        with store.db:
            previous = store.db.execute("SELECT value FROM metadata WHERE key='successfulRuns'").fetchone()
            count = int(previous[0]) if previous else 0
            store.db.execute("INSERT OR REPLACE INTO metadata VALUES('successfulRuns',?)", (str(count + 1),))
    finally:
        store.close()
    # Read back through a new connection, rather than relying on cached state.
    store = MonitorStore(str(filename), identity)
    try:
        actual = int(store.db.execute("SELECT value FROM metadata WHERE key='successfulRuns'").fetchone()[0])
        if actual != count + 1:
            raise ShadowError('PERSISTENT_READBACK_FAILED')
    finally:
        store.close()
    return {'state': 'STORAGE_CHECK_PASSED', 'previousSuccessfulRuns': count,
            'successfulRuns': actual, 'syntheticEngine': 'PASSED',
            'supabaseAccessed': False, 'collectorEnabled': False}


def main():
    try:
        print(canonical(check()), flush=True)
        return 0
    except Exception:
        print(canonical({'state': 'STORAGE_CHECK_FAILED', 'supabaseAccessed': False}), flush=True)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
