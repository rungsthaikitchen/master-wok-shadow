"""One-start synthetic staging staff-command rehearsal. No production transport."""
import json
import os
import re
import subprocess
import time
from pathlib import Path
from uuid import UUID
from concurrent.futures import ThreadPoolExecutor
from event_capture_journal import EventCaptureError,canonical
from event_runtime_transport import connection_parameters,ROLES
from event_cutover_trial import Budget as BaseBudget,FLAGS,role_check,wait_until
from event_checkout_trial import EXTRA_FLAGS
from event_runtime_http import serve_api

ROOT=Path(__file__).resolve().parent.parent
CASES=json.loads((ROOT/'fixtures/staff-command-trial-27-oct-v1.json').read_text())
DIRECTORY=Path('/data/staff-command-trial-27-oct-v1')
SQL='SELECT master_wok_event_test.apply_staff_command(%s::uuid,%s::uuid,%s::text,%s::uuid,%s::integer,%s::text,%s::timestamptz)'
ACTOR='a'*64
def emit(**data):print(canonical(data),flush=True)
def configuration(env,now=None):
 if env.get('MASTER_WOK_STAFF_COMMAND_TRIAL_ENABLED')!='true':return None
 now=time.time() if now is None else now
 expected={'RAILWAY_PROJECT_ID':'7821ad5b-f5c2-4ab4-9206-c3d76eefd4c8','RAILWAY_ENVIRONMENT_ID':'c1b8fad6-dbfc-4188-b4b5-a5dbfbf53279','RAILWAY_SERVICE_ID':'012e5ef6-6225-4ab3-95f5-894583db7e83','MASTER_WOK_EVENT_RUNTIME_SCOPE':'SYNTHETIC_STAGING_EVENTS'}
 if any(env.get(k)!=v for k,v in expected.items()) or any(env.get(k)!='false' for k in (*FLAGS,*EXTRA_FLAGS,'MASTER_WOK_CHECKOUT_TRIAL_ENABLED','MASTER_WOK_FULL_CHECKOUT_TRIAL_ENABLED')):raise EventCaptureError('STAFF_TRIAL_SCOPE_REFUSED')
 if any(k.startswith('MASTER_WOK_') and k.endswith('_ENABLED') and k!='MASTER_WOK_STAFF_COMMAND_TRIAL_ENABLED' and v!='false' for k,v in env.items()):raise EventCaptureError('STAFF_TRIAL_OTHER_FLAG_REFUSED')
 try:deadline=float(env.get('MASTER_WOK_STAFF_COMMAND_TRIAL_END_EPOCH','0'))
 except (ValueError,TypeError):raise EventCaptureError('STAFF_TRIAL_DEADLINE_REFUSED') from None
 if not now<deadline<=now+600 or deadline>=1793206800:raise EventCaptureError('STAFF_TRIAL_DEADLINE_REFUSED') # 28 Oct 17:00 UTC
 return deadline,connection_parameters(env.get('MASTER_WOK_EVENT_READER_DSN'),'reader'),connection_parameters(env.get('MASTER_WOK_EVENT_WRITER_DSN'),'writer')
class Budget(BaseBudget):LIMITS={'started':1,'probe':40,'write':30,'read':30}
def arguments(f,c,actor=ACTOR):
 if not isinstance(c,dict) or set(c)!={'version','commandId','orderId','expectedRevision','action',*(['target'] if c.get('action')=='offer' else [])} or c.get('version')!=1 or c.get('orderId')!=f['order'] or type(c.get('expectedRevision')) is not int or not 1<=c['expectedRevision']<=1000 or c.get('action') not in ('offer','confirm','cancel','complete') or not isinstance(actor,str) or re.fullmatch('[a-f0-9]{64}',actor) is None:raise EventCaptureError('STAFF_HTTP_COMMAND_REFUSED')
 try:
  if str(UUID(c['commandId']))!=c['commandId']:raise ValueError()
 except (ValueError,TypeError,AttributeError):raise EventCaptureError('STAFF_HTTP_COMMAND_REFUSED') from None
 if c['action']=='offer' and c['target'] not in (f['day']+'T19:30:00Z',f['day']+'T20:00:00Z'):raise EventCaptureError('STAFF_HTTP_TARGET_REFUSED')
 return [f['route'],c['commandId'],actor,f['order'],c['expectedRevision'],c['action'],c.get('target')]
