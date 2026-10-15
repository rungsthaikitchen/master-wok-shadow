"""Independent GET-only Supabase state sampler. Disabled unless explicitly enabled.
No imports of server.py/notifications.py, no booking or notification code.
"""
from __future__ import annotations
import argparse
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import time
import uuid
from datetime import date, datetime, timedelta, timezone
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler
from zoneinfo import ZoneInfo

LONDON = ZoneInfo('Europe/London')
STATUSES = {'pending', 'confirmed', 'accepted', 'proposed', 'customer_accepted_time',
            'customer_declined_time', 'preparing', 'completed', 'cancelled'}
ORDER_FIELDS = 'id,created_at,preferred_time,proposed_time,confirmed_time,status,is_test'
ITEM_FIELDS = 'id,order_id,item_id,qty,modifiers'
STARTUP_PHASE = 'ARGUMENTS'
SAFE_STARTUP_REASONS = {
    'PSEUDONYM_KEY_REQUIRED', 'INVALID_SUPABASE_ORIGIN', 'INVALID_SOURCE_CONFIG',
    'ABSOLUTE_PERSISTENT_DB_PATH_REQUIRED', 'MONITOR_IDENTITY_CHANGED',
    'INVALID_POLL_INTERVAL', 'SERVICE_DATE_LIMIT', 'INVALID_SERVICE_DATE',
    'UNSUPPORTED_MONITOR_SCHEMA', 'LEGACY_BUILD_REQUIRED', 'MONITOR_CHANGED_DURING_UPGRADE'
}

class ShadowError(Exception):
    pass

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ShadowError('REDIRECT_REFUSED')

def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)

def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()

def day_bounds(service_date):
    day = date.fromisoformat(service_date)
    if day.isoformat() != service_date:
        raise ShadowError('INVALID_SERVICE_DATE')
    start = datetime.combine(day, datetime.min.time(), LONDON)
    end = datetime.combine(day + timedelta(days=1), datetime.min.time(), LONDON)
    return start.astimezone(timezone.utc).isoformat(), end.astimezone(timezone.utc).isoformat()

def timestamp(value):
    if not isinstance(value, str):
        raise ShadowError('INVALID_TIMESTAMP')
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if result.tzinfo is None:
        raise ShadowError('TIMESTAMP_OFFSET_REQUIRED')
    return result.astimezone(timezone.utc)

