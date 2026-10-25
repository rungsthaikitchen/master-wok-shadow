"""One-shot synthetic staging route-lock/runtime witness; admin switches stay external."""
import json
import os
from pathlib import Path
import sqlite3
import time
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor
from urllib.request import Request,urlopen
from urllib.error import HTTPError
from event_capture_journal import EventCaptureError,canonical
from event_cutover_trial import Budget as BaseBudget,FLAGS,role_check,wait_until,MARKER,BLOCKERS
from event_runtime_transport import connection_parameters
from event_command_router import RoutedTransport,routed_admin,routed_response,APPLY_SQL,READ_QUERY
from event_routed_observer import RoutedObserver
from event_customer_response_staging import issue_token
from event_runtime_http import serve_api

DAY='2026-10-26'
# name, route, source, destination, marker: all dedicated synthetic identities.
CASES=(
 ('before','7629f38e-9e24-5478-8413-e0848ef04cd3','8269cd25-5959-5263-bba7-1dd2c25df88c','24e52bf5-67a6-55fd-a243-d3099eb05577',2510202611),
 ('after','f8da5318-aa1b-54f7-89b5-5a73480ab771','5cf89a7d-436e-511c-b6ae-eb21e21bc245','458086bb-d9bd-5f57-85cd-b64e8f76c95d',2510202612),
 ('rollback','b98c1016-36cc-5106-b3e5-ea796e07475e','18cac038-f114-522c-9784-dc49a16453dd','2093afac-837b-5fcf-b51a-ff22131c31cf',2510202613),
 ('timeout','21fa0874-7578-5288-a60d-0740294e669b','68cb8db0-907d-5bf1-b392-2dd1eaa9b6b3','e2f11d46-6651-5fcb-b20f-966f96adf77f',2510202614),
)
DIRECTORY=Path('/data/command-route-trial-26-oct-v1')
EXTRA_FLAGS=('MASTER_WOK_CUTOVER_TRIAL_ENABLED','MASTER_WOK_CUTOVER_RESPONSE_HTTP_ENABLED','MASTER_WOK_BACKEND_KEY_TRIAL_ENABLED','MASTER_WOK_KEY_COMPATIBILITY_ENABLED')
ROUTE_LOCK="SELECT pg_advisory_xact_lock(hashtextextended('master-wok-route:'||%s::uuid::text,0))"
EXPORT='SELECT master_wok_event_test.export_command_route(%s::uuid)'

class Budget(BaseBudget):LIMITS={'started':1,'probe':180,'write':16,'read':16}
def emit(**data):print(canonical(dict(data,verified=False)),flush=True)
def configuration(env,now=None):
 if env.get('MASTER_WOK_COMMAND_ROUTE_TRIAL_ENABLED')!='true':return None
 now=time.time() if now is None else now
 expected={'RAILWAY_PROJECT_ID':'7821ad5b-f5c2-4ab4-9206-c3d76eefd4c8','RAILWAY_ENVIRONMENT_ID':'c1b8fad6-dbfc-4188-b4b5-a5dbfbf53279','RAILWAY_SERVICE_ID':'012e5ef6-6225-4ab3-95f5-894583db7e83','MASTER_WOK_EVENT_RUNTIME_SCOPE':'SYNTHETIC_STAGING_EVENTS'}
 if any(env.get(k)!=v for k,v in expected.items()) or any(env.get(k)!='false' for k in (*FLAGS,*EXTRA_FLAGS)):raise EventCaptureError('COMMAND_ROUTE_SCOPE_REFUSED')
 try:deadline=float(env.get('MASTER_WOK_COMMAND_ROUTE_TRIAL_END_EPOCH','0'))
 except (ValueError,TypeError):raise EventCaptureError('COMMAND_ROUTE_DEADLINE_REFUSED') from None
 if not now<deadline<=now+600 or deadline>=datetime.fromisoformat(DAY+'T18:00:00Z').timestamp():raise EventCaptureError('COMMAND_ROUTE_DEADLINE_REFUSED')
 return deadline,connection_parameters(env.get('MASTER_WOK_EVENT_READER_DSN'),'reader'),connection_parameters(env.get('MASTER_WOK_EVENT_WRITER_DSN'),'writer')

