"""One-start, bounded FULL private checkout rehearsal. Staging only, default off."""
import json
import os
from pathlib import Path
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from uuid import UUID
from event_capture_journal import EventCaptureError,EventCaptureJournal,canonical,snapshot,restore_snapshot
from event_checkout_trial import Trial as BaseTrial,FLAGS,EXTRA_FLAGS,role_check,wait_until
from event_cutover_trial import Budget as BaseBudget
from event_runtime_transport import connection_parameters,ROLES
from event_runtime_http import serve_api
from event_postgres_export import source_identity,poll

ROOT=Path(__file__).resolve().parent.parent
FIXTURES=json.loads((ROOT/'fixtures/checkout-full-trial-28-oct-v1.json').read_text())
CASES=FIXTURES[:5];DELIVERY=FIXTURES[5]
DIRECTORY=Path('/data/full-checkout-trial-28-oct-v1')
QUERY='SELECT master_wok_event_test.submit_full_checkout($1::uuid,$2::text,$3::uuid,$4::uuid,$5::jsonb) AS result'
SQL='SELECT master_wok_event_test.submit_full_checkout(%s::uuid,%s::text,%s::uuid,%s::uuid,%s::jsonb)'
PRIVILEGES="SELECT has_table_privilege(current_user,'master_wok_event_test.full_checkout_quotes','INSERT,UPDATE,DELETE'),has_table_privilege(current_user,'master_wok_event_test.full_checkout_submissions','UPDATE,DELETE'),has_table_privilege(current_user,'master_wok_event_test.full_checkout_orders','SELECT,UPDATE,DELETE'),has_table_privilege(current_user,'master_wok_event_test.full_checkout_items','SELECT,UPDATE,DELETE'),has_table_privilege(current_user,'master_wok_event_test.command_routes','INSERT,UPDATE,DELETE'),has_function_privilege(current_user,'master_wok_event_test.switch_command_route(uuid,integer,uuid,text)','EXECUTE')"
def emit(**data):print(canonical(dict(data,verified=False)),flush=True)
class Budget(BaseBudget):LIMITS={'started':1,'probe':40,'write':20,'read':16}
def configuration(env,now=None):
 if env.get('MASTER_WOK_FULL_CHECKOUT_TRIAL_ENABLED')!='true':return None
 now=time.time() if now is None else now
 expected={'RAILWAY_PROJECT_ID':'7821ad5b-f5c2-4ab4-9206-c3d76eefd4c8','RAILWAY_ENVIRONMENT_ID':'c1b8fad6-dbfc-4188-b4b5-a5dbfbf53279','RAILWAY_SERVICE_ID':'012e5ef6-6225-4ab3-95f5-894583db7e83','MASTER_WOK_EVENT_RUNTIME_SCOPE':'SYNTHETIC_STAGING_EVENTS'}
 if any(env.get(k)!=v for k,v in expected.items()) or any(env.get(k)!='false' for k in (*FLAGS,*EXTRA_FLAGS,'MASTER_WOK_CHECKOUT_TRIAL_ENABLED')):raise EventCaptureError('FULL_CHECKOUT_SCOPE_REFUSED')
 try:deadline=float(env.get('MASTER_WOK_FULL_CHECKOUT_TRIAL_END_EPOCH','0'))
 except (ValueError,TypeError):raise EventCaptureError('FULL_CHECKOUT_DEADLINE_REFUSED') from None
 if not now<deadline<=now+600 or deadline>=datetime.fromisoformat('2026-10-28T18:00:00Z').timestamp():raise EventCaptureError('FULL_CHECKOUT_DEADLINE_REFUSED')
 return deadline,connection_parameters(env.get('MASTER_WOK_EVENT_READER_DSN'),'reader'),connection_parameters(env.get('MASTER_WOK_EVENT_WRITER_DSN'),'writer')
def check_role(conn):
 if conn.execute('SELECT current_user,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user').fetchone()!=(ROLES['writer'],False,False):raise EventCaptureError('DATABASE_ROLE_UNPROVEN')
 if conn.execute(PRIVILEGES).fetchone()!=(False,)*6:raise EventCaptureError('FULL_CHECKOUT_CONTROL_PRIVILEGES_REFUSED')
def parameters(p):
 if not isinstance(p,dict) or set(p)!={'query','parameters'} or p['query']!=QUERY:raise EventCaptureError('FIXED_FULL_CHECKOUT_QUERY_REQUIRED')
 values=p['parameters']
 if not isinstance(values,list) or len(values)!=5 or not isinstance(values[4],dict):raise EventCaptureError('FULL_CHECKOUT_PARAMETERS_REQUIRED')
 try:
  for x in values[:4]:UUID(x)
  body=json.dumps(values[4],allow_nan=False)
 except Exception:raise EventCaptureError('FULL_CHECKOUT_PARAMETERS_REQUIRED') from None
 # The existing loopback trial HTTP route has a 100512-byte body limit.
 if len(body.encode())>100000:raise EventCaptureError('FULL_CHECKOUT_PARAMETERS_REQUIRED')
 return values[:4]+[body]
