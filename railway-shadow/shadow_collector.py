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
from datetime import date, datetime, timedelta, timezone
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler
from zoneinfo import ZoneInfo

LONDON = ZoneInfo('Europe/London')
STATUSES = {'pending', 'confirmed', 'accepted', 'proposed', 'customer_accepted_time',
            'customer_declined_time', 'preparing', 'completed', 'cancelled'}
ORDER_FIELDS = 'id,created_at,preferred_time,proposed_time,confirmed_time,status,is_test'
ITEM_FIELDS = 'id,order_id,item_id,qty,modifiers'

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
    def __init__(self, filename, identity):
        target = Path(filename)
        if not target.is_absolute():
            raise ShadowError('ABSOLUTE_PERSISTENT_DB_PATH_REQUIRED')
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.db = sqlite3.connect(str(target), timeout=10)
        os.chmod(target, 0o600)
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA synchronous=FULL')
        self.db.executescript('''
          CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS polls(id INTEGER PRIMARY KEY, observed_at TEXT NOT NULL,
            service_date TEXT NOT NULL, result TEXT NOT NULL, reason TEXT NOT NULL, snapshot_hash TEXT);
          CREATE TABLE IF NOT EXISTS states(id INTEGER PRIMARY KEY,poll_id INTEGER NOT NULL,
            service_date TEXT NOT NULL,order_key TEXT NOT NULL,fingerprint TEXT NOT NULL,payload TEXT NOT NULL,
            model_hint TEXT NOT NULL,prediction TEXT NOT NULL DEFAULT 'UNVERIFIED',
            evidence_basis TEXT NOT NULL DEFAULT 'POLLED_STATE_NOT_DECISION_HISTORY');
          CREATE TABLE IF NOT EXISTS presence(poll_id INTEGER NOT NULL,order_key TEXT NOT NULL,
            PRIMARY KEY(poll_id,order_key));
          CREATE INDEX IF NOT EXISTS states_latest ON states(service_date,order_key,id);
        ''')
        try:
            with self.db:
                previous = self.db.execute("SELECT value FROM metadata WHERE key='identity'").fetchone()
                if previous and previous[0] != identity:
                    raise ShadowError('MONITOR_IDENTITY_CHANGED')
                self.db.execute("INSERT OR IGNORE INTO metadata VALUES('identity',?)", (identity,))
        except Exception:
            self.db.close()
            raise

    def record(self, day, rows, replay, reason='POLLED_STATE_NOT_DECISION_HISTORY'):
        hints = {row['orderId']: row['status'] for row in replay.get('observations', [])}
        now = datetime.now(timezone.utc).isoformat()
        with self.db:
            cursor = self.db.execute('INSERT INTO polls(observed_at,service_date,result,reason,snapshot_hash) VALUES(?,?,?,?,?)',
                (now, day, 'OBSERVED', reason, digest(rows)))
            for row in rows:
                self.db.execute('INSERT INTO presence VALUES(?,?)', (cursor.lastrowid,row['orderId']))
                fingerprint = digest(row)
                prior = self.db.execute('SELECT fingerprint,model_hint FROM states WHERE service_date=? AND order_key=? ORDER BY id DESC LIMIT 1',
                    (day, row['orderId'])).fetchone()
                hint = hints.get(row['orderId'], 'UNVERIFIED')
                if hint not in ('GREEN', 'AMBER', 'UNVERIFIED'):
                    hint = 'UNVERIFIED'
                if prior == (fingerprint, hint):
                    continue
                # B->A recurrence is retained; no global UNIQUE(order,fingerprint).
                self.db.execute('INSERT INTO states(poll_id,service_date,order_key,fingerprint,payload,model_hint) VALUES(?,?,?,?,?,?)',
                    (cursor.lastrowid, day, row['orderId'], fingerprint, canonical(row), hint))

    def failure(self, day, code):
        with self.db:
            self.db.execute('INSERT INTO polls(observed_at,service_date,result,reason) VALUES(?,?,?,?)',
                (datetime.now(timezone.utc).isoformat(), day, 'UNVERIFIED', code))

    def summary(self):
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
        return {'buildAndSourceIdentity': identity, 'perServiceDayHealth': health, 'latestOrderStates': len(latest), 'observedStatusVsHypotheticalHint': matrix,
            'lastPoll': last, 'stale': any(day['result'] != 'OBSERVED' for day in health.values()), 'prediction': 'UNVERIFIED', 'verified': False,
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
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--once', action='store_true')
    parser.add_argument('--summary', action='store_true')
    parser.add_argument('--service-date', action='append')
    args = parser.parse_args()
    # Disabled means no credential inspection, DB initialization or network calls.
    if os.environ.get('MASTER_WOK_COLLECTOR_ENABLED') != 'true':
        print(canonical({'state': 'DISABLED'}))
        return 0
    url = os.environ.get('MASTER_WOK_SUPABASE_URL', '')
    token = os.environ.get('MASTER_WOK_SUPABASE_READ_KEY', '')
    secret = os.environ.get('MASTER_WOK_PSEUDONYM_KEY', '')
    if len(secret) < 32:
        raise ShadowError('PSEUDONYM_KEY_REQUIRED')
    source = ReadOnlySource(url, token)
    build_root = Path(__file__).resolve().parent.parent
    build_hash = digest({name: hashlib.sha256((build_root / name).read_bytes()).hexdigest()
        for name in ('master-wok.js', 'master-wok-model-bundle.js', 'master-wok-shadow.js', 'railway-shadow/poll-replay.js', 'railway-shadow/shadow_collector.py')})
    identity = digest({'url': url, 'pseudonymKeyHash': digest(secret), 'buildHash': build_hash})
    store = MonitorStore(os.environ.get('MASTER_WOK_MONITOR_DB', ''), identity)
    try:
        if args.summary:
            print(canonical(store.summary()))
            return 0
        collector = Collector(source, store, secret, enabled=True)
        interval = int(os.environ.get('MASTER_WOK_POLL_SECONDS', '60'))
        if not 30 <= interval <= 3600:
            raise ShadowError('INVALID_POLL_INTERVAL')
        while True:
            today = datetime.now(LONDON).date()
            days = args.service_date or [today.isoformat(), (today + timedelta(days=1)).isoformat()]
            if len(days) > 7:
                raise ShadowError('SERVICE_DATE_LIMIT')
            for day in days:
                day_bounds(day)
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

if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(0)
    except Exception:
        print(canonical({'state': 'UNVERIFIED', 'reason': 'STARTUP_OR_STORAGE_ERROR'}))
        raise SystemExit(1)
