"""Default-off two-stream validation and atomic comparison acknowledgement."""
import copy
import fcntl
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
from event_capture_journal import ROOT,EventCaptureError,canonical,digest,build_hash
from event_postgres_export import PROJECT,source_identity
from shadow_collector import timestamp
QUERY='SELECT master_wok_event_test.export_transfer_pair($1::uuid,$2::uuid) AS bundle'
def invoke(bundle,*,validate_only=False):
 env={k:v for k,v in os.environ.items() if k in ('PATH','LANG')}
 env.update(TZ='Europe/London',MASTER_WOK_TRANSFER_BUNDLE_ENABLED='true')
 if validate_only:env['MASTER_WOK_TRANSFER_BUNDLE_VALIDATE_ONLY']='true'
 r=subprocess.run(['node',str(ROOT/'master-wok-transfer-bundle.js')],input=canonical(bundle),text=True,capture_output=True,timeout=20,env=env)
 if r.returncode or len(r.stdout.encode())>2000000:raise EventCaptureError('BUNDLE_PROCESS_REFUSED')
 return json.loads(r.stdout)
def bundle_build():return digest(dict(replay=build_hash(),adapter=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()))
class TransferBundleStore:
 def __init__(self,path,streams,*,enabled=False):
  if enabled is not True:raise EventCaptureError('DISABLED')
  if not isinstance(streams,(list,tuple)) or len(streams)!=2 or len(set(streams))!=2:raise EventCaptureError('TWO_STREAMS_REQUIRED')
  for stream in streams:source_identity(stream)
  self.streams=sorted(streams);self.identity=digest(dict(project=PROJECT,streams=self.streams,scope='SYNTHETIC_TRANSFER_BUNDLE'))
  self.path=Path(path)
  if not self.path.is_absolute() or self.path.name!='transfer-bundles.sqlite3' or any(p.is_symlink() for p in [self.path,Path(str(self.path)+'.lock'),*self.path.parents]):raise EventCaptureError('DEDICATED_BUNDLE_STORE_REQUIRED')
  self.path.parent.mkdir(parents=True,exist_ok=True,mode=0o700);self.lock=open(str(self.path)+'.lock','a');os.chmod(str(self.path)+'.lock',0o600)
  try:
   fcntl.flock(self.lock,fcntl.LOCK_EX|fcntl.LOCK_NB);existed=self.path.exists();self.db=sqlite3.connect(self.path)
   if existed and (self.db.execute('PRAGMA application_id').fetchone()[0]!=0x4D575442 or self.db.execute('PRAGMA user_version').fetchone()[0]!=1):raise EventCaptureError('BUNDLE_STORE_FORMAT_REQUIRED')
   self.db.execute('PRAGMA journal_mode=WAL');self.db.execute('PRAGMA synchronous=FULL')
   if not existed:
    with self.db:
     self.db.execute('PRAGMA application_id='+str(0x4D575442));self.db.execute('PRAGMA user_version=1')
     self.db.execute('CREATE TABLE meta(identity TEXT NOT NULL)');self.db.execute('INSERT INTO meta VALUES (?)',(self.identity,))
     self.db.execute('CREATE TABLE bundles(key TEXT PRIMARY KEY,payload TEXT NOT NULL,build TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN (\'PENDING\',\'ACKED\')),result TEXT,result_hash TEXT)')
     self.db.execute('CREATE TABLE streams(id TEXT PRIMARY KEY,day TEXT NOT NULL,events TEXT NOT NULL,through_at REAL NOT NULL)')
   if self.db.execute('SELECT identity FROM meta').fetchall()!=[(self.identity,)]:raise EventCaptureError('BUNDLE_IDENTITY_MISMATCH')
   self.path.chmod(0o600)
  except Exception:self.close();raise
 def close(self):
  if hasattr(self,'db'):self.db.close()
  if hasattr(self,'lock'):self.lock.close()
 def enqueue(self,bundle):
  body=canonical(bundle)
  if len(body.encode())>10000000:raise EventCaptureError('BUNDLE_SIZE_REFUSED')
  validated=invoke(bundle,validate_only=True)
  if validated.get('status')!='VALIDATED' or sorted(s['streamId'] for s in bundle['streams'])!=self.streams:raise EventCaptureError('COMPLETE_TRANSFER_BUNDLE_REQUIRED')
  bundle=copy.deepcopy(bundle);bundle['streams'].sort(key=lambda s:s['streamId']);bundle['transfers'].sort(key=lambda t:t['transferId'])
  for s in bundle['streams']:s['batch']['events'].sort(key=lambda e:e['sequence'])
  body=canonical(bundle);build=bundle_build();key=digest(dict(identity=self.identity,bundle=bundle,build=build))
  with self.db:
   self.db.execute('BEGIN IMMEDIATE')
   old=self.db.execute('SELECT payload FROM bundles WHERE key=?',(key,)).fetchone()
   if old:
    if old[0]!=body:raise EventCaptureError('BUNDLE_CONTENT_CONFLICT')
    return dict(status='ALREADY_QUEUED',bundleKey=key)
   if self.db.execute('SELECT count(*) FROM bundles').fetchone()[0]>=16:raise EventCaptureError('BUNDLE_LIMIT_REACHED')
   for s in bundle['streams']:
    b=s['batch'];events=b['events'];prior=self.db.execute('SELECT day,events,through_at FROM streams WHERE id=?',(s['streamId'],)).fetchone();through=timestamp(b['coverage']['throughAt']).timestamp()
    if prior:
     old_events=json.loads(prior[1])
     if prior[0]!=b['serviceDate'] or through<prior[2] or len(events)<len(old_events) or events[:len(old_events)]!=old_events:raise EventCaptureError('BUNDLE_HISTORY_CONFLICT')
     if len(events)>len(old_events) and timestamp(events[len(old_events)]['at']).timestamp()<prior[2]:raise EventCaptureError('BUNDLE_WATERMARK_CONFLICT')
    self.db.execute('INSERT OR REPLACE INTO streams VALUES (?,?,?,?)',(s['streamId'],b['serviceDate'],canonical(events),through))
   self.db.execute('INSERT INTO bundles VALUES (?,?,?,\'PENDING\',NULL,NULL)',(key,body,build))
  return dict(status='QUEUED',bundleKey=key)
 def run_once(self,*,before_commit=lambda:None):
  row=self.db.execute('SELECT key,payload,build FROM bundles WHERE state=\'PENDING\' ORDER BY rowid LIMIT 1').fetchone()
  if row is None:return dict(status='IDLE',verified=False)
  key,body,build=row;bundle=json.loads(body)
  if build!=bundle_build() or key!=digest(dict(identity=self.identity,bundle=bundle,build=build)):raise EventCaptureError('BUNDLE_BUILD_OR_CONTENT_CHANGED')
  result=invoke(bundle)
  self._check_result(bundle,result)
  if build!=bundle_build():raise EventCaptureError('BUNDLE_BUILD_OR_CONTENT_CHANGED')
  with self.db:
   self.db.execute('UPDATE bundles SET state=\'ACKED\',result=?,result_hash=? WHERE key=? AND state=\'PENDING\'',(canonical(result),digest(result),key));before_commit()
  return dict(status='RECORDED',bundleKey=key,comparisons=sum(r['result']['decisionCount'] for r in result['results']),verified=False)
 def _check_result(self,bundle,result):
  if result.get('status')!='COMPARED' or result.get('verified') is not False or result.get('networkRequests')!=0 or result.get('streamCount')!=2 or result.get('transferCount')!=len(bundle['transfers']) or sorted(x.get('streamId','') for x in result.get('results',[]))!=self.streams:raise EventCaptureError('BUNDLE_COMPARISON_INCOMPLETE')
  batches={s['streamId']:s['batch'] for s in bundle['streams']}
  for row in result['results']:
   b=batches[row['streamId']];r=row['result'];events=[e for e in b['events'] if e['kind'] in ('BOOKING_DECISION','RESERVATION_TRANSFERRED_IN')]
   if r.get('status')!='REPLAYED' or r.get('verified') is not False or r.get('networkRequests')!=0 or r.get('serviceDate')!=b['serviceDate'] or r.get('coverageThroughAt')!=b['coverage']['throughAt'] or r.get('decisionCount')!=len(events) or len(r.get('observations',[]))!=len(events):raise EventCaptureError('BUNDLE_COMPARISON_INCOMPLETE')
   for event,value in zip(events,r['observations']):
    if value.get('eventId')!=event['eventId'] or value.get('sequence')!=event['sequence'] or value.get('orderId')!=event['order']['orderId'] or value.get('decisionAt')!=event['at'] or value.get('actualDecision')!=event['actualDecision'] or value.get('verified') is not False:raise EventCaptureError('BUNDLE_COMPARISON_INCOMPLETE')
 def assert_source_allowed(self):
  if self.db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='recovery_guard'").fetchone():
   raise EventCaptureError('RECOVERED_STORE_SOURCE_DISABLED')
 def verify(self,db=None):
  db=self.db if db is None else db
  if db.execute('PRAGMA application_id').fetchone()[0]!=0x4D575442 or db.execute('PRAGMA user_version').fetchone()[0]!=1 or db.execute('PRAGMA integrity_check').fetchone()[0]!='ok' or db.execute('SELECT identity FROM meta').fetchall()!=[(self.identity,)]:raise EventCaptureError('BUNDLE_ACK_INTEGRITY_FAILED')
  count=0;expected_streams={}
  for key,body,build,state,result,sha in db.execute('SELECT key,payload,build,state,result,result_hash FROM bundles ORDER BY rowid'):
   bundle=json.loads(body)
   for stream in bundle['streams']:
    b=stream['batch'];expected_streams[stream['streamId']]=(stream['streamId'],b['serviceDate'],canonical(b['events']),timestamp(b['coverage']['throughAt']).timestamp())
   if key!=digest(dict(identity=self.identity,bundle=bundle,build=build)):raise EventCaptureError('BUNDLE_ACK_INTEGRITY_FAILED')
   if state=='ACKED':
    value=json.loads(result)
    if digest(value)!=sha:raise EventCaptureError('BUNDLE_ACK_INTEGRITY_FAILED')
    self._check_result(bundle,value);count+=1
   elif state!='PENDING' or result is not None or sha is not None:raise EventCaptureError('BUNDLE_ACK_INTEGRITY_FAILED')
  if db.execute('SELECT * FROM streams ORDER BY id').fetchall()!=sorted(expected_streams.values()):raise EventCaptureError('BUNDLE_STREAM_INTEGRITY_FAILED')
  return dict(acknowledged=count,bundles=db.execute('SELECT count(*) FROM bundles').fetchone()[0])
 def snapshot(self,destination):
  path=Path(destination)
  if not path.is_absolute() or path.exists() or any(p.is_symlink() for p in [path,*path.parents]):raise EventCaptureError('NEW_BUNDLE_SNAPSHOT_REQUIRED')
  expected=self.verify();fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600);os.close(fd)
  with sqlite3.connect(path) as target:
   self.db.backup(target)
   if self.verify(target)!=expected:raise EventCaptureError('BUNDLE_SNAPSHOT_MISMATCH')
  return expected
 def acknowledged(self):
  self.verify();rows=[]
  for key,body,build,result,sha in self.db.execute('SELECT key,payload,build,result,result_hash FROM bundles WHERE state=\'ACKED\''):
   value=json.loads(result)
   if digest(value)!=sha or key!=digest(dict(identity=self.identity,bundle=json.loads(body),build=build)) or value.get('status')!='COMPARED':raise EventCaptureError('BUNDLE_ACK_INTEGRITY_FAILED')
   rows.append(value)
  return rows

def poll_pair(store=None,*,enabled=False,transport=None):
 if enabled is not True:return dict(status='DISABLED',sourceRequests=0,verified=False)
 if not isinstance(store,TransferBundleStore) or not callable(transport):raise EventCaptureError('BUNDLE_TRANSPORT_REQUIRED')
 store.assert_source_allowed()
 rows=transport(dict(query=QUERY,parameters=store.streams))
 if not isinstance(rows,list) or len(rows)!=1 or set(rows[0])!={'bundle'}:raise EventCaptureError('BUNDLE_ENVELOPE_REQUIRED')
 return dict(store.enqueue(rows[0]['bundle']),sourceRequests=1,verified=False)