class Trial(BaseTrial):
 def preflight(self):
  for f in CASES:
   if self.state(f)!={'eventCount':0,'batch':None}:raise EventCaptureError('FULL_CHECKOUT_FIXTURE_REQUIRED')
 def writer(self,short=False):
  import psycopg
  p=dict(self.parameters,options='-c statement_timeout=20000 -c lock_timeout='+('300' if short else '15000')+' -c idle_in_transaction_session_timeout=30000')
  conn=psycopg.connect(**p)
  try:check_role(conn);return conn
  except Exception:conn.close();raise
 def write(self,conn,f,request=None,order=None):
  self.budget.take('write');args=parameters(dict(query=QUERY,parameters=[f['route'],request or f['request'],order or f['order'],f['quote'],f['payload']]))
  return conn.execute(SQL,args).fetchone()[0]
 def concurrent(self,f,mode):
  with self.writer() as holder,self.writer() as waiter:
   if self.write(holder,f)!='RECORDED':raise EventCaptureError('FULL_CHECKOUT_HOLDER_FAILED')
   hp=holder.execute('SELECT pg_backend_pid()').fetchone()[0];wp=waiter.execute('SELECT pg_backend_pid()').fetchone()[0]
   request=f['alternateRequest'] if mode=='same-quote' else f['request']
   order=f['alternateOrder'] if mode=='same-quote' else f['order']
   with ThreadPoolExecutor(max_workers=1) as pool:
    future=pool.submit(self.write,waiter,f,request,order)
    wait_until(lambda:self.blocked(wp,hp),self.budget,seconds=10)
    if self.state(f)!={'eventCount':0,'batch':None}:raise EventCaptureError('FULL_CHECKOUT_UNCOMMITTED_VISIBLE')
    if mode=='rollback':holder.rollback()
    else:holder.commit()
    if mode=='same-quote':
     try:future.result(timeout=20)
     except Exception as error:
      if getattr(error,'sqlstate',None)!='P0001' or getattr(getattr(error,'diag',None),'message_primary',None)!='FULL_CHECKOUT_QUOTE_USED':raise EventCaptureError('FULL_CHECKOUT_QUOTE_REUSE_UNPROVEN') from None
      waiter.rollback();outcome='FULL_CHECKOUT_QUOTE_USED'
     else:raise EventCaptureError('FULL_CHECKOUT_QUOTE_REUSED')
    else:
     outcome=future.result(timeout=20)
     if outcome!=('ALREADY_RECORDED' if mode=='same-request' else 'RECORDED'):raise EventCaptureError('FULL_CHECKOUT_WAITER_FAILED')
     waiter.commit()
  p=self.state(f)
  if p['eventCount']!=1 or len(p['batch']['events'][0]['order']['lines'])!=2:raise EventCaptureError('FULL_CHECKOUT_PARTIAL_BASKET')
  self.evidence.append(dict(case=mode,waiterBlocked=True,uncommittedExportInvisible=True,result=outcome,eventCount=1,writerPid=hp,waiterPid=wp));emit(status='WITNESSED',case=mode,result=outcome)
  return p

def http_trial(env,trial,deadline):
 f=CASES[-1];lost=[False];operator=os.urandom(32).hex();health=os.urandom(32).hex()
 def callback(body):
  if not isinstance(body,dict) or set(body)!={'requestId','orderId','quoteId','checkout'}:raise EventCaptureError('FULL_CHECKOUT_BODY_REQUIRED')
  args=parameters(dict(query=QUERY,parameters=[f['route'],body['requestId'],body['orderId'],body['quoteId'],body['checkout']]))
  trial.budget.take('write')
  with trial.writer() as conn:result=conn.execute(SQL,args).fetchone()[0]
  if result not in ('RECORDED','ALREADY_RECORDED'):raise EventCaptureError('FULL_CHECKOUT_RECEIPT_REQUIRED')
  if body['requestId']==f['request'] and result=='RECORDED' and not lost[0]:lost[0]=True;raise EventCaptureError('INJECTED_AFTER_COMMIT_BEFORE_HTTP_SUCCESS')
  return dict(status=result,sourceRequests=1,verified=False)
 def unused(_):raise EventCaptureError('UNUSED_STAGING_ROUTE')
 server,thread=serve_api(f['stream'],operator,health,unused,lambda:False,checkout_submission=callback)
 try:
  data=dict(url='http://127.0.0.1:'+str(server.server_port),operator=operator,deadline=deadline,fixtures=[f,DELIVERY])
  r=subprocess.run(['node',str(ROOT/'staging-events/checkout-full-http-exercise.cjs')],input=json.dumps(data),text=True,capture_output=True,timeout=75)
  if r.returncode!=0 or len(r.stdout)>2000:raise EventCaptureError('FULL_CHECKOUT_NODE_HTTP_FAILED')
  outcome=json.loads(r.stdout)
  if outcome!={'status':'PASSED','httpCalls':7,'lostSuccessResponseRetried':True} or not lost[0]:raise EventCaptureError('FULL_CHECKOUT_HTTP_UNPROVEN')
  return outcome
 finally:server.shutdown();server.server_close();thread.join(timeout=2)

