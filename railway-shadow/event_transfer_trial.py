"""Bounded authenticated synthetic transfer rehearsal; no public DB or HTTP access."""
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from event_capture_journal import EventCaptureError,canonical
from event_runtime_transport import connection_parameters,ROLES
from event_transfer_reader import TransferPairReader
from event_transfer_bundle import TransferBundleStore,QUERY

STREAMS=('c853a827-8de0-4140-8779-e0a838a9b47b','d72868b4-86b1-4767-bba6-963067a39630')
ORDERS=('3e32d7fa-f33e-4dd5-9339-ac55adeb06bc','119dfdbc-7090-4557-91fa-1262502be560')
DIRECTORY=Path('/data/transfer-trial-c853a827')
FLAGS=('MASTER_WOK_EVENT_RUNTIME_ENABLED','MASTER_WOK_EVENT_RUNTIME_TRIAL_ENABLED','MASTER_WOK_EVENT_CLOUD_BACKUP_ENABLED','MASTER_WOK_EVENT_SOAK_ENABLED','MASTER_WOK_SIGNED_HTTP_TRIAL_ENABLED','MASTER_WOK_BOOKING_HTTP_TRIAL_ENABLED','MASTER_WOK_TERMINAL_HTTP_TRIAL_ENABLED','MASTER_WOK_DELIVERY_HTTP_TRIAL_ENABLED','MASTER_WOK_CONTINUOUS_STAGING_ENABLED','MASTER_WOK_PREPARED_STAGING_ENABLED')
CREATE='SELECT master_wok_event_test.create_booking(%s::uuid,%s::text,%s::uuid,%s::text,%s::timestamptz,%s::jsonb)'
MOVE='SELECT master_wok_event_test.move_booking_offer(%s::uuid,%s::uuid,%s::text,%s::uuid,%s::timestamptz)'
APPLY='SELECT master_wok_event_test.apply_booking(%s::uuid,%s::text,%s::uuid,%s::text,%s::timestamptz,%s::text)'

class Budget:
 LIMITS={'started':1,'writer':10,'reader':3}
 def __init__(self,path,deadline,clock=time.time):
  self.path=Path(path);self.deadline=deadline;self.clock=clock
  if any(p.is_symlink() for p in [self.path,*self.path.parents]):raise EventCaptureError('TRANSFER_TRIAL_PATH_REFUSED')
  with sqlite3.connect(self.path) as db:db.execute('CREATE TABLE IF NOT EXISTS attempts(kind TEXT PRIMARY KEY,used INTEGER NOT NULL)')
  self.path.chmod(0o600)
 def take(self,kind):
  if kind not in self.LIMITS or not self.clock()<self.deadline:raise EventCaptureError('TRANSFER_TRIAL_BUDGET_REFUSED')
  with sqlite3.connect(self.path,timeout=5) as db:
   db.execute('BEGIN IMMEDIATE');row=db.execute('SELECT used FROM attempts WHERE kind=?',(kind,)).fetchone();used=row[0] if row else 0
   if used>=self.LIMITS[kind]:raise EventCaptureError('TRANSFER_TRIAL_BUDGET_EXHAUSTED')
   db.execute('INSERT OR REPLACE INTO attempts VALUES (?,?)',(kind,used+1))
 def summary(self):
  with sqlite3.connect(self.path) as db:return dict(db.execute('SELECT kind,used FROM attempts'))

class Writer:
 def __init__(self,dsn,budget):self.parameters=connection_parameters(dsn,'writer');self.budget=budget
 def call(self,query,parameters,*,prepared=None,release=None,entered=None):
  if query not in (CREATE,MOVE,APPLY):raise EventCaptureError('TRANSFER_TRIAL_QUERY_REFUSED')
  self.budget.take('writer')
  import psycopg
  # Longer but bounded lock wait for the deliberately paused transaction.
  options=dict(self.parameters,options='-c statement_timeout=15000 -c lock_timeout=8000 -c idle_in_transaction_session_timeout=15000')
  with psycopg.connect(**options) as conn:
   with conn.cursor() as cursor:
    cursor.execute('SELECT current_user,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')
    if cursor.fetchone()!=(ROLES['writer'],False,False):raise EventCaptureError('DATABASE_ROLE_UNPROVEN')
    if entered is not None:entered.set()
    cursor.execute(query,parameters);result=cursor.fetchone()[0]
    if prepared is not None:
     prepared.set()
     if not release.wait(10):raise EventCaptureError('TRANSFER_TRIAL_RELEASE_TIMEOUT')
    return result

