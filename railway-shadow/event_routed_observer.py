"""Default-off, bounded staging observer following atomic route exports."""
import fcntl
import json
import math
from pathlib import Path
import sqlite3
import tempfile
import time
from event_capture_journal import EventCaptureJournal,EventCaptureError,canonical,digest,snapshot,restore_snapshot,verify_store
from event_postgres_export import PROJECT,source_identity,ingest_export
from event_command_router import READ_QUERY,identifier
from shadow_collector import timestamp

class RoutedObserver:
 def __init__(self,root=None,route_id=None,reader=None,*,enabled=False,read_limit=8,clock=time.time,stale_after=180):
  self.enabled=enabled is True;self.good=False;self.last=None;self.clock=clock;self.stale_after=stale_after
  if not self.enabled:return
  source_identity(route_id)
  if not callable(reader) or not callable(clock) or type(read_limit) is not int or not 1<=read_limit<=16 or type(stale_after) not in (int,float) or not math.isfinite(stale_after) or not 1<=stale_after<=180:raise EventCaptureError('ROUTED_OBSERVER_CONFIG_REQUIRED')
  self.root=Path(root);self.route=route_id;self.reader=reader;self.limit=read_limit
  if not self.root.is_absolute() or any(p.is_symlink() for p in (self.root,*self.root.parents)):raise EventCaptureError('ROUTED_OBSERVER_PATH_REFUSED')
  self.root.mkdir(parents=True,exist_ok=True,mode=0o700)
  for name in ('route-state.sqlite3','route-state.lock'):
   if (self.root/name).is_symlink():raise EventCaptureError('ROUTED_OBSERVER_PATH_REFUSED')
  self.lock=(self.root/'route-state.lock').open('a');(self.root/'route-state.lock').chmod(0o600)
  try:
   fcntl.flock(self.lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
   path=self.root/'route-state.sqlite3';existed=path.exists();self.db=sqlite3.connect(path)
   if existed and (self.db.execute('PRAGMA application_id').fetchone()[0]!=0x4D575254 or self.db.execute('PRAGMA user_version').fetchone()[0]!=1):raise EventCaptureError('ROUTED_OBSERVER_IDENTITY_MISMATCH')
   with self.db:
    if not existed:self.db.execute('PRAGMA application_id=1297568340');self.db.execute('PRAGMA user_version=1')
    self.db.execute('CREATE TABLE IF NOT EXISTS route_state(route TEXT PRIMARY KEY,generation INTEGER,stream TEXT,binding TEXT,used INTEGER NOT NULL,read_limit INTEGER NOT NULL)')
    self.db.execute('INSERT OR IGNORE INTO route_state VALUES (?,NULL,NULL,NULL,0,?)',(route_id,read_limit))
    if self.db.execute('SELECT route,read_limit FROM route_state').fetchall()!=[(route_id,read_limit)]:raise EventCaptureError('ROUTED_OBSERVER_IDENTITY_MISMATCH')
   (self.root/'route-state.sqlite3').chmod(0o600)
  except Exception:self.close();raise
 def close(self):
  if hasattr(self,'db'):self.db.close()
  if hasattr(self,'lock'):self.lock.close()
 def packet(self,rows):
  if not isinstance(rows,list) or len(rows)!=1 or not isinstance(rows[0],dict) or set(rows[0])!={'packet'}:raise EventCaptureError('ROUTE_EXPORT_REQUIRED')
  p=rows[0]['packet'];keys={'project','routeId','scope','serviceDate','generation','streamId','previousStreamId','cutoverRequest','enabled','eventCount','attested','batch','previousRetired','previousEventCount','previousBatch'}
  if not isinstance(p,dict) or set(p)!=keys or len(canonical(p).encode())>10_100_000:raise EventCaptureError('ROUTE_EXPORT_REQUIRED')
  if p['project']!=PROJECT or p['routeId']!=self.route or p['scope']!='SYNTHETIC_STAGING_EVENTS' or p['enabled'] is not True or type(p['generation']) is not int or p['generation'] not in (0,1):raise EventCaptureError('ROUTE_EXPORT_REQUIRED')
  source_identity(p['streamId']);batch=p['batch']
  if not isinstance(batch,dict) or batch.get('serviceDate')!=p['serviceDate'] or type(p['eventCount']) is not int or p['eventCount']!=len(batch.get('events',[])) or p['eventCount']<1:raise EventCaptureError('ROUTE_EXPORT_REQUIRED')
  if p['generation']==0:
   if p['previousStreamId'] is not None or p['cutoverRequest'] is not None or p['attested'] is not False or p['previousRetired'] is not False or p['previousEventCount'] is not None or p['previousBatch'] is not None or batch.get('coverage',{}).get('basis')!='DECISION_EVENT_LOG':raise EventCaptureError('ROUTE_BASELINE_REQUIRED')
  else:
   source_identity(p['previousStreamId'])
   if p['previousStreamId']==p['streamId'] or not identifier(p['cutoverRequest']) or p['attested'] is not True or batch['events'][0].get('kind')!='CUTOVER_BASELINE' or batch['events'][0].get('eventId')!=p['cutoverRequest']:raise EventCaptureError('ROUTE_BASELINE_REQUIRED')
   old=p['previousBatch'];count=p['previousEventCount']
   if p['previousRetired'] is not True or type(count) is not int or not 0<=count<=1000:raise EventCaptureError('RETIRED_SOURCE_SEAL_REQUIRED')
   if count==0:
    if old is not None:raise EventCaptureError('RETIRED_SOURCE_SEAL_REQUIRED')
   elif (not isinstance(old,dict) or old.get('serviceDate')!=p['serviceDate'] or len(old.get('events',[]))!=count or old.get('coverage',{}).get('basis')!='DECISION_EVENT_LOG' or timestamp(old['coverage']['throughAt'])>timestamp(batch['events'][0]['at'])):raise EventCaptureError('RETIRED_SOURCE_SEAL_REQUIRED')
  return p
 def status(self):
  if not self.enabled:return dict(status='DISABLED',healthy=False,verified=False)
  try:
   age=None if self.last is None else self.clock()-self.last
   okay=self.good and age is not None and 0<=age<=self.stale_after
   if okay:
    generation,stream,binding=self.db.execute('SELECT generation,stream,binding FROM route_state').fetchone()
    okay=(generation,stream,binding)==self.current
    if okay:
     for member,mark in self.marks.items():
      db=sqlite3.connect((self.root/member/'event-capture.sqlite3').as_uri()+'?mode=ro',uri=True)
      try:okay=okay and self.fingerprint(db,source_identity(member))==mark
      finally:db.close()
   return dict(status='HEALTHY' if okay else 'UNHEALTHY',healthy=bool(okay),ageSeconds=age,verified=False)
  except Exception:return dict(status='UNHEALTHY',healthy=False,verified=False)
 def fingerprint(self,db,identity):
  counts=verify_store(db,identity);states=db.execute('SELECT key,state FROM batches ORDER BY key').fetchall()
  if any(state!='ACKED' for _,state in states):raise EventCaptureError('ROUTE_ACK_REQUIRED')
  return digest(dict(counts=counts,batches=states))
 def acknowledge(self,stream,batch,count,scope):
  path=self.root/stream/'event-capture.sqlite3';identity=source_identity(stream)
  journal=EventCaptureJournal(path,identity,enabled=True)
  try:
   ingest_export([dict(stream_id=stream,scope=scope,event_count=count,batch=batch)],journal,stream)
   if journal.db.execute('SELECT count(*) FROM events').fetchone()[0]!=count:raise EventCaptureError('ROUTE_PREFIX_REGRESSION')
   for _ in range(16):
    result=journal.run_once(enabled=True)
    if result['status']=='IDLE':break
    if result['status']!='RECORDED':raise EventCaptureError('ROUTE_REPLAY_REQUIRED')
   mark=self.fingerprint(journal.db,identity)
   with tempfile.TemporaryDirectory(dir=self.root) as tmp:
    tmp=Path(tmp);receipt=snapshot(journal,tmp/'snapshot.sqlite3');restore_snapshot(tmp/'snapshot.sqlite3',tmp/'event-capture.sqlite3',identity,receipt['sha256'])
    restored=EventCaptureJournal(tmp/'event-capture.sqlite3',identity,enabled=True)
    try:
     if restored.run_once(enabled=True)['status']!='IDLE' or self.fingerprint(restored.db,identity)!=mark:raise EventCaptureError('ROUTE_RECOVERY_REQUIRED')
    finally:restored.close()
   return mark
  finally:journal.close()
 def cycle(self,*,before_route_commit=lambda:None):
  if not self.enabled:return dict(status='DISABLED',sourceRequests=0,verified=False)
  self.good=False;requests=0
  try:
   acquired=self.clock()
   if type(acquired) not in (int,float) or not math.isfinite(acquired):raise EventCaptureError('ROUTE_CLOCK_REQUIRED')
   with self.db:
    self.db.execute('BEGIN IMMEDIATE');generation,stream,binding,used=self.db.execute('SELECT generation,stream,binding,used FROM route_state').fetchone()
    if used>=self.limit:raise EventCaptureError('ROUTE_READ_BUDGET_EXHAUSTED')
    self.db.execute('UPDATE route_state SET used=used+1')
   requests=1;p=self.packet(self.reader(dict(query=READ_QUERY,parameters=[self.route])))
   identity_fields={k:p[k] for k in ('routeId','generation','streamId','previousStreamId','cutoverRequest','serviceDate')}
   identity_fields['retiredSeal']=digest(p['previousBatch']);new_binding=digest(identity_fields)
   if generation is not None:
    if p['generation']<generation or p['generation']>generation+1:raise EventCaptureError('ROUTE_GENERATION_REFUSED')
    if p['generation']==generation and new_binding!=binding:raise EventCaptureError('ROUTE_BINDING_CHANGED')
    if p['generation']>generation and p['previousStreamId']!=stream:raise EventCaptureError('ROUTE_PREDECESSOR_REQUIRED')
   marks={}
   if p['generation']==1 and p['previousEventCount']:
    marks[p['previousStreamId']]=self.acknowledge(p['previousStreamId'],p['previousBatch'],p['previousEventCount'],p['scope'])
   elif p['generation']==1:
    old_path=self.root/p['previousStreamId']/'event-capture.sqlite3'
    if old_path.exists():
     db=sqlite3.connect(old_path.as_uri()+'?mode=ro',uri=True)
     try:
      if verify_store(db,source_identity(p['previousStreamId']))['events']!=0:raise EventCaptureError('ROUTE_PREFIX_REGRESSION')
     finally:db.close()
   marks[p['streamId']]=self.acknowledge(p['streamId'],p['batch'],p['eventCount'],p['scope'])
   before_route_commit()
   with self.db:self.db.execute('UPDATE route_state SET generation=?,stream=?,binding=?',(p['generation'],p['streamId'],new_binding))
   self.current=(p['generation'],p['streamId'],new_binding);self.marks=marks;self.last=acquired;self.good=True
   if not self.status()['healthy']:raise EventCaptureError('ROUTE_STALE_ON_COMPLETION')
   return dict(status='OBSERVED',sourceRequests=1,generation=p['generation'],recoveryVerified=True,healthy=True,verified=False)
  except Exception as error:
   self.good=False
   return dict(status='UNVERIFIED',sourceRequests=requests,reasonCode=str(error) if isinstance(error,EventCaptureError) else 'ROUTED_OBSERVER_FAILED',healthy=False,verified=False)
