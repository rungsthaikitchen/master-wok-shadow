"""Default-off object round trip for complete paired evidence; no source clients."""
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import tempfile
import uuid
from event_capture_journal import EventCaptureError,canonical,digest
from event_transfer_bundle import TransferBundleStore
from event_postgres_export import PROJECT,source_identity
from delivery_evidence_backup import s3_client
MAX_BYTES=20_000_000
FORMAT='master-wok-transfer-bundle-v1'
POLICY='OFFLINE_ACK_ONLY_SOURCE_DISABLED'

def fingerprint(store,db=None):
 db=store.db if db is None else db
 store.verify(db)
 return digest({t:sorted(db.execute('SELECT * FROM '+t).fetchall(),key=canonical) for t in ('meta','bundles','streams')})

def restore(source,manifest,destination):
 """New destination only; never create source clients or restore read allowances."""
 source=Path(source);destination=Path(destination)
 if not isinstance(manifest,dict) or set(manifest)!={'format','key','sha256','identity','streams','fingerprint','bytes','counts','restorePolicy'} or manifest['format']!=FORMAT or manifest['restorePolicy']!=POLICY:raise EventCaptureError('PAIR_RECOVERY_MANIFEST_REFUSED')
 if not isinstance(manifest['identity'],str) or not re.fullmatch('[a-f0-9]{64}',manifest['identity']) or not isinstance(manifest['sha256'],str) or not re.fullmatch('[a-f0-9]{64}',manifest['sha256']) or not re.fullmatch('master-wok-transfer/v1/'+manifest['identity']+r'/[a-f0-9]{32}\.sqlite3',manifest['key']):raise EventCaptureError('PAIR_RECOVERY_MANIFEST_REFUSED')
 streams=manifest['streams']
 if not isinstance(streams,list) or len(streams)!=2 or len(set(streams))!=2 or streams!=sorted(streams):raise EventCaptureError('PAIR_RECOVERY_IDENTITY_MISMATCH')
 for stream in streams:source_identity(stream)
 if digest(dict(project=PROJECT,streams=streams,scope='SYNTHETIC_TRANSFER_BUNDLE'))!=manifest['identity']:raise EventCaptureError('PAIR_RECOVERY_IDENTITY_MISMATCH')
 if not source.is_absolute() or not destination.is_absolute() or destination.name!='transfer-bundles.sqlite3' or destination.exists() or any(p.is_symlink() for p in [source,*source.parents,destination,*destination.parents]):raise EventCaptureError('NEW_PAIR_RESTORE_REQUIRED')
 if not source.is_file() or not 0<source.stat().st_size<=MAX_BYTES or source.stat().st_size!=manifest['bytes'] or hashlib.sha256(source.read_bytes()).hexdigest()!=manifest['sha256']:raise EventCaptureError('PAIR_RECOVERY_HASH_MISMATCH')
 # Validate the source without opening it writable or replaying any work.
 reader=sqlite3.connect(source.as_uri()+'?mode=ro',uri=True)
 checker=object.__new__(TransferBundleStore);checker.identity=manifest['identity'];checker.streams=manifest['streams']
 try:
  counts=checker.verify(reader)
  if counts!=manifest['counts'] or counts['acknowledged']!=counts['bundles'] or not counts['bundles'] or fingerprint(checker,reader)!=manifest['fingerprint']:raise EventCaptureError('PAIR_RECOVERY_CONTENT_MISMATCH')
  fd=os.open(destination,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600);os.close(fd)
  try:
   with sqlite3.connect(destination) as target:
    reader.backup(target)
    target.execute('CREATE TABLE IF NOT EXISTS recovery_guard(disabled INTEGER NOT NULL CHECK(disabled=1))')
    target.execute('DELETE FROM recovery_guard');target.execute('INSERT INTO recovery_guard VALUES (1)')
    if checker.verify(target)!=counts or fingerprint(checker,target)!=manifest['fingerprint']:raise EventCaptureError('PAIR_RECOVERY_CONTENT_MISMATCH')
  except Exception:destination.unlink(missing_ok=True);raise
 finally:reader.close()
 return dict(status='OFFLINE_PAIR_RECOVERY_VERIFIED',counts=counts,sourceRequests=0,verified=False)

