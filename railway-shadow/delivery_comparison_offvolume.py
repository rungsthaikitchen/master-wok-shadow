"""Default-off verified comparison backup transport; no source API access."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sqlite3
import tempfile
import threading
import time
import uuid
from delivery_evidence_backup import storage_configuration, s3_client
from delivery_comparison_backup import verify
from delivery_comparison_journal import ComparisonError, SCOPES
from delivery_evidence_journal import is_hash
from delivery_comparison_worker import IDENTITY

SOURCE=Path('/data/master-wok-comparison/delivery-comparison.sqlite3')
MAX_BYTES=50_000_000


def configuration(env):
    if env.get('MASTER_WOK_COMPARISON_BACKUP_ENABLED')!='true':return None
    required={'RAILWAY_PROJECT_ID':'7821ad5b-f5c2-4ab4-9206-c3d76eefd4c8',
      'RAILWAY_ENVIRONMENT_ID':'c1b8fad6-dbfc-4188-b4b5-a5dbfbf53279',
      'RAILWAY_SERVICE_NAME':'master-wok-comparison-staging',
      'RAILWAY_VOLUME_MOUNT_PATH':'/data','MASTER_WOK_COMPARISON_STAGING_ENABLED':'true',
      'MASTER_WOK_COMPARISON_JOURNAL':str(SOURCE)}
    if any(env.get(k)!=v for k,v in required.items()):raise ComparisonError('BACKUP_STAGING_SCOPE_REQUIRED')
    return storage_configuration(env)


class ComparisonBackup:
    def __init__(self,config,*,source=SOURCE,client_factory=s3_client,clock=time.time,
                 identity=IDENTITY,scope='SYNTHETIC_STAGING'):
        if not is_hash(identity) or scope not in SCOPES:
            raise ComparisonError('BACKUP_IDENTITY_REQUIRED')
        self.identity,self.scope=identity,scope
        self.config,self.source,self.client_factory,self.clock=config,Path(source),client_factory,clock
        self.last_success=None;self.failed=False;self.lock=threading.Lock()
        self.stop=threading.Event();self.thread=None

    def healthy(self):
        with self.lock:
            return not self.failed and self.last_success is not None and 0<=self.clock()-self.last_success<=7200

    def run_once(self):
        client=reader=target=None
        try:
            if self.source.is_symlink() or not self.source.is_file():raise ComparisonError('SOURCE_UNAVAILABLE')
            with tempfile.TemporaryDirectory(prefix='mw-comparison-backup-') as folder:
                path=Path(folder)/'snapshot.sqlite3'
                reader=sqlite3.connect(self.source.as_uri()+'?mode=ro',uri=True,timeout=2)
                reader.execute('PRAGMA query_only=ON');verify(reader,self.identity,self.scope)
                target=sqlite3.connect(path)
                deadline=time.monotonic()+30
                def progress(*_):
                    if time.monotonic()>deadline:raise ComparisonError('SNAPSHOT_TIMEOUT')
                reader.backup(target,pages=256,progress=progress,sleep=0.01)
                counts=verify(target,self.identity,self.scope)
                target.close();target=None;reader.close();reader=None
                if not counts['observation_events'] or path.stat().st_size>MAX_BYTES:raise ComparisonError('SNAPSHOT_SIZE_UNVERIFIED')
                data=path.read_bytes();sha=hashlib.sha256(data).hexdigest()
                stamp=datetime.fromtimestamp(self.clock(),timezone.utc).strftime('%Y%m%dT%H%M%SZ')
                prefix='delivery-comparison/v1/'
                if self.scope!='SYNTHETIC_STAGING':prefix+=self.scope+'/'
                key=prefix+self.identity+'/'+stamp+'-'+uuid.uuid4().hex+'.sqlite3'
                client=self.client_factory(self.config)
                client.put_object(Bucket=self.config.bucket,Key=key,Body=data,ContentType='application/vnd.sqlite3')
                body=client.get_object(Bucket=self.config.bucket,Key=key)['Body']
                try:downloaded=body.read(MAX_BYTES+1)
                finally:body.close()
                if len(downloaded)>MAX_BYTES or hashlib.sha256(downloaded).hexdigest()!=sha:raise ComparisonError('READBACK_HASH_MISMATCH')
                restored=Path(folder)/'restored.sqlite3';restored.write_bytes(downloaded)
                check=sqlite3.connect(restored.as_uri()+'?mode=ro',uri=True)
                try:
                    if verify(check,self.identity,self.scope)!=counts:raise ComparisonError('READBACK_COUNTS_MISMATCH')
                finally:check.close()
                manifest={'format':'master-wok-comparison-v1','key':key,'sha256':sha,'sourceIdentity':self.identity,
                          'scope':self.scope,'bytes':len(data),'counts':counts}
                client.put_object(Bucket=self.config.bucket,Key=key+'.json',Body=json.dumps(manifest,sort_keys=True).encode(),ContentType='application/json')
                with self.lock:self.last_success=self.clock();self.failed=False
                return {'status':'BACKUP_VERIFIED','verifiedRestore':True,'bytes':len(data)}
        except Exception:
            with self.lock:self.failed=True
            return {'status':'BACKUP_FAILED','verifiedRestore':False,'reasonCode':'COMPARISON_BACKUP_FAILED'}
        finally:
            if reader:reader.close()
            if target:target.close()
            if client:
                try:client.close()
                except Exception:pass

    def start(self,emit):
        def loop():
            while not self.stop.is_set():
                result=self.run_once();emit(result)
                self.stop.wait(3600 if result['status']=='BACKUP_VERIFIED' else 300)
        self.thread=threading.Thread(target=loop,daemon=True);self.thread.start()

    def close(self):
        self.stop.set()
        if self.thread:self.thread.join(timeout=2)
