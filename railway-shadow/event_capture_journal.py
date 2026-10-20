"""Default-off synthetic staging inbox and durable replay results. No source API."""
import fcntl
import copy
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import time
import uuid
from shadow_collector import timestamp

ROOT=Path(__file__).resolve().parent.parent
APP_ID=0x4D574556
SCOPE='SYNTHETIC_STAGING_EVENTS'
OBS_FIELDS={'eventId','sequence','orderId','decisionAt','actualDecision','prediction',
    'reasonCode','priorCommitments','priorProposed','kitchenReadyMinute','verified'}
REASONS={'DELIVERY_READY_ESTIMATE_REQUIRED','ASSESSMENT_CLOCK_TIE_UNSUPPORTED','HYPOTHETICAL_REPLAY',
    'REPLAY_UNVERIFIED','SNAPSHOT_TOO_LARGE','SERVICE_TIMEZONE_REQUIRED',
    'ASSESSMENT_INPUT_OR_SEARCH_ERROR','SNAPSHOT_UNVERIFIED','ASSESSMENT_UNVERIFIED'}

class EventCaptureError(Exception):pass

def canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False)
def digest(value):return hashlib.sha256(canonical(value).encode()).hexdigest()
def prefix_digests(events):
    h=hashlib.sha256(b'[');result={}
    for index,event in enumerate(events):
        if index:h.update(b',')
        h.update(canonical(event).encode());prefix=h.copy();prefix.update(b']')
        result[event['sequence']]=prefix.hexdigest()
    return result

def build_hash():
    h=hashlib.sha256()
    files=sorted(p for p in ROOT.glob('master-wok*') if p.suffix in {'.js','.json'} and not p.name.endswith('.test.js'))
    for p in files+[Path(__file__),Path(__file__).with_name('event_capture_staging.py')]:
        if p.exists():h.update(p.name.encode()+b'\0'+p.read_bytes())
    return h.hexdigest()

def invoke_node(batch,*,validate_only=False):
    env={k:v for k,v in os.environ.items() if k in {'PATH','LANG'}}
    env.update(TZ='Europe/London',MASTER_WOK_EVENT_REPLAY_ENABLED='true')
    if validate_only:env['MASTER_WOK_EVENT_VALIDATE_ONLY']='true'
    result=subprocess.run(['node',str(ROOT/'master-wok-chronological-replay.js')],
        input=canonical(batch),capture_output=True,text=True,timeout=35,env=env)
    if result.returncode or len(result.stdout.encode())>1_000_000:
        raise EventCaptureError('EVENT_REPLAY_REFUSED')
    return json.loads(result.stdout)

