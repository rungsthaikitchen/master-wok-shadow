"""Optional off-volume copies of redacted delivery evidence. No source API access."""
from dataclasses import dataclass, field
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import tempfile
import threading
import time
from urllib.parse import urlsplit
import uuid

from delivery_evidence_journal import EvidenceError, verify_database

SOURCE_PATH='/data/master-wok-delivery-evidence/delivery-evidence.sqlite3'
PROJECT='ubyjrrsvbbqomitpaidb'
PREFIX='delivery-evidence/v1/'
MAX_BYTES=50_000_000
INTERVAL=3600
RETRY=300
MAX_AGE=7200

@dataclass(frozen=True)
class BackupConfig:
    endpoint:str
    bucket:str
    region:str
    access_key:str=field(repr=False)
    secret_key:str=field(repr=False)
    style:str='virtual'

def configuration(env):
    if env.get('MASTER_WOK_EVIDENCE_BACKUP_ENABLED')!='true':return None
    scope={'RAILWAY_PROJECT_ID':'7821ad5b-f5c2-4ab4-9206-c3d76eefd4c8',
           'RAILWAY_ENVIRONMENT_ID':'b61e66e7-dbaa-4343-9ca6-5e6f0f5d7612',
           'RAILWAY_ENVIRONMENT_NAME':'master-wok-production-shadow',
           'RAILWAY_SERVICE_NAME':'master-wok-delivery-evidence-production',
           'RAILWAY_VOLUME_MOUNT_PATH':'/data',
           'MASTER_WOK_DELIVERY_EVIDENCE_ENABLED':'true'}
    if any(env.get(k)!=v for k,v in scope.items()):raise EvidenceError('BACKUP_SCOPE_REQUIRED')
    return storage_configuration(env)

def storage_configuration(env):
    endpoint=env.get('MASTER_WOK_BACKUP_ENDPOINT','')
    u=urlsplit(endpoint)
    if (u.scheme!='https' or not u.hostname or not re.fullmatch(r'[a-z0-9-]+\.storageapi\.dev',u.hostname)
        or u.netloc!=u.hostname or u.path not in ('','/') or u.query or u.fragment):
        raise EvidenceError('RAILWAY_BUCKET_ENDPOINT_REQUIRED')
    bucket=env.get('MASTER_WOK_BACKUP_BUCKET','')
    region=env.get('MASTER_WOK_BACKUP_REGION','')
    access=env.get('MASTER_WOK_BACKUP_ACCESS_KEY_ID','')
    secret=env.get('MASTER_WOK_BACKUP_SECRET_ACCESS_KEY','')
    style=env.get('MASTER_WOK_BACKUP_URL_STYLE','virtual')
    if (not re.fullmatch(r'[a-z0-9][a-z0-9-]{1,61}[a-z0-9]',bucket) or not region or
        not access or not secret or style not in ('virtual','path')):
        raise EvidenceError('BACKUP_CREDENTIALS_REQUIRED')
    return BackupConfig(endpoint,bucket,region,access,secret,style)

def s3_client(config):
    # Import only after the default-off gate; no credential discovery / metadata calls.
    import boto3
    from botocore.config import Config
    return boto3.client('s3',endpoint_url=config.endpoint,region_name=config.region,
        aws_access_key_id=config.access_key,aws_secret_access_key=config.secret_key,
        config=Config(connect_timeout=5,read_timeout=15,retries={'mode':'standard','total_max_attempts':2},
          s3={'addressing_style':config.style},request_checksum_calculation='when_required',
          response_checksum_validation='when_required'))

def verify_snapshot(path,identity,project):
    db=sqlite3.connect(Path(path).as_uri()+'?mode=ro',uri=True,timeout=2)
    try:
        db.execute('PRAGMA query_only=ON')
        verify_database(db,identity,project)
        if db.execute('PRAGMA integrity_check').fetchall()!=[('ok',)]:raise EvidenceError('BACKUP_INTEGRITY_FAILED')
        if db.execute('PRAGMA foreign_key_check').fetchone():raise EvidenceError('BACKUP_RELATIONS_FAILED')
        counts={table:db.execute('SELECT count(*) FROM '+table).fetchone()[0]
                for table in ('evidence_states','evidence_polls','evidence_presence','evidence_transitions')}
        if not counts['evidence_polls']:raise EvidenceError('EMPTY_EVIDENCE_BACKUP')
        return counts
    finally:db.close()