def exercise_http(server,operator,secret,writer,deadline):
 c=CASES[0];alias='synthetic-route-before';base='http://127.0.0.1:'+str(server.server_port);calls=0
 def post(body,expected,result=None,authorized=True):
  nonlocal calls
  if time.time()>=deadline:raise EventCaptureError('COMMAND_ROUTE_DEADLINE_REFUSED')
  headers={'Content-Type':'application/json'}
  if authorized:headers['Authorization']='Bearer '+operator
  req=Request(base+'/staging/cutover-proposal-response',data=json.dumps(body).encode(),headers=headers);calls+=1
  try:r=urlopen(req,timeout=20)
  except HTTPError as error:r=error
  with r:code=r.status;data=json.loads(r.read(8192))
  if code!=expected or (result and data.get('status')!=result):raise EventCaptureError('COMMAND_ROUTE_HTTP_RESULT_REFUSED')
 old=dict(token=issue_token(c[2],alias,'route-offer-before',enabled=True,secret=secret),decision='accept')
 post(old,401,authorized=False);post(dict(old,destination=c[3]),409)
 post(old,200,'RECORDED');post(old,200,'ALREADY_RECORDED')
 routed_admin(c[1],'route-offer-b',alias,'offer',DAY+'T19:30:00Z',enabled=True,transport=writer)
 post(dict(old,decision='reject'),409);post(old,200,'ALREADY_RECORDED')
 new=dict(token=issue_token(c[3],alias,'route-offer-b',enabled=True,secret=secret),decision='reject')
 post(new,200,'RECORDED');post(new,200,'ALREADY_RECORDED')
 return calls