def command(f,alternate=False):return dict(version=1,commandId=f['alternate'] if alternate else f['command'],orderId=f['order'],expectedRevision=2,action='offer',target=f['day']+'T19:30:00Z')
class Trial:
 def __init__(self,reader,parameters,budget):self.reader=reader;self.parameters=parameters;self.budget=budget;self.evidence=[]
 def writer(self,short=False):
  import psycopg
  conn=psycopg.connect(**dict(self.parameters,options='-c statement_timeout=15000 -c lock_timeout='+('300' if short else '10000')+' -c idle_in_transaction_session_timeout=20000'))
  try:
   role_check(conn,'writer')
   rights=conn.execute("SELECT has_table_privilege(current_user,'master_wok_event_test.staff_commands','UPDATE,DELETE'),has_table_privilege(current_user,'master_wok_event_test.command_routes','INSERT,UPDATE,DELETE'),has_function_privilege(current_user,'master_wok_event_test.apply_staff_command(uuid,uuid,text,uuid,integer,text,timestamptz)','EXECUTE')").fetchone()
   if rights!=(False,False,True):raise EventCaptureError('STAFF_TRIAL_PRIVILEGES_REFUSED')
   return conn
  except Exception:conn.close();raise
 def state(self,f):
  self.budget.take('read')
  row=self.reader.execute('SELECT enabled,event_count,master_wok_event_test.export(id) FROM master_wok_event_test.streams WHERE id=%s::uuid',[f['stream']]).fetchone()
  if row is None or row[0] is not True:raise EventCaptureError('STAFF_FIXTURE_REFUSED')
  audit=self.reader.execute('SELECT count(*) FROM master_wok_event_test.staff_commands WHERE route_id=%s::uuid',[f['route']]).fetchone()[0]
  return dict(eventCount=row[1],auditRows=audit,batch=row[2])
 def write(self,conn,f,c=None,actor=ACTOR):
  self.budget.take('write');return conn.execute(SQL,arguments(f,c or command(f),actor)).fetchone()[0]
 def blocked(self,pid,holder):
  self.budget.take('probe');return holder in self.reader.execute('SELECT pg_blocking_pids(%s::integer)',[pid]).fetchone()[0]
 def concurrent(self,f,mode):
  with self.writer() as holder,self.writer() as waiter:
   if self.write(holder,f)!=dict(status='RECORDED',revision=3):raise EventCaptureError('STAFF_HOLDER_FAILED')
   hp=holder.execute('SELECT pg_backend_pid()').fetchone()[0];wp=waiter.execute('SELECT pg_backend_pid()').fetchone()[0]
   if hp==wp:raise EventCaptureError('STAFF_CONNECTIONS_NOT_DISTINCT')
   with ThreadPoolExecutor(max_workers=1) as pool:
    future=pool.submit(self.write,waiter,f,command(f,mode=='competing'))
    wait_until(lambda:self.blocked(wp,hp),self.budget,seconds=8)
    before=self.state(f)
    if before['eventCount']!=2 or before['auditRows']!=0:raise EventCaptureError('STAFF_UNCOMMITTED_VISIBLE')
    if mode=='rollback':holder.rollback()
    else:holder.commit()
    try:outcome=future.result(timeout=15)
    except Exception as error:
     if mode!='competing' or getattr(error,'sqlstate',None)!='P0001' or getattr(getattr(error,'diag',None),'message_primary',None)!='STAFF_REVISION_CONFLICT':raise
     waiter.rollback();outcome=dict(status='STAFF_REVISION_CONFLICT')
    else:
     expected='ALREADY_RECORDED' if mode=='same-id' else 'RECORDED'
     if outcome!=dict(status=expected,revision=3):raise EventCaptureError('STAFF_WAITER_FAILED')
     waiter.commit()
  after=self.state(f)
  if after['eventCount']!=3 or after['auditRows']!=1:raise EventCaptureError('STAFF_CONCURRENT_COUNTS_FAILED')
  self.evidence.append(dict(case=mode,writerPid=hp,waiterPid=wp,waiterBlocked=True,uncommittedEventAndAuditInvisible=True,outcome=outcome,eventCount=3,auditRows=1))
  emit(status='WITNESSED',case=mode,outcome=outcome)
 def timeout(self,f):
  with self.writer() as holder:
   holder.execute('SELECT id FROM master_wok_event_test.streams WHERE id=%s::uuid FOR UPDATE',[f['stream']])
   with self.writer(short=True) as waiter:
    try:self.write(waiter,f)
    except Exception as error:
     if getattr(error,'sqlstate',None)!='55P03':raise
     waiter.rollback()
    else:raise EventCaptureError('STAFF_TIMEOUT_NOT_OBSERVED')
   holder.rollback()
  with self.writer() as retry:
   if self.write(retry,f)!=dict(status='RECORDED',revision=3) or self.write(retry,f)!=dict(status='ALREADY_RECORDED',revision=3):raise EventCaptureError('STAFF_TIMEOUT_RETRY_FAILED')
  p=self.state(f)
  if p['eventCount']!=3 or p['auditRows']!=1:raise EventCaptureError('STAFF_TIMEOUT_COUNTS_FAILED')
  self.evidence.append(dict(case='timeout',sqlstate='55P03',retryIdempotent=True,eventCount=3,auditRows=1))
 def audit_failure(self,f):
  before=self.state(f)
  with self.writer() as conn:
   try:self.write(conn,f)
   except Exception as error:
    if getattr(error,'sqlstate',None)!='42501':raise
    conn.rollback()
   else:raise EventCaptureError('STAFF_AUDIT_FAILURE_NOT_OBSERVED')
  if self.state(f)!=before:raise EventCaptureError('STAFF_AUDIT_ROLLBACK_FAILED')
  self.evidence.append(dict(case='audit',sqlstate='42501',eventAndAuditAndHoldUnchanged=True,eventCount=2,auditRows=0))