class EventCaptureJournal:
    def __init__(self,path,identity,*,enabled=False,scope=SCOPE,clock=time.time):
        if enabled is not True:raise EventCaptureError('DISABLED')
        self.path=Path(path);self.identity=identity;self.clock=clock
        if (scope!=SCOPE or not isinstance(identity,str) or not re.fullmatch('[a-f0-9]{64}',identity) or not self.path.is_absolute() or
            self.path.name!='event-capture.sqlite3' or self.path.parent.is_symlink() or
            self.path.is_symlink() or Path(str(self.path)+'.lock').is_symlink()):
            raise EventCaptureError('DEDICATED_STAGING_EVENT_STORE_REQUIRED')
        self.path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
        self.lock=open(str(self.path)+'.lock','a');os.chmod(str(self.path)+'.lock',0o600)
        try:
            fcntl.flock(self.lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            existed=self.path.exists()
            self.db=sqlite3.connect(self.path)
            if existed:
                if (self.db.execute('PRAGMA application_id').fetchone()[0]!=APP_ID or
                    self.db.execute('PRAGMA user_version').fetchone()[0]!=1 or
                    self.db.execute('SELECT identity,scope FROM meta').fetchall()!=[(identity,SCOPE)]):
                    raise EventCaptureError('EVENT_STORE_IDENTITY_MISMATCH')
            else:
                with self.db:
                    self.db.execute('CREATE TABLE meta(identity TEXT,scope TEXT)')
                    self.db.execute('INSERT INTO meta VALUES (?,?)',(identity,SCOPE))
                    self.db.execute('CREATE TABLE events(sequence INTEGER PRIMARY KEY,event_id TEXT UNIQUE,payload TEXT NOT NULL)')
                    self.db.execute('CREATE TABLE batches(key TEXT PRIMARY KEY,payload TEXT NOT NULL,build_hash TEXT NOT NULL,state TEXT NOT NULL,token TEXT,lease_until REAL,attempts INTEGER NOT NULL DEFAULT 0)')
                    self.db.execute('CREATE TABLE observations(key TEXT PRIMARY KEY,payload TEXT NOT NULL,payload_hash TEXT NOT NULL)')
                    self.db.execute('CREATE TABLE stream_meta(service_date TEXT NOT NULL,through_at REAL NOT NULL)')
                    self.db.execute('CREATE TABLE members(batch_key TEXT REFERENCES batches(key),observation_key TEXT REFERENCES observations(key),PRIMARY KEY(batch_key,observation_key))')
                    self.db.execute('PRAGMA application_id='+str(APP_ID));self.db.execute('PRAGMA user_version=1')
            os.chmod(self.path,0o600)
            self.db.execute('PRAGMA foreign_keys=ON');self.db.execute('PRAGMA journal_mode=WAL');self.db.execute('PRAGMA synchronous=FULL')
        except Exception:self.close();raise

    def close(self):
        if hasattr(self,'db'):self.db.close()
        if hasattr(self,'lock'):self.lock.close()

    def now(self):
        now=self.clock()
        if type(now) not in (int,float) or not math.isfinite(now):raise EventCaptureError('CLOCK_REQUIRED')
        return now

    def enqueue(self,batch):
        if isinstance(batch,dict) and isinstance(batch.get('events'),list) and any(isinstance(e,dict) and e.get('kind') in ('RESERVATION_TRANSFERRED_IN','RESERVATION_TRANSFERRED_OUT') for e in batch['events']):raise EventCaptureError('TRANSFER_BUNDLE_REQUIRED')
        # Validation only: no kitchen assessment in the intake path. The caller
        # must run this in a background staging adapter, never await in checkout.
        if len(canonical(batch).encode())>5_000_000:raise EventCaptureError('BATCH_TOO_LARGE')
        receipt=invoke_node(batch,validate_only=True)
        if receipt!={'status':'VALIDATED','eventCount':len(batch['events']),'serviceDate':batch['serviceDate']}:
            raise EventCaptureError('VALIDATED_EVENT_BATCH_REQUIRED')
        batch=dict(batch,events=sorted(batch['events'],key=lambda e:e['sequence']))
        build=build_hash();key=digest(dict(batch=batch,buildHash=build,sourceIdentity=self.identity,scope=SCOPE))
        with self.db:
            old=self.db.execute('SELECT payload FROM batches WHERE key=?',(key,)).fetchone()
            if old:
                if old[0]!=canonical(batch):raise EventCaptureError('BATCH_CONTENT_CONFLICT')
                return dict(status='ALREADY_QUEUED',batchKey=key)
            if self.db.execute('SELECT count(*) FROM batches').fetchone()[0]>=16:raise EventCaptureError('STAGING_BATCH_LIMIT_REACHED')
            stream=self.db.execute('SELECT service_date,through_at FROM stream_meta').fetchone()
            if stream and stream[0]!=batch['serviceDate']:raise EventCaptureError('SERVICE_STREAM_MISMATCH')
            count=self.db.execute('SELECT count(*) FROM events').fetchone()[0]
            if stream and len(batch['events'])>count and timestamp(batch['events'][count]['at']).timestamp()<stream[1]:
                raise EventCaptureError('COVERAGE_WATERMARK_CONFLICT')
            through=timestamp(batch['coverage']['throughAt']).timestamp()
            if not stream:self.db.execute('INSERT INTO stream_meta VALUES (?,?)',(batch['serviceDate'],through))
            elif through>stream[1]:self.db.execute('UPDATE stream_meta SET through_at=?',(through,))
            # Earlier captured events are immutable. A later saved-state rewrite
            # can never silently replace previously captured decision evidence.
            for event in batch['events']:
                prior=self.db.execute('SELECT event_id,payload FROM events WHERE sequence=?',(event['sequence'],)).fetchone()
                if prior and prior!=(event['eventId'],canonical(event)):raise EventCaptureError('CAPTURED_HISTORY_CONFLICT')
                self.db.execute('INSERT OR IGNORE INTO events VALUES (?,?,?)',(event['sequence'],event['eventId'],canonical(event)))
            self.db.execute("INSERT INTO batches(key,payload,build_hash,state) VALUES (?,?,?,'PENDING')",(key,canonical(batch),build))
        return dict(status='QUEUED',batchKey=key)

    def claim(self):
        now=self.now();token=uuid.uuid4().hex
        with self.db:
            self.db.execute("UPDATE batches SET state='FAILED',token=NULL,lease_until=NULL WHERE attempts>=3 AND (state='PENDING' OR (state='LEASED' AND lease_until<=?))",(now,))
            row=self.db.execute("SELECT key,payload,build_hash FROM batches WHERE attempts<3 AND (state='PENDING' OR (state='LEASED' AND lease_until<=?)) ORDER BY rowid LIMIT 1",(now,)).fetchone()
            if not row:return None
            self.db.execute("UPDATE batches SET state='LEASED',token=?,lease_until=?,attempts=attempts+1 WHERE key=?",(token,now+60,row[0]))
        batch=json.loads(row[1])
        if digest(dict(batch=batch,buildHash=row[2],sourceIdentity=self.identity,scope=SCOPE))!=row[0]:raise EventCaptureError('BATCH_HASH_MISMATCH')
        return dict(key=row[0],batch=batch,buildHash=row[2],token=token)

    def complete(self,message,result,*,before_commit=lambda:None):
        batch=message['batch']
        if any(e['kind'] in ('RESERVATION_TRANSFERRED_IN','RESERVATION_TRANSFERRED_OUT') for e in batch['events']):raise EventCaptureError('TRANSFER_BUNDLE_REQUIRED')
        decisions=[e for e in batch['events'] if e['kind'] in ('BOOKING_DECISION','RESERVATION_TRANSFERRED_IN')]
        if (not isinstance(result,dict) or result.get('status')!='REPLAYED' or result.get('verified') is not False or
            result.get('networkRequests')!=0 or result.get('serviceDate')!=batch['serviceDate'] or
            result.get('evidenceBasis')!='RECORDED_EVENTS_WITH_HYPOTHETICAL_KITCHEN_ASSESSMENTS' or
            result.get('coverageThroughAt')!=batch['coverage']['throughAt'] or result.get('decisionCount')!=len(decisions) or
            len(result.get('observations',[]))!=len(decisions)):
            raise EventCaptureError('REPLAY_RESULT_BINDING_REQUIRED')
        records=[];prefixes=prefix_digests(batch['events'])
        for event,observation in zip(decisions,result['observations']):
            if (set(observation)!=OBS_FIELDS or observation['verified'] is not False or
                any(observation[k]!=event[k] for k in ['eventId','sequence']) or observation['orderId']!=event['order']['orderId'] or
                observation['decisionAt']!=event['at'] or observation['actualDecision']!=event['actualDecision'] or
                observation['prediction'] not in {'GREEN','AMBER','UNVERIFIED'} or observation['reasonCode'] not in REASONS or
                any(type(observation[k]) is not int or not 0<=observation[k]<=1000 for k in ['sequence','priorCommitments','priorProposed']) or
                observation['priorProposed']>observation['priorCommitments'] or
                (observation['kitchenReadyMinute'] is not None and
                 (type(observation['kitchenReadyMinute']) not in (int,float) or not math.isfinite(observation['kitchenReadyMinute']) or not 990<=observation['kitchenReadyMinute']<=1320))):
                raise EventCaptureError('REDACTED_OBSERVATION_REQUIRED')
            record=dict(observation,sourceIdentity=self.identity,scope=SCOPE,buildHash=message['buildHash'],
                sourcePrefixHash=prefixes[event['sequence']])
            key=digest(dict(identity=self.identity,buildHash=message['buildHash'],eventId=event['eventId']))
            records.append((key,canonical(record)))
        with self.db:
            row=self.db.execute('SELECT state,token,lease_until,payload,build_hash FROM batches WHERE key=?',(message['key'],)).fetchone()
            if row is None or row[0]!='LEASED' or row[1]!=message['token'] or row[2]<=self.now():raise EventCaptureError('ACTIVE_LEASE_REQUIRED')
            if row[3]!=canonical(message['batch']) or row[4]!=message['buildHash']:raise EventCaptureError('LEASE_CONTENT_BINDING_REQUIRED')
            if message['buildHash']!=build_hash():raise EventCaptureError('REPLAY_BUILD_CHANGED')
            for key,payload in records:
                old=self.db.execute('SELECT payload FROM observations WHERE key=?',(key,)).fetchone()
                if old and old[0]!=payload:raise EventCaptureError('OBSERVATION_HISTORY_CONFLICT')
                self.db.execute('INSERT OR IGNORE INTO observations VALUES (?,?,?)',(key,payload,digest(json.loads(payload))))
                self.db.execute('INSERT OR IGNORE INTO members VALUES (?,?)',(message['key'],key))
            self.db.execute("UPDATE batches SET state='ACKED',token=NULL,lease_until=NULL WHERE key=?",(message['key'],))
            before_commit()
        return dict(status='RECORDED',observations=len(records),verified=False,networkRequests=0)

    def summary(self):
        counts=verify_store(self.db,self.identity)
        states=dict(self.db.execute('SELECT state,count(*) FROM batches GROUP BY state'))
        matrix={}
        for payload, in self.db.execute('SELECT payload FROM observations'):
            row=json.loads(payload);key=row['prediction']+'/'+row['actualDecision']
            matrix[key]=matrix.get(key,0)+1
        return dict(scope=SCOPE,verified=False,counts=counts,batchStates=states,
            hypotheticalVsRecordedDecision=matrix,failed=states.get('FAILED',0)>0)

    def run_once(self,*,enabled=False,invoke=invoke_node,before_commit=lambda:None):
        if enabled is not True:return dict(status='DISABLED',networkRequests=0)
        message=None
        try:
            message=self.claim()
            if message is None:return dict(status='IDLE',networkRequests=0)
            return self.complete(message,invoke(copy.deepcopy(message['batch'])),before_commit=before_commit)
        except Exception:
            if message:
                with self.db:self.db.execute("UPDATE batches SET state=CASE WHEN attempts>=3 THEN 'FAILED' ELSE 'PENDING' END,token=NULL,lease_until=NULL WHERE key=? AND token=?",(message['key'],message['token']))
            return dict(status='UNVERIFIED',reasonCode='EVENT_WORKER_FAILED',verified=False,networkRequests=0)


def verify_store(db,identity):
    if (db.execute('PRAGMA application_id').fetchone()[0]!=APP_ID or
        db.execute('PRAGMA user_version').fetchone()[0]!=1 or
        db.execute('SELECT identity,scope FROM meta').fetchall()!=[(identity,SCOPE)] or
        db.execute('PRAGMA integrity_check').fetchone()!=('ok',) or db.execute('PRAGMA foreign_key_check').fetchall()):
        raise EventCaptureError('EVENT_SNAPSHOT_UNVERIFIED')
    expected_events={};batches={}
    for key,payload,build in db.execute('SELECT key,payload,build_hash FROM batches'):
        if digest(dict(batch=json.loads(payload),buildHash=build,sourceIdentity=identity,scope=SCOPE))!=key:
            raise EventCaptureError('BATCH_HASH_MISMATCH')
        batches[key]=(json.loads(payload),build)
        for event in json.loads(payload)['events']:
            row=(event['eventId'],canonical(event))
            if event['sequence'] in expected_events and expected_events[event['sequence']]!=row:
                raise EventCaptureError('CAPTURED_HISTORY_CONFLICT')
            expected_events[event['sequence']]=row
    if {sequence:(event_id,payload) for sequence,event_id,payload in db.execute('SELECT sequence,event_id,payload FROM events')}!=expected_events:
        raise EventCaptureError('EVENT_CONTENT_MISMATCH')
    for key,payload,sha in db.execute('SELECT key,payload,payload_hash FROM observations'):
        value=json.loads(payload)
        if (digest(value)!=sha or value.get('sourceIdentity')!=identity or value.get('scope')!=SCOPE or
            key!=digest(dict(identity=identity,buildHash=value.get('buildHash'),eventId=value.get('eventId')))):
            raise EventCaptureError('OBSERVATION_HASH_MISMATCH')
    prefixes={key:prefix_digests(batch['events']) for key,(batch,build) in batches.items()}
    for batch_key,payload in db.execute('SELECT m.batch_key,o.payload FROM members m JOIN observations o ON o.key=m.observation_key'):
        value=json.loads(payload);batch,build=batches[batch_key]
        sequence=value['sequence']
        if type(sequence) is not int or not 1<=sequence<=len(batch['events']):raise EventCaptureError('MEMBER_BINDING_REQUIRED')
        event=batch['events'][sequence-1]
        if (event['kind'] not in ('BOOKING_DECISION','RESERVATION_TRANSFERRED_IN') or value['eventId']!=event['eventId'] or value['buildHash']!=build or
            value['orderId']!=event['order']['orderId'] or value['decisionAt']!=event['at'] or
            value['actualDecision']!=event['actualDecision'] or value['sourcePrefixHash']!=prefixes[batch_key][sequence]):
            raise EventCaptureError('MEMBER_BINDING_REQUIRED')
    return {t:db.execute('SELECT count(*) FROM '+t).fetchone()[0] for t in ['events','batches','observations','members']}


def snapshot(journal,destination):
    dest=Path(destination)
    if not dest.is_absolute() or dest.exists() or dest.is_symlink() or dest.parent.is_symlink():
        raise EventCaptureError('NEW_SNAPSHOT_PATH_REQUIRED')
    counts=verify_store(journal.db,journal.identity)
    fd=os.open(dest,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600);os.close(fd)
    target=None
    try:
        target=sqlite3.connect(dest);journal.db.backup(target)
        if verify_store(target,journal.identity)!=counts:raise EventCaptureError('SNAPSHOT_COUNTS_MISMATCH')
        target.close();target=None
        with dest.open('rb') as handle:os.fsync(handle.fileno())
        return dict(status='LOCAL_BACKUP_VERIFIED',sha256=hashlib.sha256(dest.read_bytes()).hexdigest(),counts=counts)
    except Exception:
        if target:target.close()
        dest.unlink(missing_ok=True);raise


def restore_snapshot(source,destination,identity,sha256):
    src=Path(source);dest=Path(destination)
    if (not src.is_absolute() or src.is_symlink() or not src.is_file() or src.stat().st_size>100_000_000 or
        not dest.is_absolute() or dest.exists() or dest.is_symlink() or dest.parent.is_symlink()):
        raise EventCaptureError('NEW_RESTORE_PATH_REQUIRED')
    if hashlib.sha256(src.read_bytes()).hexdigest()!=sha256:raise EventCaptureError('RESTORE_HASH_MISMATCH')
    reader=sqlite3.connect(src.as_uri()+'?mode=ro',uri=True)
    try:
        counts=verify_store(reader,identity)
        fd=os.open(dest,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600);os.close(fd)
        target=None
        try:
            target=sqlite3.connect(dest);reader.backup(target)
            if verify_store(target,identity)!=counts:raise EventCaptureError('RESTORE_COUNTS_MISMATCH')
            target.close();target=None
            with dest.open('rb') as handle:os.fsync(handle.fileno())
            return counts
        except Exception:
            if target:target.close()
            dest.unlink(missing_ok=True);raise
    finally:reader.close()
