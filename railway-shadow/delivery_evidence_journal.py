"""Local saved-state evidence journal. No source writes, routes or booking hooks."""
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import subprocess
from datetime import datetime, timezone
from shadow_collector import day_bounds, timestamp, canonical, digest

ROOT = Path(__file__).resolve().parents[1]
APPLICATION_ID = 0x4D574445
VERSION = 1
PROJECTS = {'hvrqgufqjslvgiohgkvu','ubyjrrsvbbqomitpaidb'}
AUDIT_FIELDS = {'status','assessmentScope','sourceEvidence','serviceDate','observedAt','snapshotHash','sourceIdentity',
                'prediction','recommendation','verified','deliveryOrders','unknownOrderTypes','records'}
RECORD_FIELDS = {'orderId','observedStatus','orderType','targetBasis','targetMinute','deliveryFeeBand',
                 'coordinateEvidence','inServiceDate','prediction','reasonCodes','verified'}
STATUSES = {'pending','confirmed','accepted','proposed','customer_accepted_time','customer_declined_time',
            'preparing','completed','cancelled','UNKNOWN'}
REASONS = {'INACTIVE_SAVED_STATUS','UNKNOWN_SAVED_STATUS','ORDER_TYPE_UNAVAILABLE','INVALID_TARGET_TIMESTAMP',
           'EFFECTIVE_TARGET_OUTSIDE_SERVICE_DATE','TARGET_NOT_MINUTE_ALIGNED','BASKET_ITEMS_UNAVAILABLE',
           'UNACKNOWLEDGED_TIME_PROPOSAL','DELIVERY_LOCATION_EVIDENCE_UNAVAILABLE',
           'DIRECTIONAL_ROUTE_DURATIONS_UNAVAILABLE','COMPLETE_KITCHEN_PLAN_UNAVAILABLE','COMPLETE_DRIVER_PLAN_UNAVAILABLE'}
FAILURES = {'SOURCE_FAILED','AUDIT_FAILED','JOURNAL_FAILED','SOURCE_CLOCK_UNVERIFIED'}

class EvidenceError(Exception):
    pass

def now():
    return datetime.now(timezone.utc).timestamp()

def is_hash(value):
    return isinstance(value,str) and re.fullmatch('[a-f0-9]{64}',value) is not None

def finite(value):
    return not isinstance(value,bool) and isinstance(value,(int,float)) and math.isfinite(value)

def build_hash():
    h=hashlib.sha256()
    for name in ('railway-shadow/shadow_collector.py','railway-shadow/delivery_shadow_source.py',
                 'master-wok-live-shadow.js','master-wok-delivery-evidence-audit.js',
                 'railway-shadow/delivery_evidence_journal.py'):
        h.update((name+'\0').encode());h.update((ROOT/name).read_bytes())
    return h.hexdigest()

def validate_audit(audit, identity):
    if (not isinstance(audit,dict) or set(audit)!=AUDIT_FIELDS or audit['status']!='OBSERVED' or
        audit['assessmentScope']!='SAVED_STATE_EVIDENCE_AUDIT_ONLY' or
        audit['sourceEvidence']!='CURRENT_SAVED_STATE_NOT_DECISION_HISTORY' or
        audit['prediction']!='UNVERIFIED' or audit['recommendation'] is not None or audit['verified'] is not False or
        audit['sourceIdentity']!=identity or not is_hash(audit['snapshotHash']) or
        not isinstance(audit['records'],list) or len(audit['records'])>500):
        raise EvidenceError('AUDIT_UNVERIFIED')
    day_bounds(audit['serviceDate'])
    timestamp(audit['observedAt'])
    seen=set();deliveries=unknown=0
    for r in audit['records']:
        if (not isinstance(r,dict) or set(r)!=RECORD_FIELDS or not is_hash(r['orderId']) or r['orderId'] in seen or
            r['observedStatus'] not in STATUSES or r['orderType'] not in ('delivery','collection','UNKNOWN') or
            r['targetBasis'] not in ('CONFIRMED','PROPOSED','PREFERRED') or
            r['deliveryFeeBand'] not in ('FREE','PAID','UNKNOWN') or
            r['coordinateEvidence'] not in ('PRESENT','MISSING_OR_INVALID') or
            type(r['inServiceDate']) is not bool or r['prediction']!='UNVERIFIED' or r['verified'] is not False or
            not isinstance(r['reasonCodes'],list) or any(not isinstance(code,str) or code not in REASONS for code in r['reasonCodes']) or
            len(set(r['reasonCodes']))!=len(r['reasonCodes'])):
            raise EvidenceError('RECORD_UNVERIFIED')
        minute=r['targetMinute']
        if (r['inServiceDate'] and (type(minute) is not int or not 0<=minute<1440)) or (not r['inServiceDate'] and minute is not None):
            raise EvidenceError('RECORD_TARGET_UNVERIFIED')
        seen.add(r['orderId'])
        active=r['observedStatus'] not in ('cancelled','customer_declined_time')
        if active and r['inServiceDate'] and r['orderType']=='delivery':
            required={'DIRECTIONAL_ROUTE_DURATIONS_UNAVAILABLE','COMPLETE_KITCHEN_PLAN_UNAVAILABLE','COMPLETE_DRIVER_PLAN_UNAVAILABLE'}
            if not required.issubset(r['reasonCodes']):
                raise EvidenceError('RECORD_EVIDENCE_GAPS_MISSING')
            deliveries+=1
        if (not active)!=('INACTIVE_SAVED_STATUS' in r['reasonCodes']):
            raise EvidenceError('RECORD_STATUS_MISMATCH')
        unknown+=r['orderType']=='UNKNOWN'
    if type(audit['deliveryOrders']) is not int or type(audit['unknownOrderTypes']) is not int or audit['deliveryOrders']!=deliveries or audit['unknownOrderTypes']!=unknown:
        raise EvidenceError('AUDIT_COUNTS_MISMATCH')
    return audit

