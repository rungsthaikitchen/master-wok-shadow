"""Default-off, local redacted comparison journal. No network or booking hooks.

Saved-state audits can only record UNVERIFIED. Synthetic recommendations use a
separate database identity and cannot be merged into real-order evidence.
"""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import sqlite3
from delivery_evidence_journal import validate_audit, is_hash, finite
from shadow_collector import timestamp
from delivery_staging_worker import validate as validate_synthetic

APP_ID = 0x4D574443
VERSION = 1
SCOPES = {'SAVED_STATE_ONLY', 'SYNTHETIC_STAGING'}

def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)

def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()

class ComparisonError(Exception):
    pass

class DeliveryComparisonJournal:
    def __init__(self, path, source_identity, scope, *, enabled=False):
        if enabled is not True:
            raise ComparisonError('DISABLED')
        if not is_hash(source_identity) or scope not in SCOPES:
            raise ComparisonError('COMPARISON_SCOPE_REQUIRED')
        self.path = Path(path)
        if (not self.path.is_absolute() or self.path.name != 'delivery-comparison.sqlite3' or
            self.path.is_symlink() or Path(str(self.path)+'.lock').is_symlink()):
            raise ComparisonError('DEDICATED_COMPARISON_PATH_REQUIRED')
        self.identity, self.scope = source_identity, scope
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.lock = open(str(self.path)+'.lock', 'a')
        os.chmod(str(self.path)+'.lock', 0o600)
        try:
            fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            existed = self.path.exists()
            self.db = sqlite3.connect(self.path.as_uri()+('?mode=rw' if existed else '?mode=rwc'), uri=True)
            if existed:
                if (self.db.execute('PRAGMA application_id').fetchone()[0] != APP_ID or
                    self.db.execute('PRAGMA user_version').fetchone()[0] != VERSION or
                    self.db.execute('SELECT identity,scope FROM comparison_meta').fetchall() != [(source_identity,scope)]):
                    raise ComparisonError('COMPARISON_IDENTITY_MISMATCH')
            else:
                with self.db:
                    self.db.execute('CREATE TABLE comparison_meta(identity TEXT NOT NULL,scope TEXT NOT NULL)')
                    self.db.execute('INSERT INTO comparison_meta VALUES (?,?)',(source_identity,scope))
                    self.db.execute('CREATE TABLE observations(key TEXT PRIMARY KEY, payload TEXT NOT NULL)')
                    self.db.execute('CREATE TABLE snapshots(key TEXT PRIMARY KEY, service_date TEXT NOT NULL, first_seen REAL NOT NULL)')
                    self.db.execute('CREATE TABLE members(snapshot_key TEXT NOT NULL REFERENCES snapshots(key), observation_key TEXT NOT NULL REFERENCES observations(key), PRIMARY KEY(snapshot_key,observation_key))')
                    self.db.execute('CREATE TABLE latest(service_date TEXT PRIMARY KEY, snapshot_key TEXT NOT NULL REFERENCES snapshots(key))')
                    self.db.execute('CREATE TABLE observation_events(id INTEGER PRIMARY KEY, snapshot_key TEXT NOT NULL REFERENCES snapshots(key), observed_at REAL NOT NULL)')
                    self.db.execute('PRAGMA application_id='+str(APP_ID))
                    self.db.execute('PRAGMA user_version='+str(VERSION))
            os.chmod(self.path,0o600)
            self.db.execute('PRAGMA foreign_keys=ON')
            self.db.execute('PRAGMA journal_mode=WAL')
            self.db.execute('PRAGMA synchronous=FULL')
        except Exception:
            self.close()
            raise

    def close(self):
        if hasattr(self,'db'):
            self.db.close()
        self.lock.close()

    def append_saved_audit(self, audit, build_hash, at):
        if self.scope != 'SAVED_STATE_ONLY':
            raise ComparisonError('COMPARISON_SCOPE_MISMATCH')
        validate_audit(audit,self.identity)
        if not is_hash(build_hash):
            raise ComparisonError('BUILD_IDENTITY_REQUIRED')
        if not finite(at) or not -5 <= at-timestamp(audit['observedAt']).timestamp() <= 180:
            raise ComparisonError('SOURCE_CLOCK_UNVERIFIED')
        records = [dict(schemaVersion=1, sourceIdentity=self.identity, buildHash=build_hash,
            sourceHash=audit['snapshotHash'], serviceDate=audit['serviceDate'],
            assessedAt=audit['observedAt'], orderAlias=r['orderId'], observedStatus=r['observedStatus'],
            prediction='UNVERIFIED', planKind=None, verified=False,
            evidenceBasis='CURRENT_SAVED_STATE_NOT_DECISION_HISTORY',
            reasonCodes=r['reasonCodes']) for r in audit['records']]
        return self._append(audit['serviceDate'], records, at, audit['snapshotHash'], audit['observedAt'])

    def append_synthetic(self, batch, at):
        if self.scope != 'SYNTHETIC_STAGING':
            raise ComparisonError('COMPARISON_SCOPE_MISMATCH')
        validate_synthetic(batch)
        days = {r['serviceDate'] for r in batch['records']}
        if len(days)!=1:
            raise ComparisonError('SINGLE_SERVICE_DAY_REQUIRED')
        # Existing synthetic comparison contract excludes route durations/locations.
        # Only offline synthetic fixture comparisons belong here. The Google trial
        # intentionally has no persistence call or journal dependency.
        records = [dict(r, evidenceBasis='SYNTHETIC_HYPOTHETICAL_PLANS', sourceIdentity=self.identity)
                   for r in batch['records']]
        return self._append(next(iter(days)), records, at, digest(batch), None)

    def _append(self, day, records, at, source_hash, assessed_at):
        if not finite(at):
            raise ComparisonError('INVALID_JOURNAL_CLOCK')
        records = sorted(records, key=canonical)
        snapshot = digest({'identity':self.identity,'scope':self.scope,'day':day,
                           'source':source_hash,'assessedAt':assessed_at,'records':records})
        with self.db:
            last=self.db.execute('SELECT MAX(e.observed_at) FROM observation_events e JOIN snapshots s ON s.key=e.snapshot_key WHERE s.service_date=?',(day,)).fetchone()[0]
            if last is not None and at < last:
                raise ComparisonError('OUT_OF_ORDER_OBSERVATION')
            self.db.execute('INSERT OR IGNORE INTO snapshots VALUES (?,?,?)',(snapshot,day,at))
            for record in records:
                payload=canonical(record); key=digest(record)
                old=self.db.execute('SELECT payload FROM observations WHERE key=?',(key,)).fetchone()
                if old and old[0]!=payload:
                    raise ComparisonError('COMPARISON_CONTENT_CONFLICT')
                self.db.execute('INSERT OR IGNORE INTO observations VALUES (?,?)',(key,payload))
                self.db.execute('INSERT OR IGNORE INTO members VALUES (?,?)',(snapshot,key))
            self.db.execute('INSERT INTO observation_events(snapshot_key,observed_at) VALUES (?,?)',(snapshot,at))
            self.db.execute('INSERT INTO latest VALUES (?,?) ON CONFLICT(service_date) DO UPDATE SET snapshot_key=excluded.snapshot_key',(day,snapshot))
        return {'status':'RECORDED','snapshotKey':snapshot,'records':len(records),'verified':False}

    def summary(self):
        # Counts are observation versions, never booking accuracy or actual activity.
        rows=self.db.execute('SELECT o.key,o.payload FROM latest l JOIN members m ON m.snapshot_key=l.snapshot_key JOIN observations o ON o.key=m.observation_key').fetchall()
        counts={}
        for key,payload in rows:
            r=json.loads(payload)
            if digest(r)!=key:
                raise ComparisonError('COMPARISON_CONTENT_CORRUPT')
            key=(r['observedStatus'],r['prediction'])
            counts[key]=counts.get(key,0)+1
        return {'scope':self.scope,'verified':False,'latestRecords':len(rows),
                'observedStatusVsHypothetical':[{'observedStatus':a,'prediction':b,'count':n}
                    for (a,b),n in sorted(counts.items())]}