class PairRecovery:
 def __init__(self,config=None,*,enabled=False,client_factory=s3_client,limit=2):
  self.enabled=enabled is True;self.config=config;self.client_factory=client_factory;self.limit=limit
  if self.enabled and (type(limit) is not int or not 1<=limit<=2 or config is None):raise EventCaptureError('PAIR_RECOVERY_CONFIG_REQUIRED')
 def run(self,store):
  if not self.enabled:return dict(status='DISABLED',restored=False,verified=False)
  client=None
  try:
   store.assert_source_allowed();mark=fingerprint(store)
   counts=store.verify()
   if not counts['bundles'] or counts['acknowledged']!=counts['bundles']:raise EventCaptureError('PAIR_RECOVERY_PENDING_WORK')
   destination=digest(dict(endpoint=self.config.endpoint,bucket=self.config.bucket,region=self.config.region,style=self.config.style))
   with store.db:
    store.db.execute('CREATE TABLE IF NOT EXISTS pair_recovery_budget(id INTEGER PRIMARY KEY CHECK(id=1),max_attempts INTEGER NOT NULL,used INTEGER NOT NULL)')
    store.db.execute('CREATE TABLE IF NOT EXISTS pair_recovery_receipts(fingerprint TEXT PRIMARY KEY,destination TEXT NOT NULL,manifest TEXT NOT NULL,proof_hash TEXT NOT NULL)')
    store.db.execute('INSERT OR IGNORE INTO pair_recovery_budget VALUES (1,?,0)',(self.limit,))
   cached=store.db.execute('SELECT destination,manifest,proof_hash FROM pair_recovery_receipts WHERE fingerprint=?',(mark,)).fetchone()
   if cached:
    if cached[0]!=destination or cached[2]!=digest(dict(destination=destination,manifest=json.loads(cached[1]))):raise EventCaptureError('PAIR_RECOVERY_RECEIPT_MISMATCH')
    return dict(status='CACHED_PAIR_RECOVERY_VERIFIED',restored=True,fingerprint=mark,verified=False)
   with store.db:
    maximum,used=store.db.execute('SELECT max_attempts,used FROM pair_recovery_budget').fetchone()
    if maximum!=self.limit or used>=maximum:raise EventCaptureError('PAIR_RECOVERY_BUDGET_EXHAUSTED')
    store.db.execute('UPDATE pair_recovery_budget SET used=used+1')
   with tempfile.TemporaryDirectory(prefix='mw-pair-recovery-') as tmp:
    root=Path(tmp);snapshot=root/'snapshot.sqlite3';store.snapshot(snapshot)
    if not 0<snapshot.stat().st_size<=MAX_BYTES:raise EventCaptureError('PAIR_RECOVERY_SIZE_LIMIT')
    data=snapshot.read_bytes();sha=hashlib.sha256(data).hexdigest();key='master-wok-transfer/v1/'+store.identity+'/'+uuid.uuid4().hex+'.sqlite3'
    manifest=dict(format=FORMAT,key=key,sha256=sha,identity=store.identity,streams=store.streams,fingerprint=mark,bytes=len(data),counts=counts,restorePolicy=POLICY)
    client=self.client_factory(self.config)
    client.put_object(Bucket=self.config.bucket,Key=key,Body=data,ContentType='application/vnd.sqlite3')
    client.put_object(Bucket=self.config.bucket,Key=key+'.json',Body=canonical(manifest).encode(),ContentType='application/json')
    def get(k,limit):
     body=client.get_object(Bucket=self.config.bucket,Key=k)['Body']
     try:
      result=body.read(limit+1)
      if len(result)>limit:raise EventCaptureError('PAIR_RECOVERY_READ_LIMIT')
      return result
     finally:body.close()
    if json.loads(get(key+'.json',8192))!=manifest:raise EventCaptureError('PAIR_RECOVERY_MANIFEST_MISMATCH')
    downloaded=root/'downloaded.sqlite3';downloaded.write_bytes(get(key,MAX_BYTES))
    restored_dir=root/'restored';restored_dir.mkdir();result=restore(downloaded,manifest,restored_dir/'transfer-bundles.sqlite3')
    restored=TransferBundleStore(restored_dir/'transfer-bundles.sqlite3',store.streams,enabled=True)
    try:
     if restored.run_once()['status']!='IDLE' or len(restored.acknowledged())!=counts['acknowledged']:raise EventCaptureError('PAIR_RECOVERY_ACK_MISMATCH')
     try:restored.assert_source_allowed()
     except EventCaptureError:pass
     else:raise EventCaptureError('PAIR_RECOVERY_SOURCE_NOT_BLOCKED')
    finally:restored.close()
    # The fingerprint excludes health timestamps and recovery receipts, so an
    # unchanged source poll reuses this exact content proof without more IO.
    if fingerprint(store)!=mark:raise EventCaptureError('PAIR_RECOVERY_SOURCE_CHANGED')
    with store.db:store.db.execute('INSERT INTO pair_recovery_receipts VALUES (?,?,?,?)',(mark,destination,canonical(manifest),digest(dict(destination=destination,manifest=manifest))))
    return dict(status='PAIR_RECOVERY_VERIFIED',restored=True,fingerprint=mark,verified=False)
  except Exception:return dict(status='PAIR_RECOVERY_FAILED',restored=False,verified=False)
  finally:
   if client:client.close()