def http_trial(trial,f,deadline):
 operator=os.urandom(32).hex();health=os.urandom(32).hex();lost=[False]
 def apply(body):
  if not isinstance(body,dict) or set(body)!={'actorId','command'}:raise EventCaptureError('STAFF_HTTP_ENVELOPE_REQUIRED')
  args=arguments(f,body['command'],body['actorId']);trial.budget.take('write')
  with trial.writer() as conn:result=conn.execute(SQL,args).fetchone()[0]
  if result['status']=='RECORDED' and not lost[0]:lost[0]=True;raise EventCaptureError('INJECTED_AFTER_COMMIT')
  return result
 def unused(_):raise EventCaptureError('UNUSED_STAGING_ROUTE')
 server,thread=serve_api(f['stream'],operator,health,unused,lambda:False,checkout_submission=apply)
 try:
  data=dict(url='http://127.0.0.1:'+str(server.server_port),operator=operator,fixture=f,deadline=deadline)
  result=subprocess.run(['node',str(ROOT/'staging-events/cloudflare-access/staff-hosted-http.bundle.mjs')],input=json.dumps(data),capture_output=True,text=True,timeout=75,env={'PATH':os.environ.get('PATH','/usr/local/bin:/usr/bin:/bin')})
  if result.returncode!=0 or len(result.stdout)>2000:raise EventCaptureError('STAFF_NODE_HTTP_FAILED')
  outcome=json.loads(result.stdout)
  if outcome!=dict(status='PASSED',httpRequests=3,lostSuccessRetried=True,invalidIdentityBlocked=True) or not lost[0]:raise EventCaptureError('STAFF_HTTP_UNPROVEN')
  p=trial.state(f)
  if p['eventCount']!=4 or p['auditRows']!=2:raise EventCaptureError('STAFF_HTTP_COUNTS_FAILED')
  return outcome
 finally:server.shutdown();server.server_close();thread.join(timeout=2)
def main(env=None):
 env=os.environ if env is None else env;config=configuration(env)
 if config is None:emit(status='DISABLED',sourceRequests=0);return
 deadline,rp,wp=config
 if any(p.is_symlink() for p in (DIRECTORY,*DIRECTORY.parents)):raise EventCaptureError('STAFF_TRIAL_PATH_REFUSED')
 DIRECTORY.mkdir(parents=True,exist_ok=True,mode=0o700);budget=Budget(DIRECTORY/'attempts.sqlite3',deadline);budget.take('started')
 import psycopg
 with psycopg.connect(**rp,autocommit=True) as reader:
  role_check(reader,'reader');trial=Trial(reader,wp,budget)
  for f in CASES:
   p=trial.state(f)
   if p['eventCount']!=2 or p['auditRows']!=0:raise EventCaptureError('STAFF_TRIAL_FIXTURE_REQUIRED')
  for f in CASES[:3]:trial.concurrent(f,f['name'])
  trial.timeout(CASES[3]);trial.audit_failure(CASES[4]);http=http_trial(trial,CASES[5],deadline)
  packets={f['name']:trial.state(f) for f in CASES}
 result=dict(status='OBSERVED',scope='SYNTHETIC_STAFF_COMMANDS',evidence=trial.evidence,http=http,attempts=budget.summary(),productionWrites=0,notifications=0,cloudflareBoundary='LOCAL_SYNTHETIC_SIGNATURES',verified=False)
 for name,body in [('result.json',result),('packets.json',packets)]:
  path=DIRECTORY/name;path.write_text(canonical(body));path.chmod(0o600)
 emit(**result)
if __name__=='__main__':
 try:main()
 except Exception as error:
  emit(status='UNVERIFIED',reasonCode=str(error) if isinstance(error,EventCaptureError) else 'STAFF_COMMAND_TRIAL_FAILED',sqlstate=getattr(error,'sqlstate',None));raise SystemExit(1)
