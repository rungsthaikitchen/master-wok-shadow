"""Bounded private-staging concurrency witness. Administrative seeding stays external."""
import json
import os
from pathlib import Path
import sqlite3
import time
from concurrent.futures import ThreadPoolExecutor
from event_capture_journal import EventCaptureError,canonical
from event_runtime_transport import connection_parameters,ROLES

CASES=(
 ('before','a6b17a1d-2df6-42e4-8ebb-5ffc37a4ad36','a5fb7fff-3acd-450f-89cb-8457f58c6fe4','8a9104e1-2f1d-44f5-a56b-f8fb791e3f97',2110202601),
 ('after','a52623e7-f829-4dc5-a1ab-d717f023c514','1834bee9-2cc5-4690-8028-5aef07ce659e','5a23e598-c909-4d9b-9acc-878b6eed7ee6',2110202602),
 ('rollback','93a4fafb-09f9-4f2e-af5a-0bc2aba1ba34','dc668793-a0a6-4b73-bb40-f5e6b4a04793','ea5797d8-7b98-4c91-b21b-1dc4f9f87cc2',2110202603),
 ('timeout','d8316ae4-1053-48f7-9f6b-cd93513c6cd3','b492dc0a-196e-4702-980c-b66e46420577','59b42331-0807-4ed3-b135-f36092e80add',2110202604))
DIRECTORY=Path('/data/cutover-trial-21-oct')
FLAGS=('MASTER_WOK_EVENT_RUNTIME_ENABLED','MASTER_WOK_EVENT_RUNTIME_TRIAL_ENABLED','MASTER_WOK_EVENT_CLOUD_BACKUP_ENABLED','MASTER_WOK_EVENT_SOAK_ENABLED','MASTER_WOK_SIGNED_HTTP_TRIAL_ENABLED','MASTER_WOK_BOOKING_HTTP_TRIAL_ENABLED','MASTER_WOK_TERMINAL_HTTP_TRIAL_ENABLED','MASTER_WOK_DELIVERY_HTTP_TRIAL_ENABLED','MASTER_WOK_CONTINUOUS_STAGING_ENABLED','MASTER_WOK_PREPARED_STAGING_ENABLED','MASTER_WOK_TRANSFER_TRIAL_ENABLED','MASTER_WOK_TRANSFER_MONITOR_ENABLED','MASTER_WOK_TRANSFER_MONITOR_RECOVERY_ENABLED')
MARKER="SELECT pid FROM pg_locks WHERE locktype='advisory' AND classid=0 AND objid=%s::oid AND objsubid=1 AND granted"
BLOCKERS='SELECT pg_blocking_pids(%s::integer)'
STATE='SELECT id::text,enabled,event_count,master_wok_event_test.export(id) FROM master_wok_event_test.streams WHERE id=ANY(%s::uuid[]) ORDER BY id'
APPLY='SELECT master_wok_event_test.apply_booking(%s::uuid,%s::text,%s::uuid,%s::text,%s::timestamptz,%s::text)'
LOCK='SELECT id FROM master_wok_event_test.streams WHERE id=%s::uuid FOR UPDATE'

def emit(**data):print(canonical(dict(data,verified=False)),flush=True)

def configuration(env,now=None):
 if env.get('MASTER_WOK_CUTOVER_TRIAL_ENABLED')!='true':return None
 now=time.time() if now is None else now
 expected={'RAILWAY_PROJECT_ID':'7821ad5b-f5c2-4ab4-9206-c3d76eefd4c8','RAILWAY_ENVIRONMENT_ID':'c1b8fad6-dbfc-4188-b4b5-a5dbfbf53279','RAILWAY_SERVICE_ID':'012e5ef6-6225-4ab3-95f5-894583db7e83','MASTER_WOK_EVENT_RUNTIME_SCOPE':'SYNTHETIC_STAGING_EVENTS'}
 if any(env.get(k)!=v for k,v in expected.items()) or any(env.get(k)!='false' for k in FLAGS):raise EventCaptureError('CUTOVER_TRIAL_SCOPE_REFUSED')
 try:deadline=float(env.get('MASTER_WOK_CUTOVER_TRIAL_END_EPOCH','0'))
 except (ValueError,TypeError):raise EventCaptureError('CUTOVER_TRIAL_DEADLINE_REFUSED') from None
 if not now<deadline<=now+600:raise EventCaptureError('CUTOVER_TRIAL_DEADLINE_REFUSED')
 return deadline,connection_parameters(env.get('MASTER_WOK_EVENT_READER_DSN'),'reader'),connection_parameters(env.get('MASTER_WOK_EVENT_WRITER_DSN'),'writer')