class ReadOnlySource:
    """Projection and endpoints are fixed. There is deliberately no write method."""
    def __init__(self, url, key, transport=None, page_size=250, max_rows=5000):
        parsed = urlsplit(url)
        if (parsed.scheme != 'https' or not parsed.hostname or
            not re.fullmatch(r'[a-z0-9-]+\.supabase\.co', parsed.hostname) or
            parsed.username or parsed.password or parsed.port not in (None, 443) or
            parsed.path not in ('', '/') or parsed.query or parsed.fragment):
            raise ShadowError('INVALID_SUPABASE_ORIGIN')
        if not key or not 1 <= page_size <= 500 or max_rows < page_size:
            raise ShadowError('INVALID_SOURCE_CONFIG')
        self.url, self.key = url.rstrip('/'), key
        self.transport = transport or self._get
        self.page_size, self.max_rows = page_size, max_rows

    def _get(self, url, headers):
        # Fixed GET; never follow a redirect with the authentication headers.
        request = Request(url, headers=headers, method='GET')
        with build_opener(NoRedirect).open(request, timeout=10) as response:
            if response.status != 200:
                raise ShadowError('SOURCE_HTTP_ERROR')
            body = response.read(5_000_001)
            if len(body) > 5_000_000:
                raise ShadowError('SOURCE_RESPONSE_TOO_LARGE')
            return json.loads(body), response.headers.get('Content-Range', '')

    def _pages(self, table, params):
        if table not in ('orders', 'order_items'):
            raise ShadowError('SOURCE_TABLE_REFUSED')
        data, seen, expected = [], set(), None
        while True:
            query = {**params, 'order': 'id.asc', 'offset': len(data), 'limit': self.page_size}
            url = self.url + '/rest/v1/' + table + '?' + urlencode(query)
            rows, count_range = self.transport(url, {'apikey': self.key,
                'Authorization': 'Bearer ' + self.key, 'Prefer': 'count=exact'})
            match = re.fullmatch(r'(?:\d+-\d+|\*)/(\d+)', count_range)
            if not match or not isinstance(rows, list):
                raise ShadowError('COUNT_UNAVAILABLE')
            count = int(match[1])
            if expected is None:
                expected = count
            if count != expected or count > self.max_rows:
                raise ShadowError('SOURCE_COUNT_CHANGED_OR_LIMIT')
            for row in rows:
                if not isinstance(row, dict) or not isinstance(row.get('id'), str) or not row['id'] or row['id'] in seen:
                    raise ShadowError('DUPLICATE_OR_MISSING_SOURCE_ID')
                seen.add(row['id'])
                data.append(row)
            if len(data) == expected:
                return data
            if not rows or len(data) > expected:
                raise ShadowError('SOURCE_PAGE_INCOMPLETE')

    def snapshot(self, service_date):
        start, end = day_bounds(service_date)
        # Include original, proposed or confirmed day, so a move away from this
        # day remains observable where at least one timestamp still refers to it.
        terms = [f'and({field}.gte.{start},{field}.lt.{end})'
                 for field in ('preferred_time', 'proposed_time', 'confirmed_time')]
        orders = self._pages('orders', {'select': ORDER_FIELDS, 'is_test': 'eq.false',
                                      'or': '(' + ','.join(terms) + ')'})
        items = []
        ids = [row['id'] for row in orders]
        if any(not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', value) for value in ids):
            raise ShadowError('INVALID_SOURCE_ID')
        for offset in range(0, len(ids), 50):
            items += self._pages('order_items', {'select': ITEM_FIELDS,
                'order_id': 'in.(' + ','.join(ids[offset:offset+50]) + ')'})
        return {'orders': orders, 'items': items}

class ManagementReadOnlySource:
    """Optional beta Management API read-only endpoint. Never the write-query API.
    A project-scoped database-read-only PAT is required; no database DDL.
    """
    def __init__(self, url, token, transport=None, max_rows=5000):
        # Reuse strict project origin validation; never accept a supplied API host.
        validated = ReadOnlySource(url, token)
        self.url = validated.url
        self.token, self.transport, self.max_rows = token, transport or self._query, max_rows
        ref = urlsplit(self.url).hostname.split('.')[0]
        self.endpoint = 'https://api.supabase.com/v1/projects/' + ref + '/database/query/read-only'

    def _query(self, payload):
        request = Request(self.endpoint, data=canonical(payload).encode(), method='POST',
            headers={'Authorization': 'Bearer ' + self.token, 'Content-Type': 'application/json'})
        with build_opener(NoRedirect).open(request, timeout=15) as response:
            if response.status not in (200, 201):
                raise ShadowError('SOURCE_HTTP_ERROR')
            body = response.read(5_000_001)
            if len(body) > 5_000_000:
                raise ShadowError('SOURCE_RESPONSE_TOO_LARGE')
            return json.loads(body)

    def snapshot(self, service_date):
        start, end = day_bounds(service_date)
        # Bounded, fixed SELECT projection; all values go through API parameters.
        # One aggregate result row avoids API result-row truncation of baskets.
        query = """WITH selected_orders AS (
          SELECT id,created_at,preferred_time,proposed_time,confirmed_time,status,is_test
          FROM public.orders WHERE is_test=false AND (
            (preferred_time >= $1::timestamptz AND preferred_time < $2::timestamptz) OR
            (proposed_time >= $1::timestamptz AND proposed_time < $2::timestamptz) OR
            (confirmed_time >= $1::timestamptz AND confirmed_time < $2::timestamptz))
          ORDER BY id LIMIT $3
        ), selected_items AS (
          SELECT i.id,i.order_id,i.item_id,i.qty,i.modifiers FROM public.order_items i
          JOIN selected_orders o ON o.id=i.order_id ORDER BY i.id LIMIT $3
        ) SELECT current_user AS source_role,
          (SELECT coalesce(pg_catalog.jsonb_agg(o ORDER BY o.id),'[]'::jsonb) FROM selected_orders o) AS orders,
          (SELECT coalesce(pg_catalog.jsonb_agg(i ORDER BY i.id),'[]'::jsonb) FROM selected_items i) AS items"""
        result = self.transport({'query': query, 'parameters': [start, end, self.max_rows + 1]})
        if (not isinstance(result, list) or len(result) != 1 or
            result[0].get('source_role') != 'supabase_read_only_user'):
            raise ShadowError('SOURCE_READ_ONLY_ROLE_UNPROVEN')
        data = {name: result[0].get(name) for name in ('orders', 'items')}
        for rows in data.values():
            if not isinstance(rows, list) or len(rows) > self.max_rows:
                raise ShadowError('SOURCE_COUNT_CHANGED_OR_LIMIT')
            seen = set()
            for row in rows:
                if not isinstance(row, dict) or not isinstance(row.get('id'), str) or row['id'] in seen:
                    raise ShadowError('DUPLICATE_OR_MISSING_SOURCE_ID')
                seen.add(row['id'])
        return data


def normalize(snapshot, secret):
    if not isinstance(secret, str) or len(secret) < 32:
        raise ShadowError('PSEUDONYM_KEY_REQUIRED')
    orders = snapshot['orders']
    by_order = {order['id']: [] for order in orders}
    for item in snapshot['items']:
        if item['order_id'] not in by_order:
            raise ShadowError('ORPHAN_ITEM')
        item_id, qty, mods = item.get('item_id'), item.get('qty'), item.get('modifiers')
        if (not isinstance(item_id, str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}', item_id) or
            isinstance(qty, bool) or not isinstance(qty, int) or not 1 <= qty <= 100 or
            (mods is not None and (not isinstance(mods, list) or len(mods) > 30))):
            raise ShadowError('INVALID_ORDER_LINE')
        safe_mods = []
        for mod in mods or []:
            if not isinstance(mod, dict) or not isinstance(mod.get('id'), str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}', mod['id']):
                raise ShadowError('INVALID_MODIFIER')
            safe_mods.append({'id': mod['id']})
        by_order[item['order_id']].append({'itemId': item_id, 'qty': qty,
                                          'mods': sorted(safe_mods, key=canonical)})
    normalized = []
    for order in orders:
        if order.get('is_test') is not False:
            raise ShadowError('TEST_FILTER_UNPROVEN')
        row = {'orderId': hmac.new(secret.encode(), order['id'].encode(), hashlib.sha256).hexdigest(),
               'status': order.get('status') if order.get('status') in STATUSES else 'UNKNOWN',
               'createdAt': timestamp(order['created_at']).isoformat(),
               'lines': sorted(by_order[order['id']], key=canonical)}
        for name in ('preferred_time', 'proposed_time', 'confirmed_time'):
            row[name] = timestamp(order[name]).isoformat() if order.get(name) else None
        if len(row['lines']) > 100:
            raise ShadowError('ORDER_LINE_LIMIT')
        normalized.append(row)
    return sorted(normalized, key=lambda row: row['orderId'])

def effective_time(row):
    if row['status'] in ('cancelled', 'customer_declined_time'):
        return None
    if row['confirmed_time']:
        return row['confirmed_time']
    if row['status'] in ('cancelled', 'customer_declined_time') or (row['status'] == 'pending' and row['proposed_time']):
        return None
    return row['proposed_time'] or row['preferred_time']

def replay_rows(service_date, rows):
    result = []
    for row in rows:
        ready = effective_time(row)
        if row['status'] == 'cancelled' or not ready:
            continue
        local = timestamp(ready).astimezone(LONDON)
        if local.date().isoformat() == service_date:
            # Empty lines are left in: the engine bridge must return uncertainty.
            result.append({'orderId': row['orderId'], 'placedAt': row['createdAt'],
                'readyMinute': local.hour * 60 + local.minute + local.second / 60,
                'lines': row['lines']})
    return result

def run_replay(service_date, rows):
    bridge = Path(__file__).with_name('poll-replay.js')
    process = subprocess.run(['node', str(bridge)], input=canonical({'serviceDate': service_date, 'rows': rows}),
        text=True, capture_output=True, timeout=15, env={**os.environ, 'TZ': 'Europe/London'}, check=True)
    result = json.loads(process.stdout)
    if (result.get('verified') is not False or not isinstance(result.get('observations'), list) or
        len(result['observations']) != len(rows)):
        raise ShadowError('INVALID_REPLAY_RESULT')
    return result

class MonitorStore:
    def __init__(self, filename, identity, build_hash='test-build',
                 legacy_identity=None, legacy_build=None):
        target = Path(filename)
        if not target.is_absolute():
            raise ShadowError('ABSOLUTE_PERSISTENT_DB_PATH_REQUIRED')
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.db = sqlite3.connect(str(target), timeout=10)
        self.build_hash = build_hash
        os.chmod(target, 0o600)
        try:
            version = self.db.execute('PRAGMA user_version').fetchone()[0]
            if version not in (0, 2):
                raise ShadowError('UNSUPPORTED_MONITOR_SCHEMA')
            has_metadata = self.db.execute("SELECT 1 FROM sqlite_master WHERE name='metadata'").fetchone()
            previous = self.db.execute("SELECT value FROM metadata WHERE key='identity'").fetchone() if has_metadata else None
            migrating = bool(previous and version == 0)
            expected = legacy_identity if migrating else identity
            if previous and previous[0] != expected:
                raise ShadowError('MONITOR_IDENTITY_CHANGED')
            if migrating:
                if not legacy_build:
                    raise ShadowError('LEGACY_BUILD_REQUIRED')
                # SQLite backup includes committed WAL contents. Exclusive creation
                # prevents overwrite; failed backup aborts before schema mutation.
                backup = target.with_name(target.name + '.pre-v2-' + uuid.uuid4().hex + '.sqlite3')
                fd = os.open(backup, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
                os.close(fd)
                destination = sqlite3.connect(str(backup))
                try:
                    self.db.backup(destination)
                finally:
                    destination.close()
                directory_fd = os.open(target.parent, os.O_RDONLY | os.O_DIRECTORY)
                try:
                    os.fsync(directory_fd)
                finally:
                    os.close(directory_fd)
            self.db.execute('PRAGMA journal_mode=WAL')
            self.db.execute('PRAGMA synchronous=FULL')
            with self.db:
                self.db.execute('BEGIN IMMEDIATE')
                # Recheck after acquiring the write lock, before any schema writes.
                current = self.db.execute("SELECT value FROM metadata WHERE key='identity'").fetchone() if has_metadata else None
                if current != previous or self.db.execute('PRAGMA user_version').fetchone()[0] != version:
                    raise ShadowError('MONITOR_CHANGED_DURING_UPGRADE')
                statements = [
                  'CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL)',
                  '''CREATE TABLE IF NOT EXISTS polls(id INTEGER PRIMARY KEY, observed_at TEXT NOT NULL,
                    service_date TEXT NOT NULL, result TEXT NOT NULL, reason TEXT NOT NULL, snapshot_hash TEXT,
                    build_hash TEXT NOT NULL)''',
                  '''CREATE TABLE IF NOT EXISTS states(id INTEGER PRIMARY KEY,poll_id INTEGER NOT NULL,
                    service_date TEXT NOT NULL,order_key TEXT NOT NULL,fingerprint TEXT NOT NULL,payload TEXT NOT NULL,
                    model_hint TEXT NOT NULL,prediction TEXT NOT NULL DEFAULT 'UNVERIFIED',
                    evidence_basis TEXT NOT NULL DEFAULT 'POLLED_STATE_NOT_DECISION_HISTORY')''',
                  '''CREATE TABLE IF NOT EXISTS presence(poll_id INTEGER NOT NULL,order_key TEXT NOT NULL,
                    PRIMARY KEY(poll_id,order_key))''',
                  'CREATE INDEX IF NOT EXISTS states_latest ON states(service_date,order_key,id)']
                for statement in statements:
                    self.db.execute(statement)
                if migrating:
                    self.db.execute("ALTER TABLE polls ADD COLUMN build_hash TEXT NOT NULL DEFAULT ''")
                    self.db.execute('UPDATE polls SET build_hash=?', (legacy_build,))
                    self.db.execute("INSERT INTO metadata VALUES('legacyIdentity',?)", (previous[0],))
                    self.db.execute("INSERT INTO metadata VALUES('preV2Backup',?)", (backup.name,))
                self.db.execute("INSERT OR REPLACE INTO metadata VALUES('identity',?)", (identity,))
                self.db.execute('PRAGMA user_version=2')
        except Exception:
            self.db.close()
            raise

    def record(self, day, rows, replay, reason='POLLED_STATE_NOT_DECISION_HISTORY'):
        hints = {row['orderId']: row['status'] for row in replay.get('observations', [])}
        now = datetime.now(timezone.utc).isoformat()
        with self.db:
            cursor = self.db.execute('INSERT INTO polls(observed_at,service_date,result,reason,snapshot_hash,build_hash) VALUES(?,?,?,?,?,?)',
                (now, day, 'OBSERVED', reason, digest(rows), self.build_hash))
            for row in rows:
                self.db.execute('INSERT INTO presence VALUES(?,?)', (cursor.lastrowid,row['orderId']))
                fingerprint = digest(row)
                prior = self.db.execute('SELECT fingerprint,model_hint,p.build_hash FROM states s JOIN polls p ON p.id=s.poll_id WHERE s.service_date=? AND s.order_key=? ORDER BY s.id DESC LIMIT 1',
                    (day, row['orderId'])).fetchone()
                hint = hints.get(row['orderId'], 'UNVERIFIED')
                if hint not in ('GREEN', 'AMBER', 'UNVERIFIED'):
                    hint = 'UNVERIFIED'
                if prior == (fingerprint, hint, self.build_hash):
                    continue
                # B->A recurrence is retained; no global UNIQUE(order,fingerprint).
                self.db.execute('INSERT INTO states(poll_id,service_date,order_key,fingerprint,payload,model_hint) VALUES(?,?,?,?,?,?)',
                    (cursor.lastrowid, day, row['orderId'], fingerprint, canonical(row), hint))

    def failure(self, day, code):
        with self.db:
            self.db.execute('INSERT INTO polls(observed_at,service_date,result,reason,build_hash) VALUES(?,?,?,?,?)',
                (datetime.now(timezone.utc).isoformat(), day, 'UNVERIFIED', code, self.build_hash))

    def summary(self, now=None, max_age_seconds=180):
        now = now or datetime.now(timezone.utc)
        latest = self.db.execute('''SELECT service_date,payload,model_hint FROM states s WHERE id IN
          (SELECT MAX(id) FROM states GROUP BY service_date,order_key) AND EXISTS
          (SELECT 1 FROM presence p WHERE p.order_key=s.order_key AND p.poll_id=
            (SELECT MAX(id) FROM polls WHERE service_date=s.service_date AND result='OBSERVED'))''').fetchall()
        matrix = {}
        for service_date, payload, hint in latest:
            row = json.loads(payload)
            key = service_date + '/' + row['status'] + '/' + hint
            matrix[key] = matrix.get(key, 0) + 1
        last = self.db.execute('SELECT observed_at,result,reason FROM polls ORDER BY id DESC LIMIT 1').fetchone()
        health = {day: {'observedAt': observed_at, 'result': result, 'reason': reason}
            for day, observed_at, result, reason in self.db.execute('''
              SELECT service_date,observed_at,result,reason FROM polls WHERE id IN
              (SELECT MAX(id) FROM polls GROUP BY service_date)''')}
        identity = self.db.execute("SELECT value FROM metadata WHERE key='identity'").fetchone()[0]
        for day in health.values():
            age = (now - timestamp(day['observedAt'])).total_seconds()
            day['ageSeconds'] = round(age, 3)
            day['stale'] = day['result'] != 'OBSERVED' or age < 0 or age > max_age_seconds
        audit = self.db.execute('SELECT COUNT(*),COUNT(DISTINCT order_key) FROM states').fetchone()
        audit_statuses = {}
        for payload, in self.db.execute('SELECT payload FROM states'):
            status = json.loads(payload)['status']
            audit_statuses[status] = audit_statuses.get(status, 0) + 1
        polls = self.db.execute('SELECT COUNT(*) FROM polls').fetchone()[0]
        return {'sourceIdentity': identity, 'schemaVersion': 2, 'currentBuildHash': self.build_hash,
            'recordedBuilds': [r[0] for r in self.db.execute('SELECT DISTINCT build_hash FROM polls ORDER BY build_hash')], 'perServiceDayHealth': health, 'latestOrderStates': len(latest), 'observedStatusVsHypotheticalHint': matrix,
            'audit': {'stateRecords': audit[0], 'distinctOrders': audit[1], 'pollRecords': polls,
                      'observedStatusRecords': audit_statuses},
            'lastPoll': last, 'staleAfterSeconds': max_age_seconds,
            'stale': not health or any(day['stale'] for day in health.values()), 'prediction': 'UNVERIFIED', 'verified': False,
            'evidenceBasis': 'POLLED_STATE_NOT_DECISION_HISTORY'}

    def close(self):
        self.db.close()

class Collector:
    def __init__(self, source, store, secret, assess=run_replay, enabled=False):
        self.source, self.store, self.secret, self.assess, self.enabled = source, store, secret, assess, enabled

    def poll(self, day):
        if self.enabled is not True:
            return {'state': 'DISABLED'}
        try:
            # Two equal projections detect concurrent visible changes, but do not
            # prove an MVCC transaction or that RLS exposes every order.
            first = normalize(self.source.snapshot(day), self.secret)
            second = normalize(self.source.snapshot(day), self.secret)
            if first != second:
                raise ShadowError('SOURCE_CHANGED_DURING_READ')
            try:
                replay = self.assess(day, replay_rows(day, second))
                if replay.get('verified') is not False:
                    raise ShadowError('UNSUPPORTED_REPLAY_CONFIDENCE')
                reason = 'POLLED_STATE_NOT_DECISION_HISTORY'
            except Exception:
                replay = {'observations': [], 'verified': False}
                reason = 'REPLAY_UNAVAILABLE'
            self.store.record(day, second, replay, reason)
            return {'state': 'OBSERVED', 'orders': len(second), 'prediction': 'UNVERIFIED', 'reason': reason}
        except Exception as error:
            code = str(error) if isinstance(error, ShadowError) else 'COLLECTOR_ERROR'
            # Only locally defined error codes, never HTTP bodies, URLs or keys.
            if not re.fullmatch(r'[A-Z_]{1,64}', code):
                code = 'COLLECTOR_ERROR'
            try:
                self.store.failure(day, code)
            except Exception:
                return {'state': 'UNVERIFIED', 'reason': 'PERSISTENCE_FAILED'}
            return {'state': 'UNVERIFIED', 'reason': code}

def main():
    global STARTUP_PHASE
    STARTUP_PHASE = 'ARGUMENTS'
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--once', action='store_true')
    parser.add_argument('--summary', action='store_true')
    parser.add_argument('--service-date', action='append')
    args = parser.parse_args()
    # Disabled means no credential inspection, DB initialization or network calls.
    if os.environ.get('MASTER_WOK_COLLECTOR_ENABLED') != 'true':
        print(canonical({'state': 'DISABLED'}))
        return 0
    STARTUP_PHASE = 'CONFIGURATION'
    url = os.environ.get('MASTER_WOK_SUPABASE_URL', '')
    token = os.environ.get('MASTER_WOK_SUPABASE_READ_KEY', '')
    secret = os.environ.get('MASTER_WOK_PSEUDONYM_KEY', '')
    if len(secret) < 32:
        raise ShadowError('PSEUDONYM_KEY_REQUIRED')
    source_kind = os.environ.get('MASTER_WOK_SOURCE_KIND', 'rest')
    if source_kind == 'rest':
        source = ReadOnlySource(url, token)
    elif source_kind == 'management_read_only':
        source = ManagementReadOnlySource(url, os.environ.get('MASTER_WOK_MANAGEMENT_READ_TOKEN', ''))
    else:
        raise ShadowError('INVALID_SOURCE_CONFIG')
    STARTUP_PHASE = 'ENGINE_FILES'
    build_root = Path(__file__).resolve().parent.parent
    build_hash = digest({name: hashlib.sha256((build_root / name).read_bytes()).hexdigest()
        for name in ('master-wok.js', 'master-wok-model-bundle.js', 'master-wok-shadow.js', 'railway-shadow/poll-replay.js', 'railway-shadow/shadow_collector.py')})
    identity_fields = {'url': source.url, 'pseudonymKeyHash': digest(secret)}
    if source_kind != 'rest':
        identity_fields['sourceKind'] = source_kind
    identity = digest(identity_fields)
    legacy_build = json.loads(Path(__file__).with_name('legacy-build.json').read_text())['buildHash']
    legacy_identity = digest({'url': url, 'pseudonymKeyHash': digest(secret), 'buildHash': legacy_build})
    STARTUP_PHASE = 'DATABASE'
    store = MonitorStore(os.environ.get('MASTER_WOK_MONITOR_DB', ''), identity, build_hash,
                         legacy_identity if source_kind == 'rest' else None, legacy_build)
    try:
        if args.summary:
            print(canonical(store.summary()))
            return 0
        collector = Collector(source, store, secret, enabled=True)
        STARTUP_PHASE = 'POLL_CONFIGURATION'
        interval = int(os.environ.get('MASTER_WOK_POLL_SECONDS', '60'))
        if not 30 <= interval <= 3600:
            raise ShadowError('INVALID_POLL_INTERVAL')
        while True:
            today = datetime.now(LONDON).date()
            days = args.service_date or [today.isoformat(), (today + timedelta(days=1)).isoformat()]
            if len(days) > 7:
                raise ShadowError('SERVICE_DATE_LIMIT')
            for day in days:
                STARTUP_PHASE = 'SERVICE_DATE'
                day_bounds(day)
                STARTUP_PHASE = 'POLL'
                result = collector.poll(day)
                print(canonical(result), flush=True)
                if args.once and result['state'] != 'OBSERVED':
                    return 1
            if args.once:
                return 0
            # Standalone process only; nothing waits inside a checkout request.
            time.sleep(interval)
    finally:
        store.close()

def safe_startup_failure(error):
    if isinstance(error, ShadowError) and str(error) in SAFE_STARTUP_REASONS:
        reason = str(error)
    elif isinstance(error, PermissionError):
        reason = 'FILESYSTEM_PERMISSION_DENIED'
    elif isinstance(error, FileNotFoundError):
        reason = 'REQUIRED_FILE_NOT_FOUND'
    elif isinstance(error, sqlite3.Error):
        reason = 'SQLITE_ERROR'
    elif isinstance(error, ValueError):
        reason = 'INVALID_CONFIGURATION_VALUE'
    else:
        reason = 'STARTUP_OR_STORAGE_ERROR'
    return {'state': 'UNVERIFIED', 'reason': reason, 'phase': STARTUP_PHASE}


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(0)
    except Exception as error:
        print(canonical(safe_startup_failure(error)), flush=True)
        raise SystemExit(1)
