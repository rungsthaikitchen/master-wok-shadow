"""One-attempt staging event-journal cloud recovery rehearsal. No source client."""
import hashlib
import json
import sqlite3
from pathlib import Path
import tempfile
import uuid
from event_capture_journal import canonical,digest,snapshot,restore_snapshot,EventCaptureJournal,EventCaptureError,verify_store
from delivery_evidence_backup import s3_client
MAX_BYTES=5_000_000

def fingerprint(journal):
 verify_store(journal.db,journal.identity)
 # Bind cache to actual captured input, queue and observations, not counts alone.
 tables=('meta','events','batches','observations','stream_meta','members')
 return digest({t:sorted(journal.db.execute('SELECT * FROM '+t).fetchall(),key=canonical) for t in tables})

class EventRecovery:
 def __init__(self,config,budget,receipt_path,*,client_factory=s3_client):
  self.config=config;self.budget=budget;self.path=Path(receipt_path);self.client_factory=client_factory
  if self.path.is_symlink():raise EventCaptureError('RECOVERY_RECEIPT_REFUSED')
 def run(self,journal):
  client=None
  try:
   mark=fingerprint(journal)
   if self.path.exists():
    receipt=json.loads(self.path.read_text())
    if (receipt.get('identity')!=journal.identity or receipt.get('fingerprint')!=mark or
        receipt.get('proofHash')!=digest({k:v for k,v in receipt.items() if k!='proofHash'})):
     raise EventCaptureError('RECOVERY_RECEIPT_MISMATCH')
    return dict(status='CACHED_RECOVERY_VERIFIED',restored=True)
   self.budget.take_cloud()
   with tempfile.TemporaryDirectory(prefix='mw-event-recovery-') as tmp:
    root=Path(tmp);path=root/'snapshot.sqlite3';local=snapshot(journal,path)
    if not 0<path.stat().st_size<=MAX_BYTES:raise EventCaptureError('RECOVERY_SIZE_LIMIT')
    data=path.read_bytes();sha=hashlib.sha256(data).hexdigest()
    key='master-wok-events/v1/'+journal.identity+'/'+uuid.uuid4().hex+'.sqlite3'
    manifest=dict(format='master-wok-events-v1',key=key,sha256=sha,identity=journal.identity,
                  fingerprint=mark,bytes=len(data),counts=local['counts'],requestBudget=self.budget.summary(),restorePolicy='SPEND_TRIAL_BUDGETS_ON_RESTORE')
    client=self.client_factory(self.config)
    client.put_object(Bucket=self.config.bucket,Key=key,Body=data,ContentType='application/vnd.sqlite3')
    client.put_object(Bucket=self.config.bucket,Key=key+'.json',Body=canonical(manifest).encode(),ContentType='application/json')
    def get(key,limit):
     body=client.get_object(Bucket=self.config.bucket,Key=key)['Body']
     try:
      data=body.read(limit+1)
      if len(data)>limit:raise EventCaptureError('RECOVERY_READBACK_LIMIT')
      return data
     finally:body.close()
    if json.loads(get(key+'.json',8192))!=manifest:raise EventCaptureError('RECOVERY_MANIFEST_MISMATCH')
    download=get(key,MAX_BYTES)
    if hashlib.sha256(download).hexdigest()!=sha:raise EventCaptureError('RECOVERY_HASH_MISMATCH')
    received=root/'received.sqlite3';received.write_bytes(download)
    restored_dir=root/'restored';restored_dir.mkdir()
    restored_path=restored_dir/'event-capture.sqlite3'
    if restore_snapshot(received,restored_path,journal.identity,sha)!=local['counts']:raise EventCaptureError('RECOVERY_COUNTS_MISMATCH')
    restored=EventCaptureJournal(restored_path,journal.identity,enabled=True)
    try:
     if fingerprint(restored)!=mark or restored.run_once(enabled=True)['status']!='IDLE':raise EventCaptureError('RECOVERY_REPLAY_MISMATCH')
    finally:restored.close()
    # A recovered trial must never gain fresh source/provider request allowance.
    restored_budget=type(self.budget)(root/'restored-budget.sqlite3',journal.identity)
    with sqlite3.connect(restored_budget.path) as db:db.execute('UPDATE budget SET reads=2,writes=3')
    restored_budget.take_cloud()
    for take in (lambda:restored_budget.take('reader'),lambda:restored_budget.take('writer'),restored_budget.take_cloud):
     try:take()
     except EventCaptureError:pass
     else:raise EventCaptureError('RESTORE_BUDGET_NOT_EXHAUSTED')
    receipt=dict(manifest,restored=True);receipt['proofHash']=digest(receipt)
    with self.path.open('x') as output:json.dump(receipt,output,sort_keys=True)
    self.path.chmod(0o600)
    return dict(status='CLOUD_RECOVERY_VERIFIED',restored=True,bytes=len(data),observations=local['counts']['observations'])
  except Exception:return dict(status='RECOVERY_FAILED',restored=False)
  finally:
   if client:client.close()