class Budget:
 LIMITS={'started':1,'probe':180,'write':6,'read':6}
 def __init__(self,path,deadline,clock=time.time):
  self.path=Path(path);self.deadline=deadline;self.clock=clock
  if any(p.is_symlink() for p in (self.path,*self.path.parents)):raise EventCaptureError('CUTOVER_TRIAL_PATH_REFUSED')
  with sqlite3.connect(self.path) as db:db.execute('CREATE TABLE IF NOT EXISTS attempts(kind TEXT PRIMARY KEY,used INTEGER NOT NULL)')
  self.path.chmod(0o600)
 def take(self,kind):
  if kind not in self.LIMITS or not self.clock()<self.deadline:raise EventCaptureError('CUTOVER_TRIAL_BUDGET_REFUSED')
  with sqlite3.connect(self.path,timeout=5) as db:
   db.execute('BEGIN IMMEDIATE');row=db.execute('SELECT used FROM attempts WHERE kind=?',(kind,)).fetchone();used=row[0] if row else 0
   if used>=self.LIMITS[kind]:raise EventCaptureError('CUTOVER_TRIAL_BUDGET_EXHAUSTED')
   db.execute('INSERT OR REPLACE INTO attempts VALUES (?,?)',(kind,used+1))
 def summary(self):
  with sqlite3.connect(self.path) as db:return dict(db.execute('SELECT kind,used FROM attempts'))

def role_check(conn,kind):
 row=conn.execute('SELECT current_user,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user').fetchone()
 if row!=(ROLES[kind],False,False):raise EventCaptureError('DATABASE_ROLE_UNPROVEN')
 row=conn.execute("SELECT has_function_privilege(current_user,'master_wok_event_test.seed_cutover_baseline(uuid,uuid,text)','EXECUTE'),has_column_privilege(current_user,'master_wok_event_test.streams','enabled','UPDATE')").fetchone()
 if row!=(False,False):raise EventCaptureError('CUTOVER_TRIAL_PRIVILEGES_REFUSED')

def wait_until(check,budget,*,seconds=100):
 stop=min(time.monotonic()+seconds,time.monotonic()+max(0,budget.deadline-time.time()))
 while time.monotonic()<stop:
  value=check()
  if value:return value
  time.sleep(1)
 raise EventCaptureError('CUTOVER_TRIAL_WITNESS_TIMEOUT')