def read(reader,budget):
 budget.take('reader');rows=reader(dict(query=QUERY,parameters=list(STREAMS)))
 if not isinstance(rows,list) or len(rows)!=1 or set(rows[0])!={'bundle'}:raise EventCaptureError('TRANSFER_TRIAL_EXPORT_REQUIRED')
 return rows[0]['bundle']

def opposite_moves(writer,reader,budget):
 prepared=threading.Event();release=threading.Event();entered=threading.Event()
 with ThreadPoolExecutor(max_workers=2) as pool:
  first=pool.submit(writer.call,MOVE,[*STREAMS,'pair-forward-a',ORDERS[0],'2026-10-22T18:00:00Z'],prepared=prepared,release=release)
  second=None
  try:
   if not prepared.wait(10):raise EventCaptureError('TRANSFER_TRIAL_PREPARE_TIMEOUT')
   second=pool.submit(writer.call,MOVE,[STREAMS[1],STREAMS[0],'pair-forward-b',ORDERS[1],'2026-10-21T18:30:00Z'],entered=entered)
   if not entered.wait(5):raise EventCaptureError('TRANSFER_TRIAL_CONCURRENCY_TIMEOUT')
   before=read(reader,budget)
   # The first connection has executed both writes but has not committed.
   if before['transfers'] or sorted(len(s['batch']['events']) for s in before['streams'])!=[1,1]:raise EventCaptureError('TRANSFER_TRIAL_TORN_SNAPSHOT')
  finally:release.set()
  if first.result(timeout=20)!='RECORDED' or second is None or second.result(timeout=20)!='RECORDED':raise EventCaptureError('TRANSFER_TRIAL_MOVE_FAILED')
 return before

def recover(directory,bundle):
 path=directory/'transfer-bundles.sqlite3';store=TransferBundleStore(path,STREAMS,enabled=True)
 try:store.enqueue(bundle)
 finally:store.close()
 # Real process termination after UPDATE and before COMMIT. No DB credentials in child.
 env={k:v for k,v in os.environ.items() if k in ('PATH','LANG')}
 interrupted=subprocess.run([sys.executable,str(Path(__file__).resolve()),'--interrupt-ack',str(path)],env=env,timeout=25,capture_output=True)
 if interrupted.returncode!=73:raise EventCaptureError('TRANSFER_TRIAL_INTERRUPTION_FAILED')
 store=TransferBundleStore(path,STREAMS,enabled=True)
 try:
  if store.acknowledged() or store.verify()!=dict(acknowledged=0,bundles=1):raise EventCaptureError('TRANSFER_TRIAL_PARTIAL_ACK')
  result=store.run_once()
  if result['status']!='RECORDED' or store.enqueue(bundle)['status']!='ALREADY_QUEUED' or store.run_once()['status']!='IDLE':raise EventCaptureError('TRANSFER_TRIAL_RETRY_FAILED')
  restored=directory/'restored';restored.mkdir(mode=0o700)
  expected=store.snapshot(restored/'transfer-bundles.sqlite3')
 finally:store.close()
 restored_store=TransferBundleStore(restored/'transfer-bundles.sqlite3',STREAMS,enabled=True)
 try:
  if restored_store.verify()!=expected or restored_store.run_once()['status']!='IDLE' or len(restored_store.acknowledged())!=1:raise EventCaptureError('TRANSFER_TRIAL_RESTORE_FAILED')
 finally:restored_store.close()
 return result