def verify_database(db, identity, project):
    if db.execute('PRAGMA application_id').fetchone()[0]!=APPLICATION_ID or db.execute('PRAGMA user_version').fetchone()[0]!=VERSION:
        raise EvidenceError('UNSUPPORTED_EVIDENCE_JOURNAL')
    if db.execute('SELECT schema_version,source_identity,project_ref FROM delivery_meta WHERE id=1').fetchall()!=[(VERSION,identity,project)]:
        raise EvidenceError('EVIDENCE_SOURCE_MISMATCH')

class DeliveryEvidenceJournal:
    def __init__(self,path,identity,project,*,enabled=False):
        if enabled is not True:
            raise EvidenceError('DISABLED')
        if not is_hash(identity) or project not in PROJECTS:
            raise EvidenceError('EVIDENCE_SOURCE_REQUIRED')
        self.path=Path(path)
        if not self.path.is_absolute() or self.path.name!='delivery-evidence.sqlite3' or self.path.is_symlink() or Path(str(self.path)+'.lock').is_symlink():
            raise EvidenceError('DEDICATED_EVIDENCE_PATH_REQUIRED')
        self.identity,self.project,self.failed=identity,project,set()
        self.build=build_hash()
        self.path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        self.lock=open(str(self.path)+'.lock','a');os.chmod(str(self.path)+'.lock',0o600)
        try:
            fcntl.flock(self.lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            existed=self.path.exists()
            self.db=sqlite3.connect(self.path.as_uri()+('?mode=rw' if existed else '?mode=rwc'),uri=True,timeout=5)
            if existed:
                verify_database(self.db,identity,project)
            else:
                with self.db:
                    self.db.execute('CREATE TABLE delivery_meta(id INTEGER PRIMARY KEY CHECK(id=1),schema_version INTEGER NOT NULL,source_identity TEXT NOT NULL,project_ref TEXT NOT NULL)')
                    self.db.execute('INSERT INTO delivery_meta VALUES(1,?,?,?)',(VERSION,identity,project))
                    self.db.execute('CREATE TABLE evidence_states(key TEXT PRIMARY KEY,service_date TEXT NOT NULL,order_alias TEXT NOT NULL,build_hash TEXT NOT NULL,snapshot_hash TEXT NOT NULL,payload TEXT NOT NULL,first_seen REAL NOT NULL)')
                    self.db.execute('CREATE TABLE evidence_polls(id INTEGER PRIMARY KEY,service_date TEXT NOT NULL,polled_at REAL NOT NULL,source_observed_at REAL,status TEXT NOT NULL,reason TEXT NOT NULL,snapshot_hash TEXT,build_hash TEXT NOT NULL)')
                    self.db.execute('CREATE TABLE evidence_presence(service_date TEXT NOT NULL,order_alias TEXT NOT NULL,state_key TEXT NOT NULL REFERENCES evidence_states(key),PRIMARY KEY(service_date,order_alias))')
                    self.db.execute('CREATE TABLE evidence_transitions(id INTEGER PRIMARY KEY,poll_id INTEGER NOT NULL REFERENCES evidence_polls(id),order_alias TEXT NOT NULL,state_key TEXT REFERENCES evidence_states(key),kind TEXT NOT NULL CHECK(kind IN (\'OBSERVED\',\'MISSING\')))')
                    self.db.execute('CREATE INDEX evidence_poll_day ON evidence_polls(service_date,id)')
                    self.db.execute('PRAGMA application_id='+str(APPLICATION_ID))
                    self.db.execute('PRAGMA user_version='+str(VERSION))
            os.chmod(self.path,0o600)
            self.db.execute('PRAGMA journal_mode=WAL');self.db.execute('PRAGMA synchronous=FULL');self.db.execute('PRAGMA foreign_keys=ON')
        except Exception:
            self.close();raise

    def close(self):
        if hasattr(self,'db'):self.db.close()
        self.lock.close()

    def commit(self,audit,at):
        validate_audit(audit,self.identity)
        if not finite(at):raise EvidenceError('INVALID_POLL_CLOCK')
        observed=timestamp(audit['observedAt']).timestamp()
        if not -5<=at-observed<=180:raise EvidenceError('SOURCE_CLOCK_UNVERIFIED')
        day=audit['serviceDate']
        with self.db:
            previous=dict(self.db.execute('SELECT order_alias,state_key FROM evidence_presence WHERE service_date=?',(day,)))
            poll=self.db.execute("INSERT INTO evidence_polls(service_date,polled_at,source_observed_at,status,reason,snapshot_hash,build_hash) VALUES(?,?,?,'OBSERVED','SAVED_STATE_EVIDENCE_ONLY',?,?)",(day,at,observed,audit['snapshotHash'],self.build)).lastrowid
            current={}
            for record in audit['records']:
                payload=canonical(record)
                key=digest({'source':self.identity,'day':day,'build':self.build,'snapshot':audit['snapshotHash'],'record':record})
                found=self.db.execute('SELECT service_date,order_alias,build_hash,snapshot_hash,payload FROM evidence_states WHERE key=?',(key,)).fetchone()
                if found and found!=(day,record['orderId'],self.build,audit['snapshotHash'],payload):raise EvidenceError('EVIDENCE_CONTENT_CONFLICT')
                self.db.execute('INSERT OR IGNORE INTO evidence_states VALUES(?,?,?,?,?,?,?)',(key,day,record['orderId'],self.build,audit['snapshotHash'],payload,at))
                current[record['orderId']]=key
                if previous.get(record['orderId'])!=key:
                    self.db.execute("INSERT INTO evidence_transitions(poll_id,order_alias,state_key,kind) VALUES(?,?,?,'OBSERVED')",(poll,record['orderId'],key))
            for alias in previous.keys()-current.keys():
                # Disappearance is not a cancellation or proof of completion.
                self.db.execute("INSERT INTO evidence_transitions(poll_id,order_alias,state_key,kind) VALUES(?,?,NULL,'MISSING')",(poll,alias))
            self.db.execute('DELETE FROM evidence_presence WHERE service_date=?',(day,))
            self.db.executemany('INSERT INTO evidence_presence VALUES(?,?,?)',[(day,a,k) for a,k in current.items()])
        self.failed.discard(day)

    def failure(self,day,at,reason):
        day_bounds(day)
        self.failed.add(day)
        if not finite(at) or reason not in FAILURES:raise EvidenceError('INVALID_FAILURE_RECORD')
        with self.db:
            self.db.execute("INSERT INTO evidence_polls(service_date,polled_at,status,reason,build_hash) VALUES(?,?,'ERROR',?,?)",(day,at,reason,self.build))

    def health(self,days,at=None):
        result=evidence_health(self.path,self.identity,self.project,days,at=at)
        for day in days:
            if day in self.failed:
                result['perServiceDay'][day]={'healthy':False,'reason':'CURRENT_PROCESS_POLL_FAILED'}
        result['healthy']=bool(days) and all(v['healthy'] for v in result['perServiceDay'].values())
        return result

    def backup_to(self,destination):
        target=Path(destination)
        if not target.is_absolute() or target.exists() or target.is_symlink():raise EvidenceError('NEW_ABSOLUTE_BACKUP_PATH_REQUIRED')
        fd=os.open(target,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600);os.close(fd)
        backup=None
        try:
            backup=sqlite3.connect(target)
            self.db.backup(backup)
            if backup.execute('PRAGMA integrity_check').fetchone()!=('ok',):raise EvidenceError('BACKUP_INTEGRITY_FAILED')
            verify_database(backup,self.identity,self.project)
            backup.close();backup=None
            with target.open('rb') as file:os.fsync(file.fileno())
            fd=os.open(target.parent,os.O_RDONLY)
            try:os.fsync(fd)
            finally:os.close(fd)
        except Exception:
            if backup:backup.close()
            target.unlink(missing_ok=True);raise
        return target

def evidence_health(path,identity,project,days,*,at=None):
    result={'healthy':False,'assessmentScope':'SAVED_STATE_EVIDENCE_AUDIT_ONLY','verified':False,'perServiceDay':{}}
    db=None
    try:
        if not days or len(set(days))!=len(days) or not is_hash(identity) or project not in PROJECTS:raise EvidenceError('INVALID_HEALTH_SCOPE')
        for day in days:day_bounds(day)
        check=now() if at is None else at
        if not finite(check):raise EvidenceError('INVALID_POLL_CLOCK')
        db=sqlite3.connect(Path(path).as_uri()+'?mode=ro',uri=True,timeout=2)
        db.execute('PRAGMA query_only=ON');verify_database(db,identity,project)
        for day in days:
            row=db.execute('SELECT polled_at,source_observed_at,status FROM evidence_polls WHERE service_date=? ORDER BY id DESC LIMIT 1',(day,)).fetchone()
            okay=bool(row and row[2]=='OBSERVED' and 0<=check-row[0]<=180 and row[1] is not None and -5<=check-row[1]<=180)
            result['perServiceDay'][day]={'healthy':okay,'reason':'SOURCE_HEALTHY' if okay else 'MISSING_FAILED_OR_STALE_POLL'}
        result['healthy']=all(v['healthy'] for v in result['perServiceDay'].values())
    except (ValueError,TypeError,OSError,sqlite3.Error,EvidenceError):
        result['perServiceDay']={day:{'healthy':False,'reason':'JOURNAL_UNAVAILABLE'} for day in days or []}
    finally:
        if db:db.close()
    return result

def run_audit(snapshot):
    script="const fs=require('fs');process.stdout.write(JSON.stringify(require('./master-wok-delivery-evidence-audit').auditDeliveryEvidence(JSON.parse(fs.readFileSync(0,'utf8')),{enabled:true})))"
    data=canonical(snapshot)
    if len(data.encode())>5_000_000:raise EvidenceError('INPUT_LIMIT')
    result=subprocess.run(['node','-e',script],cwd=ROOT,input=data,text=True,capture_output=True,timeout=15,
                          env={k:v for k,v in os.environ.items() if k in ('PATH','TZ','LANG')},check=True)
    if len(result.stdout.encode())>1_000_000:raise EvidenceError('OUTPUT_LIMIT')
    return json.loads(result.stdout)

def poll_evidence(journal,day,reader,*,enabled=False,assessor=run_audit,clock=now):
    if enabled is not True:return {'status':'DISABLED','verified':False}
    phase='SOURCE_FAILED'
    try:
        day_bounds(day)
        snapshot=reader()
        if (not isinstance(snapshot,dict) or snapshot.get('projectRef')!=journal.project or
            snapshot.get('sourceRole')!='supabase_read_only_user' or snapshot.get('serviceDate')!=day):
            raise EvidenceError('SOURCE_SCOPE_MISMATCH')
        phase='AUDIT_FAILED'
        audit=assessor(snapshot)
        if audit.get('serviceDate')!=day:raise EvidenceError('SERVICE_DATE_MISMATCH')
        validate_audit(audit,journal.identity)
        phase='JOURNAL_FAILED'
        journal.commit(audit,clock())
        return {'status':'OBSERVED','prediction':'UNVERIFIED','verified':False}
    except Exception as error:
        reason='SOURCE_CLOCK_UNVERIFIED' if isinstance(error,EvidenceError) and str(error)=='SOURCE_CLOCK_UNVERIFIED' else phase
        try:journal.failure(day,clock(),reason)
        except Exception:journal.failed.add(day)
        return {'status':'POLL_FAILED','reasonCode':reason,'verified':False}
