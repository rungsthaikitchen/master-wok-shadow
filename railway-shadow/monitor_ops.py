"""Local SQLite health/backup utilities. No network or Supabase credentials."""
import argparse
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import sqlite3
from zoneinfo import ZoneInfo

LONDON = ZoneInfo('Europe/London')


def open_monitor(filename):
    path = Path(filename)
    if not path.is_absolute() or not path.is_file():
        raise ValueError('MONITOR_NOT_FOUND')
    db = sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True, timeout=5)
    db.execute('PRAGMA query_only=ON')
    if db.execute('PRAGMA user_version').fetchone()[0] not in (0, 2):
        db.close()
        raise ValueError('UNSUPPORTED_MONITOR_SCHEMA')
    return db


def health(db, now=None, days=None, max_age=180):
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None or not 30 <= max_age <= 86400:
        raise ValueError('INVALID_HEALTH_CONFIGURATION')
    today = now.astimezone(LONDON).date()
    days = days or [today.isoformat(), (today + timedelta(days=1)).isoformat()]
    if not 1 <= len(days) <= 7:
        raise ValueError('INVALID_HEALTH_CONFIGURATION')
    results = {}
    for day in days:
        datetime.strptime(day, '%Y-%m-%d')
        last = db.execute('SELECT observed_at,result,reason FROM polls WHERE service_date=? ORDER BY id DESC LIMIT 1', (day,)).fetchone()
        good = db.execute("SELECT observed_at FROM polls WHERE service_date=? AND result='OBSERVED' ORDER BY id DESC LIMIT 1", (day,)).fetchone()
        if not last:
            results[day] = {'healthy': False, 'reason': 'NO_SAMPLE', 'lastSuccessAgeSeconds': None}
            continue
        stamp = datetime.fromisoformat(last[0])
        if stamp.tzinfo is None:
            raise ValueError('INVALID_MONITOR_TIMESTAMP')
        age = (now - stamp).total_seconds()
        success_age = (now - datetime.fromisoformat(good[0])).total_seconds() if good else None
        reason = ('CLOCK_SKEW' if age < 0 else 'STALE_SAMPLE' if age > max_age
                  else 'SOURCE_OR_STORAGE_FAILURE' if last[1] != 'OBSERVED'
                  else 'REPLAY_UNAVAILABLE' if last[2] != 'POLLED_STATE_NOT_DECISION_HISTORY'
                  else 'HEALTHY')
        results[day] = {'healthy': reason == 'HEALTHY', 'reason': reason,
                        'lastAttemptAt': last[0], 'lastAttemptAgeSeconds': round(age, 3),
                        'lastSuccessAgeSeconds': round(success_age, 3) if success_age is not None else None}
    return {'state': 'HEALTHY' if all(r['healthy'] for r in results.values()) else 'UNHEALTHY',
            'checkedAt': now.isoformat(), 'maxAgeSeconds': max_age, 'serviceDays': results,
            'prediction': 'UNVERIFIED', 'verified': False}


def backup(db, destination):
    target = Path(destination)
    if not target.is_absolute() or not target.parent.is_dir():
        raise ValueError('INVALID_BACKUP_PATH')
    descriptor = os.open(target, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(descriptor)
    try:
        copy = sqlite3.connect(target)
        try:
            db.backup(copy)
            if copy.execute('PRAGMA integrity_check').fetchall() != [('ok',)]:
                raise ValueError('BACKUP_INTEGRITY_FAILED')
        finally:
            copy.close()
        with target.open('rb') as stream:
            os.fsync(stream.fileno())
        parent = os.open(target.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
    except Exception:
        target.unlink(missing_ok=True)
        raise
    return {'state': 'BACKUP_VERIFIED', 'bytes': target.stat().st_size}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['health', 'backup'])
    parser.add_argument('--db', default=os.environ.get('MASTER_WOK_MONITOR_DB', ''))
    parser.add_argument('--service-date', action='append')
    parser.add_argument('--max-age', type=int, default=180)
    parser.add_argument('--destination')
    args = parser.parse_args()
    db = open_monitor(args.db)
    try:
        result = health(db, days=args.service_date, max_age=args.max_age) if args.action == 'health' else backup(db, args.destination or '')
        print(json.dumps(result, sort_keys=True), flush=True)
        return int(result['state'] == 'UNHEALTHY')
    finally:
        db.close()


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception:
        # Never print SQL payloads, credentials or filesystem exception messages.
        print(json.dumps({'state': 'UNHEALTHY', 'reason': 'MONITOR_OPERATION_FAILED'}), flush=True)
        raise SystemExit(1)