class Trial:
 def __init__(self,reader,writer_parameters,budget,root,route_reader,route_writer):
  self.reader=reader;self.parameters=writer_parameters;self.budget=budget;self.root=root;self.route_reader=route_reader;self.route_writer=route_writer;self.evidence=[]
 def probe(self,q,p):
  if q not in (MARKER,BLOCKERS):raise EventCaptureError('COMMAND_ROUTE_QUERY_REFUSED')
  self.budget.take('probe');return self.reader.execute(q,p).fetchall()
 def marker(self,c):
  rows=self.probe(MARKER,[c[4]]);return rows[0][0] if len(rows)==1 else None
 def blocked(self,pid,blocker):return blocker in self.probe(BLOCKERS,[pid])[0][0]
 def packet(self,c):
  self.budget.take('read');return self.reader.execute(EXPORT,[c[1]]).fetchone()[0]
 def preflight(self):
  for c in CASES:
   p=self.packet(c)
   if not p or p['generation']!=0 or p['streamId']!=c[2] or p['eventCount']!=2 or p['serviceDate']!=DAY or p['enabled'] is not True:raise EventCaptureError('COMMAND_ROUTE_FIXTURE_REQUIRED')
 def writer(self,short=False):
  import psycopg
  p=dict(self.parameters,options='-c statement_timeout=40000 -c lock_timeout='+('300' if short else '35000')+' -c idle_in_transaction_session_timeout=120000')
  conn=psycopg.connect(**p)
  try:
   role_check(conn,'writer')
   row=conn.execute("SELECT has_table_privilege(current_user,'master_wok_event_test.command_routes','INSERT,UPDATE,DELETE'),has_function_privilege(current_user,'master_wok_event_test.switch_command_route(uuid,integer,uuid,text)','EXECUTE')").fetchone()
   if row!=(False,False):raise EventCaptureError('COMMAND_ROUTE_PRIVILEGES_REFUSED')
   return conn
  except Exception:conn.close();raise
 def offer(self,conn,c):
  self.budget.take('write')
  return conn.execute(APPLY_SQL,[c[1],'route-offer-'+c[0],'synthetic-route-'+c[0],'offer',DAY+'T19:15:00Z',None,None]).fetchone()[0]
 def observer(self):return RoutedObserver(self.root/'observer',CASES[0][1],self.route_reader,enabled=True,read_limit=8)
 def before(self):
  c=CASES[0];observer=self.observer()
  try:
   if observer.cycle()['status']!='OBSERVED':raise EventCaptureError('COMMAND_ROUTE_INITIAL_OBSERVER_FAILED')
   with self.writer() as conn:
    if self.offer(conn,c)!='RECORDED':raise EventCaptureError('COMMAND_ROUTE_WRITER_FAILED')
    pid=conn.execute('SELECT pg_backend_pid()').fetchone()[0];emit(status='WAITING_FOR_ADMIN',phase='before',writerPid=pid)
    def witness():
     admin=self.marker(c);return admin if admin and self.blocked(admin,pid) else None
    admin=wait_until(witness,self.budget)
    self.evidence.append(dict(case='before',switchBlockedByRoutedWriter=True,writerPid=pid,adminPid=admin))
   emit(status='WRITER_COMMITTED',phase='before')
   def switched():
    self.budget.take('probe');return self.reader.execute('SELECT generation FROM master_wok_event_test.command_routes WHERE id=%s::uuid',[c[1]]).fetchone()[0]==1
   wait_until(switched,self.budget)
   p=self.packet(c)
   if p['previousEventCount']!=3 or p['batch']['events'][0]['commitments'][0]['proposalEventId']!='route-offer-before':raise EventCaptureError('COMMAND_ROUTE_SEALED_PREFIX_FAILED')
   def crash():raise EventCaptureError('INJECTED_BEFORE_CHECKPOINT')
   interrupted=observer.cycle(before_route_commit=crash)
   if interrupted['reasonCode']!='INJECTED_BEFORE_CHECKPOINT' or observer.status()['healthy']:raise EventCaptureError('COMMAND_ROUTE_CRASH_WITNESS_FAILED')
  finally:observer.close()
  observer=self.observer()
  try:
   if observer.status()['healthy'] or observer.cycle()['status']!='OBSERVED':raise EventCaptureError('COMMAND_ROUTE_RECOVERY_FAILED')
   secret=os.urandom(32);operator=os.urandom(32).hex();health=os.urandom(32).hex()
   def callback(body):return routed_response('POST',body,c[1],enabled=True,secret=secret,transport=self.route_writer)
   server,thread=serve_api(c[1],operator,health,self.route_writer,lambda:observer.status()['healthy'],cutover_response=callback)
   try:calls=exercise_http(server,operator,secret,self.route_writer,self.budget.deadline)
   finally:server.shutdown();server.server_close();thread.join(timeout=2)
   if observer.cycle()['status']!='OBSERVED':raise EventCaptureError('COMMAND_ROUTE_FINAL_OBSERVER_FAILED')
   counts=[]
   for stream in (c[2],c[3]):
    with sqlite3.connect(self.root/'observer'/stream/'event-capture.sqlite3') as db:counts.append(db.execute('SELECT count(*) FROM observations').fetchone()[0])
   p=self.packet(c)
   if counts!=[2,1] or p['previousEventCount']!=3 or p['eventCount']!=4:raise EventCaptureError('COMMAND_ROUTE_OBSERVATION_COUNTS_FAILED')
   self.evidence.append(dict(case='runtime',httpCalls=calls,retiredEvents=3,currentEvents=4,retiredDecisions=2,currentDecisions=1,interruptedBeforeCheckpoint=True,restartRecoveryVerified=True,healthy=observer.status()['healthy']))
   return p
  finally:observer.close()
 def waiter(self,c,rollback=False):
  emit(status='WAITING_FOR_ADMIN',phase=c[0]);admin=wait_until(lambda:self.marker(c),self.budget)
  with self.writer() as conn:
   pid=conn.execute('SELECT pg_backend_pid()').fetchone()[0]
   with ThreadPoolExecutor(max_workers=1) as pool:
    future=pool.submit(self.offer,conn,c);wait_until(lambda:self.blocked(pid,admin),self.budget,seconds=15)
    p=self.packet(c)
    if p['generation']!=0 or p['eventCount']!=2 or p['streamId']!=c[2]:raise EventCaptureError('COMMAND_ROUTE_TORN_EXPORT')
    self.evidence.append(dict(case=c[0],writerBlockedBySwitch=True,readerSawCommittedRouteOnly=True,writerPid=pid,adminPid=admin))
    if future.result(timeout=35)!='RECORDED':raise EventCaptureError('COMMAND_ROUTE_WAITING_WRITER_FAILED')
  p=self.packet(c)
  expected=(0,c[2],3) if rollback else (1,c[3],2)
  if (p['generation'],p['streamId'],p['eventCount'])!=expected:raise EventCaptureError('COMMAND_ROUTE_WAITING_DESTINATION_FAILED')
  emit(status='WITNESSED',phase=c[0],destination='ORIGINAL_AFTER_ROLLBACK' if rollback else 'CURRENT_AFTER_COMMIT');return p
 def timeout(self):
  c=CASES[3]
  with self.writer() as holder:
   holder.execute(ROUTE_LOCK,[c[1]])
   with self.writer(short=True) as waiter:
    try:self.offer(waiter,c)
    except Exception as error:
     if getattr(error,'sqlstate',None)!='55P03':raise EventCaptureError('COMMAND_ROUTE_LOCK_TIMEOUT_UNPROVEN') from None
     waiter.rollback()
    else:raise EventCaptureError('COMMAND_ROUTE_LOCK_TIMEOUT_MISSING')
   holder.rollback()
  with self.writer() as retry:
   if self.offer(retry,c)!='RECORDED' or self.offer(retry,c)!='ALREADY_RECORDED':raise EventCaptureError('COMMAND_ROUTE_EXACT_RETRY_FAILED')
  p=self.packet(c)
  if p['generation']!=0 or p['eventCount']!=3:raise EventCaptureError('COMMAND_ROUTE_TIMEOUT_PARTIAL_WRITE')
  self.evidence.append(dict(case='timeout',sqlstate='55P03',exactRetry='RECORDED_THEN_ALREADY_RECORDED',eventCount=3));return p