def snapshot(source,target,identity,project):
    source=Path(source);target=Path(target)
    if source.is_symlink() or not source.is_file():raise EvidenceError('BACKUP_SOURCE_UNAVAILABLE')
    fd=os.open(target,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600);os.close(fd)
    reader=writer=None
    deadline=time.monotonic()+30
    def progress(status,remaining,total):
        if time.monotonic()>deadline:raise EvidenceError('BACKUP_SNAPSHOT_TIMEOUT')
    try:
        reader=sqlite3.connect(source.as_uri()+'?mode=ro',uri=True,timeout=2)
        reader.execute('PRAGMA query_only=ON');verify_database(reader,identity,project)
        writer=sqlite3.connect(target)
        reader.backup(writer,pages=128,progress=progress,sleep=0.05)
    finally:
        if writer:writer.close()
        if reader:reader.close()
    if not 0<target.stat().st_size<=MAX_BYTES:raise EvidenceError('BACKUP_SIZE_LIMIT')
    return verify_snapshot(target,identity,project)

def restore_download(client,bucket,key,destination,expected_hash,identity,project):
    """Download/verify to a NEW scratch file only. Never replace a live database."""
    if not re.fullmatch(r'delivery-evidence/v1/[a-f0-9]{64}/[0-9TZ-]+-[a-f0-9]{32}\.sqlite3',key):
        raise EvidenceError('BACKUP_KEY_REFUSED')
    if not re.fullmatch('[a-f0-9]{64}',expected_hash):raise EvidenceError('BACKUP_CHECKSUM_REQUIRED')
    target=Path(destination)
    if not target.is_absolute() or target.exists() or target.is_symlink():raise EvidenceError('NEW_RESTORE_PATH_REQUIRED')
    response=client.get_object(Bucket=bucket,Key=key)
    body=response['Body']
    try:
        data=body.read(MAX_BYTES+1)
        if len(data)>MAX_BYTES or hashlib.sha256(data).hexdigest()!=expected_hash:
            raise EvidenceError('BACKUP_READBACK_MISMATCH')
        fd=os.open(target,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
        with os.fdopen(fd,'wb') as output:output.write(data)
        try:return verify_snapshot(target,identity,project)
        except Exception:target.unlink(missing_ok=True);raise
    finally:body.close()

class BackupWorker:
    def __init__(self,config,identity,*,source=SOURCE_PATH,project=PROJECT,client_factory=s3_client,
                 clock=time.time,emit=None):
        self.config,self.identity,self.source,self.project=config,identity,source,project
        self.client_factory,self.clock,self.emit=client_factory,clock,emit
        self.last_success=None;self.failed=False
        self.lock=threading.Lock();self.stop=threading.Event();self.thread=None

    def healthy(self):
        with self.lock:
            if self.failed:return False
            if self.last_success is None:return False
            return 0<=self.clock()-self.last_success<=MAX_AGE

    def run_once(self):
        client=None
        try:
            with tempfile.TemporaryDirectory(prefix='mw-evidence-backup-') as directory:
                path=Path(directory)/'snapshot.sqlite3'
                counts=snapshot(self.source,path,self.identity,self.project)
                data=path.read_bytes();checksum=hashlib.sha256(data).hexdigest()
                stamp=datetime.fromtimestamp(self.clock(),timezone.utc).strftime('%Y-%m-%dT%H-%M-%SZ')
                key=PREFIX+self.identity+'/'+stamp+'-'+uuid.uuid4().hex+'.sqlite3'
                client=self.client_factory(self.config)
                client.put_object(Bucket=self.config.bucket,Key=key,Body=data,ContentType='application/vnd.sqlite3',
                                  Metadata={'sha256':checksum,'format':'master-wok-delivery-evidence-v1'})
                restored=restore_download(client,self.config.bucket,key,Path(directory)/'restored.sqlite3',checksum,self.identity,self.project)
                if restored!=counts:raise EvidenceError('BACKUP_RESTORE_COUNTS_MISMATCH')
                # Publish a manifest only AFTER successful independent readback.
                manifest={'format':'master-wok-delivery-evidence-v1','key':key,'sha256':checksum,
                          'sourceIdentity':self.identity,'project':self.project,'bytes':len(data),'counts':counts}
                client.put_object(Bucket=self.config.bucket,Key=key+'.json',
                                  Body=json.dumps(manifest,sort_keys=True).encode(),ContentType='application/json')
                with self.lock:self.last_success=self.clock();self.failed=False
                event={'status':'BACKUP_VERIFIED','bytes':len(data),'verifiedRestore':True}
        except Exception:
            with self.lock:self.failed=True
            event={'status':'BACKUP_FAILED','reasonCode':'OFF_VOLUME_BACKUP_FAILED','verifiedRestore':False}
        finally:
            if client:
                try:client.close()
                except Exception:pass
        if self.emit:self.emit(event)
        return event

    def start(self):
        def work():
            while not self.stop.is_set():
                result=self.run_once()
                self.stop.wait(INTERVAL if result['status']=='BACKUP_VERIFIED' else RETRY)
        self.thread=threading.Thread(target=work,name='evidence-backup',daemon=True);self.thread.start()

    def close(self):
        self.stop.set()
        if self.thread:self.thread.join(timeout=2)