def verify_packet(f,p):
 for e in p['batch']['events']:
  order=e['order'];source=DELIVERY if order['orderId']==DELIVERY['payload']['orderAlias'] else f
  expected=source['input']['items']
  if order['lines']!=[dict(itemId=i['item_id'],qty=i['qty'],mods=[dict(id=m['id']) for m in i['modifiers']]) for i in expected] or e['kind']!='RESERVATION_SET' or 'actualDecision' in e or order['deliveryReadyEstimate'] is not None:raise EventCaptureError('FULL_CHECKOUT_EVENT_MISMATCH')
  text=json.dumps(e)
  for canary in (source['customer'],source['order'],source['request'],source['quote'],'PRIVATE','unit_price','loyalty','discount','spice','notes','order_ref'):
   if canary in text:raise EventCaptureError('FULL_CHECKOUT_PRIVACY_REFUSED')
def replay_packet(packet):
 f=CASES[-1];identity_=source_identity(f['stream']);j=EventCaptureJournal(DIRECTORY/'event-capture.sqlite3',identity_,enabled=True)
 try:
  poll(j,f['stream'],enabled=True,transport=lambda _:[dict(stream_id=f['stream'],scope='SYNTHETIC_STAGING_EVENTS',event_count=packet['eventCount'],batch=packet['batch'])])
  result=j.run_once(enabled=True)
  if result.get('status')!='RECORDED' or result.get('observations')!=0:raise EventCaptureError('FULL_CHECKOUT_REPLAY_FAILED')
  receipt=snapshot(j,DIRECTORY/'snapshot.sqlite3');restored=DIRECTORY/'restored';restored.mkdir(mode=0o700)
  restore_snapshot(DIRECTORY/'snapshot.sqlite3',restored/'event-capture.sqlite3',identity_,receipt['sha256'])
 finally:j.close()
 j=EventCaptureJournal(restored/'event-capture.sqlite3',identity_,enabled=True)
 try:
  if j.run_once(enabled=True)['status']!='IDLE':raise EventCaptureError('FULL_CHECKOUT_RECOVERY_FAILED')
 finally:j.close()
 return dict(events=2,actualDecisions=0,recoveryVerified=True)
def main(env=None):
 env=os.environ if env is None else env;config=configuration(env)
 if config is None:emit(status='DISABLED',sourceRequests=0);return
 deadline,rp,wp=config
 if any(p.is_symlink() for p in (DIRECTORY,*DIRECTORY.parents)):raise EventCaptureError('FULL_CHECKOUT_PATH_REFUSED')
 DIRECTORY.mkdir(parents=True,exist_ok=True,mode=0o700);budget=Budget(DIRECTORY/'attempts.sqlite3',deadline);budget.take('started')
 import psycopg
 with psycopg.connect(**rp,autocommit=True) as reader:
  role_check(reader,'reader');trial=Trial(reader,wp,budget);trial.preflight()
  packets={f['name']:trial.concurrent(f,f['name']) for f in CASES[:3]};packets['timeout']=trial.timeout(CASES[3])
  http=http_trial(env,trial,deadline);packets['http']=trial.state(CASES[-1])
  if packets['http']['eventCount']!=2:raise EventCaptureError('FULL_CHECKOUT_HTTP_DUPLICATED')
  for f in CASES:verify_packet(f,packets[f['name']])
  replayed=replay_packet(packets['http'])
 outcome=dict(status='OBSERVED',scope='SYNTHETIC_FULL_CHECKOUT',evidence=trial.evidence,http=http,replay=replayed,attempts=budget.summary(),notifications=0,productionWrites=0,verified=False)
 for name,value in [('packets.json',packets),('result.json',outcome)]:
  p=DIRECTORY/name;p.write_text(canonical(value));p.chmod(0o600)
 emit(**{k:v for k,v in outcome.items() if k!='verified'})
if __name__=='__main__':
 try:main()
 except Exception as error:
  emit(status='UNVERIFIED',reasonCode=str(error) if isinstance(error,EventCaptureError) else 'FULL_CHECKOUT_TRIAL_FAILED',sqlstate=getattr(error,'sqlstate',None));raise SystemExit(1)