class Trial:
 def __init__(self,reader,writer_parameters,budget,*,connect=None):
  self.reader=reader;self.parameters=writer_parameters;self.budget=budget;self.connect=connect;self.evidence=[]
 def probe(self,query,params):
  if query not in (MARKER,BLOCKERS):raise EventCaptureError('CUTOVER_TRIAL_QUERY_REFUSED')
  self.budget.take('probe');return self.reader.execute(query,params).fetchall()
 def marker(self,key):
  rows=self.probe(MARKER,[key]);return rows[0][0] if len(rows)==1 else None
 def blocked(self,pid,blocker):return blocker in self.probe(BLOCKERS,[pid])[0][0]
 def state(self,case):
  self.budget.take('read');rows=self.reader.execute(STATE,[[case[1],case[2]]]).fetchall()
  if len(rows)!=2:raise EventCaptureError('CUTOVER_TRIAL_STATE_REQUIRED')
  return {row[0]:dict(enabled=row[1],count=row[2],batch=row[3]) for row in rows}
 def writer(self,*,short=False):
  import psycopg
  parameters=dict(self.parameters,options='-c statement_timeout=40000 -c lock_timeout='+('300' if short else '35000')+' -c idle_in_transaction_session_timeout=120000')
  conn=(self.connect or psycopg.connect)(**parameters);role_check(conn,'writer');return conn
 def offer(self,conn,case,request):
  self.budget.take('write');return conn.execute(APPLY,[case[1],request,case[3],'offer','2026-10-22T19:15:00Z',None]).fetchone()[0]
 def before(self):
  c=CASES[0]
  with self.writer() as conn:
   self.offer(conn,c,'cutover-direct-before');pid=conn.execute('SELECT pg_backend_pid()').fetchone()[0]
   emit(status='WAITING_FOR_ADMIN',phase='before',writerPid=pid)
   def witness():
    seed_pid=self.marker(c[4]);return seed_pid if seed_pid and self.blocked(seed_pid,pid) else None
   seed_pid=wait_until(witness,self.budget)
   self.evidence.append(dict(case='before',writerPid=pid,seedPid=seed_pid,seedBlockedByWriter=True))
  # Writer committed. Only now may the management seed acquire its locks and copy.
  emit(status='WRITER_COMMITTED',phase='before')
  def committed():
   self.budget.take('probe')
   return self.reader.execute('SELECT NOT enabled FROM master_wok_event_test.streams WHERE id=%s::uuid',[c[1]]).fetchone()[0]
  wait_until(committed,self.budget)
  state=self.state(c);baseline=state[c[2]]['batch']['events'][0]
  if baseline['commitments'][0]['proposalEventId']!='cutover-direct-before':raise EventCaptureError('CUTOVER_TRIAL_MISSING_COMMITTED_WRITER')
  return state
 def waiter(self,c,*,rollback=False):
  emit(status='WAITING_FOR_ADMIN',phase=c[0])
  seed_pid=wait_until(lambda:self.marker(c[4]),self.budget)
  with self.writer() as conn:
   pid=conn.execute('SELECT pg_backend_pid()').fetchone()[0]
   with ThreadPoolExecutor(max_workers=1) as pool:
    future=pool.submit(self.offer,conn,c,'cutover-direct-'+c[0])
    wait_until(lambda:self.blocked(pid,seed_pid),self.budget,seconds=15)
    old=self.state(c)
    if not old[c[1]]['enabled'] or old[c[2]]['count']!=0 or old[c[2]]['batch'] is not None:raise EventCaptureError('CUTOVER_TRIAL_TORN_SNAPSHOT')
    self.evidence.append(dict(case=c[0],writerPid=pid,seedPid=seed_pid,writerBlockedBySeed=True,readerSawOnlyCommittedState=True))
    if rollback:
     if future.result(timeout=35)!='RECORDED':raise EventCaptureError('CUTOVER_TRIAL_ROLLBACK_WRITER_FAILED')
    else:
     try:future.result(timeout=35)
     except Exception as error:
      if getattr(error,'sqlstate',None)!='P0001' or getattr(getattr(error,'diag',None),'message_primary',None)!='SOURCE_DISABLED':raise EventCaptureError('CUTOVER_TRIAL_OLD_WRITER_NOT_REFUSED') from None
      conn.rollback()
     else:raise EventCaptureError('CUTOVER_TRIAL_OLD_WRITER_ACCEPTED')
  final=self.state(c)
  if rollback and (not final[c[1]]['enabled'] or final[c[2]]['count']!=0 or final[c[1]]['count']!=2):raise EventCaptureError('CUTOVER_TRIAL_ROLLBACK_STATE_FAILED')
  if not rollback and (final[c[1]]['enabled'] or final[c[2]]['count']!=1 or final[c[1]]['count']!=1):raise EventCaptureError('CUTOVER_TRIAL_COMMITTED_STATE_FAILED')
  emit(status='WITNESSED',phase=c[0],result='WRITER_RECORDED_AFTER_ROLLBACK' if rollback else 'SOURCE_DISABLED')
  return final
 def timeout(self):
  c=CASES[3]
  with self.writer() as holder:
   holder.execute(LOCK,[c[1]])
   with self.writer(short=True) as waiter:
    try:self.offer(waiter,c,'cutover-timeout-retry')
    except Exception as error:
     if getattr(error,'sqlstate',None)!='55P03':raise EventCaptureError('CUTOVER_TRIAL_TIMEOUT_UNPROVEN') from None
     waiter.rollback()
    else:raise EventCaptureError('CUTOVER_TRIAL_TIMEOUT_MISSING')
   holder.rollback()
  with self.writer() as retry:
   if self.offer(retry,c,'cutover-timeout-retry')!='RECORDED':raise EventCaptureError('CUTOVER_TRIAL_RETRY_FAILED')
  state=self.state(c)
  if state[c[1]]['count']!=2 or state[c[2]]['count']!=0:raise EventCaptureError('CUTOVER_TRIAL_TIMEOUT_PARTIAL_WRITE')
  self.evidence.append(dict(case='timeout',lockTimeout='55P03',sameRequestRetry='RECORDED',sourceEvents=2))
  return state

def main(env=None):
 env=os.environ if env is None else env;config=configuration(env)
 if config is None:emit(status='DISABLED',sourceRequests=0);return
 deadline,reader_params,writer_params=config
 if any(p.is_symlink() for p in (DIRECTORY,*DIRECTORY.parents)):raise EventCaptureError('CUTOVER_TRIAL_PATH_REFUSED')
 DIRECTORY.mkdir(parents=True,exist_ok=True,mode=0o700)
 budget=Budget(DIRECTORY/'attempts.sqlite3',deadline);budget.take('started')
 import psycopg
 with psycopg.connect(**reader_params,autocommit=True) as reader:
  role_check(reader,'reader');trial=Trial(reader,writer_params,budget)
  states={'before':trial.before(),'after':trial.waiter(CASES[1]),'rollback':trial.waiter(CASES[2],rollback=True),'timeout':trial.timeout()}
 result=dict(status='OBSERVED',scope='SYNTHETIC_CUTOVER_TRIAL',evidence=trial.evidence,attempts=budget.summary(),verified=False)
 for name,value in [('states.json',states),('result.json',result)]:
  target=DIRECTORY/name;target.write_text(canonical(value));target.chmod(0o600)
 emit(**{k:v for k,v in result.items() if k!='verified'})

if __name__=='__main__':
 try:main()
 except Exception as error:
  emit(status='UNVERIFIED',reasonCode=str(error) if isinstance(error,EventCaptureError) else 'CUTOVER_TRIAL_FAILED',sqlstate=getattr(error,'sqlstate',None))
  raise SystemExit(1)