def main(env=None):
 env=os.environ if env is None else env;config=configuration(env)
 if config is None:emit(status='DISABLED',sourceRequests=0);return
 deadline,rp,wp=config
 if any(p.is_symlink() for p in (DIRECTORY,*DIRECTORY.parents)):raise EventCaptureError('COMMAND_ROUTE_PATH_REFUSED')
 DIRECTORY.mkdir(parents=True,exist_ok=True,mode=0o700);budget=Budget(DIRECTORY/'attempts.sqlite3',deadline);budget.take('started')
 def bounded(kind,transport):
  def call(payload):budget.take(kind);return transport(payload)
  return call
 rr=bounded('read',RoutedTransport(env.get('MASTER_WOK_EVENT_READER_DSN'),enabled=True))
 rw=bounded('write',RoutedTransport(env.get('MASTER_WOK_EVENT_WRITER_DSN'),'writer',enabled=True))
 import psycopg
 with psycopg.connect(**rp,autocommit=True) as reader:
  role_check(reader,'reader');trial=Trial(reader,wp,budget,DIRECTORY,rr,rw);trial.preflight()
  packets=dict(before=trial.before(),after=trial.waiter(CASES[1]),rollback=trial.waiter(CASES[2],True),timeout=trial.timeout())
 outcome=dict(status='OBSERVED',scope='SYNTHETIC_STAGING_COMMAND_ROUTE',evidence=trial.evidence,attempts=budget.summary(),notifications=0,productionWrites=0,verified=False)
 for name,value in [('packets.json',packets),('result.json',outcome)]:
  path=DIRECTORY/name;path.write_text(canonical(value));path.chmod(0o600)
 emit(**{k:v for k,v in outcome.items() if k!='verified'})

if __name__=='__main__':
 try:main()
 except Exception as error:
  emit(status='UNVERIFIED',reasonCode=str(error) if isinstance(error,EventCaptureError) else 'COMMAND_ROUTE_TRIAL_FAILED',sqlstate=getattr(error,'sqlstate',None));raise SystemExit(1)