def exercise(writer,reader,budget,directory):
 lines=canonical([dict(item_id='jasmine-rice',qty=1,modifiers=[])])
 for i in range(2):
  if writer.call(CREATE,[STREAMS[i],'pair-create-'+str(i),ORDERS[i],'synthetic-pair-'+str(i),'2026-10-'+str(21+i)+'T17:00:00Z',lines])!='RECORDED':raise EventCaptureError('TRANSFER_TRIAL_CREATE_FAILED')
 before=opposite_moves(writer,reader,budget)
 moved=read(reader,budget)
 if len(moved['transfers'])!=2 or sum(len(s['batch']['events']) for s in moved['streams'])!=6:raise EventCaptureError('TRANSFER_TRIAL_COVERAGE_FAILED')
 recovery=recover(directory,moved)
 try:writer.call(APPLY,[STREAMS[0],'pair-stale',ORDERS[0],'accept',None,'pair-create-0'])
 except Exception as error:
  if getattr(error,'sqlstate',None)!='P0001' or getattr(getattr(error,'diag',None),'message_primary',None)!='ORDER_MOVED_SERVICE_DATE':raise EventCaptureError('TRANSFER_TRIAL_STALE_RESPONSE_FAILED') from None
 else:raise EventCaptureError('TRANSFER_TRIAL_STALE_RESPONSE_ACCEPTED')
 if writer.call(MOVE,[*STREAMS,'pair-forward-a',ORDERS[0],'2026-10-22T18:00:00Z'])!='ALREADY_RECORDED':raise EventCaptureError('TRANSFER_TRIAL_DEDUP_FAILED')
 commands=[(APPLY,[STREAMS[1],'pair-accept',ORDERS[0],'accept',None,'pair-forward-a_in']),
           (MOVE,[STREAMS[1],STREAMS[0],'pair-back-a',ORDERS[0],'2026-10-21T19:00:00Z']),
           (APPLY,[STREAMS[0],'pair-complete',ORDERS[0],'complete',None,None])]
 for query,params in commands:
  if writer.call(query,params)!='RECORDED':raise EventCaptureError('TRANSFER_TRIAL_ACTION_FAILED')
 final=read(reader,budget)
 if len(final['transfers'])!=3 or sum(len(s['batch']['events']) for s in final['streams'])!=10:raise EventCaptureError('TRANSFER_TRIAL_FINAL_COVERAGE_FAILED')
 store=TransferBundleStore(directory/'transfer-bundles.sqlite3',STREAMS,enabled=True)
 try:
  store.enqueue(final);last=store.run_once()
  if last['comparisons']!=3 or store.verify()!=dict(acknowledged=2,bundles=2):raise EventCaptureError('TRANSFER_TRIAL_FINAL_ACK_FAILED')
 finally:store.close()
 for name,data in [('uncommitted-export.json',before),('moved-export.json',moved),('final-export.json',final)]:
  p=directory/name;p.write_text(canonical(data));p.chmod(0o600)
 return dict(status='OBSERVED',scope='SYNTHETIC_TRANSFER_TRIAL',verified=False,attempts=budget.summary(),transferCount=3,eventCount=10,comparisons=last['comparisons'],interruptedExit=73,restored=True,initialComparisons=recovery['comparisons'],networkRequestsByReplay=0)

def main(env=None):
 env=os.environ if env is None else env
 if env.get('MASTER_WOK_TRANSFER_TRIAL_ENABLED')!='true':print(json.dumps(dict(status='DISABLED',sourceRequests=0,verified=False)),flush=True);return
 expected={'RAILWAY_PROJECT_ID':'7821ad5b-f5c2-4ab4-9206-c3d76eefd4c8','RAILWAY_ENVIRONMENT_ID':'c1b8fad6-dbfc-4188-b4b5-a5dbfbf53279','RAILWAY_SERVICE_ID':'012e5ef6-6225-4ab3-95f5-894583db7e83','MASTER_WOK_EVENT_RUNTIME_SCOPE':'SYNTHETIC_STAGING_EVENTS'}
 if any(env.get(k)!=v for k,v in expected.items()) or any(env.get(k)!='false' for k in FLAGS):raise EventCaptureError('TRANSFER_TRIAL_SCOPE_REFUSED')
 deadline=float(env.get('MASTER_WOK_TRANSFER_TRIAL_END_EPOCH','0'))
 if not time.time()<deadline<=time.time()+600:raise EventCaptureError('TRANSFER_TRIAL_DEADLINE_REFUSED')
 if any(p.is_symlink() for p in [DIRECTORY,*DIRECTORY.parents]):raise EventCaptureError('TRANSFER_TRIAL_PATH_REFUSED')
 DIRECTORY.mkdir(mode=0o700,parents=True,exist_ok=True)
 budget=Budget(DIRECTORY/'attempts.sqlite3',deadline);budget.take('started')
 writer=Writer(env.get('MASTER_WOK_EVENT_WRITER_DSN'),budget)
 reader=TransferPairReader(env.get('MASTER_WOK_EVENT_READER_DSN'),enabled=True)
 result=exercise(writer,reader,budget,DIRECTORY)
 p=DIRECTORY/'trial-result.json';p.write_text(canonical(result));p.chmod(0o600)
 print(json.dumps(result),flush=True)

if __name__=='__main__':
 try:
  if len(sys.argv)==3 and sys.argv[1]=='--interrupt-ack':
   store=TransferBundleStore(Path(sys.argv[2]),STREAMS,enabled=True)
   store.run_once(before_commit=lambda:os._exit(73));raise EventCaptureError('TRANSFER_TRIAL_INTERRUPTION_NOT_REACHED')
  main()
 except Exception as error:
  # Only local error labels or SQLSTATE; never raw DB messages, DSNs or tracebacks.
  reason=str(error) if isinstance(error,EventCaptureError) else 'TRANSFER_TRIAL_FAILED'
  print(json.dumps(dict(status='UNVERIFIED',reasonCode=reason,sqlstate=getattr(error,'sqlstate',None),verified=False)),flush=True);raise SystemExit(1)
