"""Staging fixture comparisons only. Remote reads; dedicated local SQLite writes."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import sqlite3
import subprocess
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hmac
from urllib.request import Request, build_opener, HTTPRedirectHandler

ROOT = Path(__file__).resolve().parents[1]
PROJECT = 'hvrqgufqjslvgiohgkvu'
SOURCE_URL = 'https://' + PROJECT + '.supabase.co'
ENDPOINT = 'https://api.supabase.com/v1/projects/' + PROJECT + '/database/query/read-only'
QUERY = (ROOT / 'staging-delivery/worker-source.sql').read_text()
IDENTITY = hashlib.sha256((PROJECT + '\n' + QUERY).encode()).hexdigest()
FIELDS = {'observationKey', 'schemaVersion', 'caseKey', 'orderAlias', 'dataOrigin', 'sourceEvidence',
          'serviceDate', 'assessedAt', 'sourceHash', 'buildHash', 'policyId', 'observedStatus',
          'prediction', 'reasonCode', 'planKind', 'verified'}

class WorkerError(Exception):
    pass

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise WorkerError('SOURCE_REDIRECT_REFUSED')

def now():
    return datetime.now(timezone.utc).timestamp()

def encoded(value):
    return json.dumps(value, separators=(',', ':'), ensure_ascii=False)

def configuration(env):
    # Gate before credentials, database creation or network activity.
    if env.get('MASTER_WOK_DELIVERY_STAGING_ENABLED') != 'true':
        return None
    if (env.get('RAILWAY_ENVIRONMENT_NAME') != 'master-wok-staging' or
        env.get('MASTER_WOK_DELIVERY_SOURCE_URL') != SOURCE_URL):
        raise WorkerError('STAGING_SCOPE_REQUIRED')
    token = env.get('MASTER_WOK_MANAGEMENT_READ_TOKEN', '')
    health = env.get('MASTER_WOK_DELIVERY_HEALTH_TOKEN', '')
    db = env.get('MASTER_WOK_DELIVERY_JOURNAL', '')
    # Dedicated filename prevents reuse of the kitchen collector database.
    if not token or len(health) < 32 or not Path(db).is_absolute() or Path(db).name != 'delivery-staging.sqlite3':
        raise WorkerError('PRIVATE_WORKER_CONFIGURATION_REQUIRED')
    return token, health, db

def fetch_source(token):
    request = Request(ENDPOINT, data=encoded({'query': QUERY}).encode(), method='POST',
                      headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
    with build_opener(NoRedirect).open(request, timeout=15) as response:
        if response.status != 200:
            raise WorkerError('SOURCE_HTTP_ERROR')
        body = response.read(5_000_001)
        if len(body) > 5_000_000:
            raise WorkerError('SOURCE_SIZE_LIMIT')
    rows = json.loads(body)
    if not isinstance(rows, list) or len(rows) != 1 or rows[0].get('source_role') != 'supabase_read_only_user':
        raise WorkerError('SOURCE_READ_ONLY_ROLE_UNPROVEN')
    return rows[0].get('staging_source')

def compare(source):
    if len(encoded(source).encode()) > 5_000_000:
        raise WorkerError('SOURCE_SIZE_LIMIT')
    result = subprocess.run(['node', str(ROOT / 'staging-delivery/compare_batch.js')],
                            input=encoded(source), capture_output=True, text=True, timeout=60,
                            cwd=ROOT, check=False,
                            env={k: v for k, v in os.environ.items() if k in ('PATH', 'TZ', 'LANG')})
    if result.returncode or len(result.stdout.encode()) > 200_000:
        raise WorkerError('COMPARISON_FAILED')
    return json.loads(result.stdout)

def validate(batch):
    if not isinstance(batch, dict):
        raise WorkerError('INVALID_COMPARISON')
    cases, records = batch.get('caseKeys'), batch.get('records')
    if (not isinstance(cases, list) or not 1 <= len(cases) <= 50 or
        any(not isinstance(c, str) or not re.fullmatch('[A-Z0-9_]{1,64}', c) for c in cases) or
        len(set(cases)) != len(cases) or not isinstance(records, list) or not len(cases) <= len(records) <= 2*len(cases)):
        raise WorkerError('INVALID_COMPARISON')
    seen, counts = set(), {c: 0 for c in cases}
    for r in records:
        if (not isinstance(r, dict) or set(r) != FIELDS or r['caseKey'] not in counts or
            r['schemaVersion'] != 1 or r['verified'] is not False or r['dataOrigin'] != 'SYNTHETIC_STAGING' or
            r['sourceEvidence'] != 'CURRENT_SAVED_STATE_NOT_DECISION_HISTORY' or
            r['prediction'] not in ('RECOMMENDED', 'UNVERIFIED') or r['planKind'] not in (None, 'COMBINED', 'SEPARATE') or
            (r['prediction'] == 'RECOMMENDED' and r['planKind'] is None) or
            (r['prediction'] == 'UNVERIFIED' and r['planKind'] is not None) or
            r['observedStatus'] not in ('pending', 'confirmed', 'completed', 'cancelled', 'customer_declined', 'unknown') or
            r['policyId'] != 'rtk-delivery-shadow-2026-10-17-v1' or
            any(not isinstance(r[k], str) or not re.fullmatch('[a-f0-9]{64}', r[k]) for k in ('observationKey','sourceHash','buildHash')) or
            not isinstance(r['reasonCode'], str) or not re.fullmatch('[A-Z0-9_]{1,64}', r['reasonCode']) or
            not isinstance(r['orderAlias'], str) or not re.fullmatch('[A-Za-z0-9_-]{1,80}', r['orderAlias'])):
            raise WorkerError('INVALID_RECORD')
        try:
            datetime.strptime(r['serviceDate'], '%Y-%m-%d')
            instant = datetime.fromisoformat(r['assessedAt'].replace('Z', '+00:00'))
            if instant.tzinfo is None:
                raise ValueError()
        except (ValueError, TypeError, AttributeError):
            raise WorkerError('INVALID_RECORD') from None
        expected = hashlib.sha256(encoded({k:v for k,v in r.items() if k != 'observationKey'}).encode()).hexdigest()
        pair = (r['caseKey'], r['orderAlias'])
        if r['observationKey'] != expected or pair in seen:
            raise WorkerError('RECORD_IDENTITY_MISMATCH')
        seen.add(pair)
        counts[r['caseKey']] += 1
    if any(n < 1 or n > 2 for n in counts.values()):
        raise WorkerError('INCOMPLETE_COMPARISON')
    return batch

class Journal:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.lock = open(str(self.path) + '.lock', 'a')
        os.chmod(str(self.path) + '.lock', 0o600)
        try:
            fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.db = sqlite3.connect(self.path, timeout=5)
            os.chmod(self.path, 0o600)
            self.db.execute('PRAGMA journal_mode=WAL')
            self.db.execute('PRAGMA synchronous=FULL')
            self.db.execute('PRAGMA foreign_keys=ON')
            with self.db:
                self.db.execute('CREATE TABLE IF NOT EXISTS worker_meta(identity TEXT PRIMARY KEY)')
                identities = self.db.execute('SELECT identity FROM worker_meta').fetchall()
                if identities and identities != [(IDENTITY,)]:
                    raise WorkerError('JOURNAL_SOURCE_MISMATCH')
                self.db.execute('INSERT OR IGNORE INTO worker_meta VALUES (?)', (IDENTITY,))
                self.db.execute('CREATE TABLE IF NOT EXISTS observations(key TEXT PRIMARY KEY, record TEXT NOT NULL, first_seen REAL NOT NULL)')
                self.db.execute('CREATE TABLE IF NOT EXISTS polls(id INTEGER PRIMARY KEY, observed_at REAL NOT NULL, status TEXT NOT NULL, reason TEXT NOT NULL)')
                self.db.execute('CREATE TABLE IF NOT EXISTS presence(case_key TEXT NOT NULL, order_alias TEXT NOT NULL, observation_key TEXT NOT NULL REFERENCES observations(key), PRIMARY KEY(case_key,order_alias))')
        except Exception:
            self.close()
            raise

    def close(self):
        if hasattr(self, 'db'):
            self.db.close()
        self.lock.close()

    def commit(self, batch, at):
        validate(batch)
        with self.db:
            self.db.execute('DELETE FROM presence')
            for r in batch['records']:
                value = json.dumps(r, sort_keys=True, separators=(',', ':'))
                found = self.db.execute('SELECT record FROM observations WHERE key=?', (r['observationKey'],)).fetchone()
                if found and found[0] != value:
                    raise WorkerError('JOURNAL_CONTENT_CONFLICT')
                self.db.execute('INSERT OR IGNORE INTO observations VALUES (?,?,?)', (r['observationKey'], value, at))
                self.db.execute('INSERT INTO presence VALUES (?,?,?)', (r['caseKey'],r['orderAlias'],r['observationKey']))
            self.db.execute("INSERT INTO polls(observed_at,status,reason) VALUES (?,'OBSERVED','SYNTHETIC_REHEARSAL')", (at,))

    def failure(self, at):
        with self.db:
            self.db.execute("INSERT INTO polls(observed_at,status,reason) VALUES (?,'ERROR','POLL_FAILED')", (at,))


def health(path, at=None):
    try:
        db = sqlite3.connect(Path(path).as_uri() + '?mode=ro', uri=True, timeout=2)
        try:
            if db.execute('SELECT identity FROM worker_meta').fetchall() != [(IDENTITY,)]:
                return False
            row = db.execute('SELECT observed_at,status FROM polls ORDER BY id DESC LIMIT 1').fetchone()
            return bool(row and row[1] == 'OBSERVED' and 0 <= (now() if at is None else at) - row[0] <= 180)
        finally:
            db.close()
    except (sqlite3.Error, ValueError, OSError):
        return False


def run_once(journal, source, assessor=compare, clock=now):
    try:
        batch = assessor(source())
        journal.commit(batch, clock())
        return True
    except Exception:
        # No exception strings: transport failures can include tokens or SQL payloads.
        try:
            journal.failure(clock())
        except Exception:
            pass
        return False


def serve_health(path, token, state, port):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass
        def do_GET(self):
            if self.path != '/healthz':
                self.send_error(404); return
            if not hmac.compare_digest(self.headers.get('Authorization', '').encode(), ('Bearer ' + token).encode()):
                self.send_error(401); return
            okay = state['okay'] and health(path)
            body = encoded({'status': 'HEALTHY' if okay else 'UNHEALTHY', 'verified': False,
                            'dataOrigin': 'SYNTHETIC_STAGING'}).encode()
            self.send_response(200 if okay else 503)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers(); self.wfile.write(body)
    server = ThreadingHTTPServer(('0.0.0.0', port), Handler)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--once', action='store_true')
    args = parser.parse_args()
    journal = server = None
    try:
        config = configuration(os.environ)
        if config is None:
            print(encoded({'status':'DISABLED','networkRequests':0,'verified':False}), flush=True)
            return 0
        token, health_token, path = config
        journal = Journal(path)
        stop = threading.Event()
        for sig in (signal.SIGTERM, signal.SIGINT):
            signal.signal(sig, lambda *_: stop.set())
        state = {'okay': False}
        if not args.once:
            server = serve_health(path, health_token, state, int(os.environ.get('PORT', '8080')))
        while not stop.is_set():
            state['okay'] = run_once(journal, lambda: fetch_source(token))
            event = {'status':'OBSERVED' if state['okay'] else 'POLL_FAILED',
                     'dataOrigin':'SYNTHETIC_STAGING','verified':False}
            if state['okay']:
                event.update({
                    'caseCount': journal.db.execute('SELECT count(DISTINCT case_key) FROM presence').fetchone()[0],
                    'currentComparisons': journal.db.execute('SELECT count(*) FROM presence').fetchone()[0],
                    'durableObservations': journal.db.execute('SELECT count(*) FROM observations').fetchone()[0],
                    'pollRecords': journal.db.execute('SELECT count(*) FROM polls').fetchone()[0]})
            print(encoded(event), flush=True)
            if args.once:
                return 0 if state['okay'] else 1
            stop.wait(60)
        return 0
    except Exception:
        print(encoded({'status':'WORKER_START_FAILED','verified':False}), flush=True)
        return 1
    finally:
        if server:
            server.shutdown(); server.server_close()
        if journal:
            journal.close()

if __name__ == '__main__':
    raise SystemExit(main())
