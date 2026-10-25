"""Bounded private staging checkout concurrency and Node-to-HTTP rehearsal."""
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import time
from datetime import datetime
from uuid import uuid5,NAMESPACE_DNS
from concurrent.futures import ThreadPoolExecutor
from event_capture_journal import EventCaptureJournal,EventCaptureError,canonical,snapshot,restore_snapshot
from event_checkout_transport import CheckoutTransport,SQL,QUERY,check_role,submit
from event_cutover_trial import Budget as BaseBudget,FLAGS,role_check,wait_until
from event_runtime_transport import connection_parameters,DatabaseTransport
from event_runtime_http import serve_api
from event_postgres_export import poll,source_identity

DAY='2026-10-26'
DIRECTORY=Path('/data/checkout-submission-trial-26-oct-v1')
def identity(name):return str(uuid5(NAMESPACE_DNS,'master-wok-checkout-26-oct-v1-'+name))
def fixture(name,delivery=False):
 return dict(name=name,route=identity(name+'-route'),stream=identity(name+'-stream'),order=identity(name+'-order'),quote=identity(name+'-quote'),request='checkout-'+name,
  checkout=dict(order_alias='synthetic-checkout-'+name,customer_alias='synthetic-customer',order_type='delivery' if delivery else 'collection',preferred_time=DAY+'T18:30:00Z',payment_preference='cash',communication_preference='sms',subtotal_pence=1500,discount_pence=0,delivery_fee_pence=300 if delivery else 0,total_pence=1800 if delivery else 1500,
   lines=[dict(item_id='green-curry',qty=1,unit_price_pence=1200,spice=2,modifiers=[dict(id='chicken',delta_pence=0)]),dict(item_id='sticky-rice',qty=1,unit_price_pence=300,spice=None,modifiers=[])]))
CASES=tuple(fixture(name) for name in ('same-request','same-quote','rollback','timeout','http'))
DELIVERY=fixture('http-delivery',True);DELIVERY.update(route=CASES[-1]['route'],stream=CASES[-1]['stream'])
EXTRA_FLAGS=('MASTER_WOK_CUTOVER_TRIAL_ENABLED','MASTER_WOK_CUTOVER_RESPONSE_HTTP_ENABLED','MASTER_WOK_COMMAND_ROUTE_TRIAL_ENABLED','MASTER_WOK_BACKEND_KEY_TRIAL_ENABLED','MASTER_WOK_KEY_COMPATIBILITY_ENABLED')
STATE='SELECT enabled,event_count,master_wok_event_test.export(id) FROM master_wok_event_test.streams WHERE id=%s::uuid'
class Budget(BaseBudget):LIMITS={'started':1,'probe':40,'write':20,'read':16}
def emit(**data):print(canonical(dict(data,verified=False)),flush=True)
def configuration(env,now=None):
 if env.get('MASTER_WOK_CHECKOUT_TRIAL_ENABLED')!='true':return None
 now=time.time() if now is None else now
 expected={'RAILWAY_PROJECT_ID':'7821ad5b-f5c2-4ab4-9206-c3d76eefd4c8','RAILWAY_ENVIRONMENT_ID':'c1b8fad6-dbfc-4188-b4b5-a5dbfbf53279','RAILWAY_SERVICE_ID':'012e5ef6-6225-4ab3-95f5-894583db7e83','MASTER_WOK_EVENT_RUNTIME_SCOPE':'SYNTHETIC_STAGING_EVENTS'}
 if any(env.get(k)!=v for k,v in expected.items()) or any(env.get(k)!='false' for k in (*FLAGS,*EXTRA_FLAGS)):raise EventCaptureError('CHECKOUT_TRIAL_SCOPE_REFUSED')
 try:deadline=float(env.get('MASTER_WOK_CHECKOUT_TRIAL_END_EPOCH','0'))
 except (ValueError,TypeError):raise EventCaptureError('CHECKOUT_TRIAL_DEADLINE_REFUSED') from None
 if not now<deadline<=now+600 or deadline>=datetime.fromisoformat(DAY+'T18:00:00Z').timestamp():raise EventCaptureError('CHECKOUT_TRIAL_DEADLINE_REFUSED')
 return deadline,connection_parameters(env.get('MASTER_WOK_EVENT_READER_DSN'),'reader'),connection_parameters(env.get('MASTER_WOK_EVENT_WRITER_DSN'),'writer')
def args(f,request=None,order=None):return [f['route'],request or f['request'],order or f['order'],f['quote'],json.dumps(f['checkout'],allow_nan=False)]

class Trial:
 def __init__(self,reader,writer_parameters,budget):self.reader=reader;self.parameters=writer_parameters;self.budget=budget;self.evidence=[]
 def state(self,f):
  self.budget.take('read');row=self.reader.execute(STATE,[f['stream']]).fetchone()
  if row is None or row[0] is not True:raise EventCaptureError('CHECKOUT_TRIAL_FIXTURE_REQUIRED')
  return dict(eventCount=row[1],batch=row[2])
 def preflight(self):
  for f in CASES:
   p=self.state(f)
   if p!={'eventCount':0,'batch':None}:raise EventCaptureError('CHECKOUT_TRIAL_FIXTURE_REQUIRED')
 def writer(self,short=False):
  import psycopg
  p=dict(self.parameters,options='-c statement_timeout=20000 -c lock_timeout='+('300' if short else '15000')+' -c idle_in_transaction_session_timeout=30000')
  conn=psycopg.connect(**p)
  try:check_role(conn);return conn
  except Exception:conn.close();raise
 def write(self,conn,f,request=None,order=None):
  self.budget.take('write');return conn.execute(SQL,args(f,request,order)).fetchone()[0]
 def blocked(self,pid,holder):
  self.budget.take('probe');return holder in self.reader.execute('SELECT pg_blocking_pids(%s::integer)',[pid]).fetchone()[0]
 def concurrent(self,f,mode):
  with self.writer() as holder,self.writer() as waiter:
   if self.write(holder,f)!='RECORDED':raise EventCaptureError('CHECKOUT_TRIAL_HOLDER_FAILED')
   hp=holder.execute('SELECT pg_backend_pid()').fetchone()[0];wp=waiter.execute('SELECT pg_backend_pid()').fetchone()[0]
   request=f['request'] if mode=='same-request' else f['request']+'-second'
   order=identity('alternate-quote-order') if mode=='same-quote' else f['order']
   with ThreadPoolExecutor(max_workers=1) as pool:
    future=pool.submit(self.write,waiter,f,request,order)
    wait_until(lambda:self.blocked(wp,hp),self.budget,seconds=10)
    if self.state(f)!={'eventCount':0,'batch':None}:raise EventCaptureError('CHECKOUT_TRIAL_UNCOMMITTED_VISIBLE')
    if mode=='rollback':holder.rollback()
    else:holder.commit()
    if mode=='same-quote':
     try:future.result(timeout=20)
     except Exception as error:
      if getattr(error,'sqlstate',None)!='P0001' or getattr(getattr(error,'diag',None),'message_primary',None)!='CHECKOUT_QUOTE_USED':raise EventCaptureError('CHECKOUT_TRIAL_QUOTE_REUSE_UNPROVEN') from None
      waiter.rollback();outcome='CHECKOUT_QUOTE_USED'
     else:raise EventCaptureError('CHECKOUT_TRIAL_QUOTE_REUSED')
    else:
     outcome=future.result(timeout=20)
     if outcome!=('ALREADY_RECORDED' if mode=='same-request' else 'RECORDED'):raise EventCaptureError('CHECKOUT_TRIAL_WAITER_FAILED')
     waiter.commit()
  p=self.state(f)
  if p['eventCount']!=1 or len(p['batch']['events'][0]['order']['lines'])!=2:raise EventCaptureError('CHECKOUT_TRIAL_PARTIAL_BASKET')
  self.evidence.append(dict(case=mode,waiterBlocked=True,uncommittedExportInvisible=True,result=outcome,eventCount=1,writerPid=hp,waiterPid=wp));emit(status='WITNESSED',case=mode,result=outcome)
  return p
 def timeout(self,f):
  with self.writer() as holder:
   holder.execute('SELECT id FROM master_wok_event_test.streams WHERE id=%s::uuid FOR UPDATE',[f['stream']])
   with self.writer(short=True) as waiter:
    try:self.write(waiter,f)
    except Exception as error:
     if getattr(error,'sqlstate',None)!='55P03':raise EventCaptureError('CHECKOUT_TRIAL_TIMEOUT_UNPROVEN') from None
     waiter.rollback()
    else:raise EventCaptureError('CHECKOUT_TRIAL_TIMEOUT_MISSING')
   holder.rollback()
  with self.writer() as retry:
   if self.write(retry,f)!='RECORDED' or self.write(retry,f)!='ALREADY_RECORDED':raise EventCaptureError('CHECKOUT_TRIAL_TIMEOUT_RETRY_FAILED')
  p=self.state(f)
  if p['eventCount']!=1:raise EventCaptureError('CHECKOUT_TRIAL_TIMEOUT_PARTIAL_WRITE')
  self.evidence.append(dict(case='timeout',sqlstate='55P03',retry='RECORDED_THEN_ALREADY_RECORDED',eventCount=1));return p

def http_trial(env,budget,deadline):
 f=CASES[-1];lost=[False];operator=os.urandom(32).hex();health=os.urandom(32).hex()
 transport=CheckoutTransport(env.get('MASTER_WOK_EVENT_WRITER_DSN'),enabled=True)
 def bounded(payload):budget.take('write');return transport(payload)
 def callback(body):
  result=submit(body,f['route'],enabled=True,transport=bounded)
  if body['requestId']==f['request'] and result['status']=='RECORDED' and not lost[0]:
   lost[0]=True;raise EventCaptureError('INJECTED_AFTER_COMMIT_BEFORE_HTTP_SUCCESS')
  return result
 def unused(_):raise EventCaptureError('UNUSED_STAGING_ROUTE')
 server,thread=serve_api(f['stream'],operator,health,unused,lambda:False,checkout_submission=callback)
 try:
  script=Path(__file__).resolve().parent.parent/'staging-events/checkout-submission-http-exercise.cjs'
  data=dict(url='http://127.0.0.1:'+str(server.server_port),operator=operator,deadline=deadline,fixtures=[f,DELIVERY])
  result=subprocess.run(['node',str(script)],input=json.dumps(data),text=True,capture_output=True,timeout=75)
  if result.returncode!=0 or len(result.stdout)>2000:raise EventCaptureError('CHECKOUT_TRIAL_NODE_HTTP_FAILED')
  outcome=json.loads(result.stdout)
  if outcome!={'status':'PASSED','httpCalls':7,'lostSuccessResponseRetried':True} or not lost[0]:raise EventCaptureError('CHECKOUT_TRIAL_HTTP_WITNESS_FAILED')
  return outcome
 finally:server.shutdown();server.server_close();thread.join(timeout=2)

def replay(env,budget):
 f=CASES[-1];identity_=source_identity(f['stream']);journal=EventCaptureJournal(DIRECTORY/'event-capture.sqlite3',identity_,enabled=True)
 reader=DatabaseTransport(env.get('MASTER_WOK_EVENT_READER_DSN'),'reader')
 def bounded(p):budget.take('read');return reader(p)
 try:
  poll(journal,f['stream'],enabled=True,transport=bounded);result=journal.run_once(enabled=True)
  if result.get('status')!='RECORDED' or result.get('observations')!=0:raise EventCaptureError('CHECKOUT_TRIAL_REPLAY_FAILED')
  receipt=snapshot(journal,DIRECTORY/'snapshot.sqlite3');restored=DIRECTORY/'restored';restored.mkdir(mode=0o700)
  restore_snapshot(DIRECTORY/'snapshot.sqlite3',restored/'event-capture.sqlite3',identity_,receipt['sha256'])
 finally:journal.close()
 journal=EventCaptureJournal(restored/'event-capture.sqlite3',identity_,enabled=True)
 try:
  if journal.run_once(enabled=True)['status']!='IDLE':raise EventCaptureError('CHECKOUT_TRIAL_RECOVERY_FAILED')
 finally:journal.close()
 return dict(events=2,actualDecisions=0,recoveryVerified=True)

def main(env=None):
 env=os.environ if env is None else env;config=configuration(env)
 if config is None:emit(status='DISABLED',sourceRequests=0);return
 deadline,rp,wp=config
 if any(p.is_symlink() for p in (DIRECTORY,*DIRECTORY.parents)):raise EventCaptureError('CHECKOUT_TRIAL_PATH_REFUSED')
 DIRECTORY.mkdir(parents=True,exist_ok=True,mode=0o700);budget=Budget(DIRECTORY/'attempts.sqlite3',deadline);budget.take('started')
 import psycopg
 with psycopg.connect(**rp,autocommit=True) as reader:
  role_check(reader,'reader');trial=Trial(reader,wp,budget);trial.preflight()
  packets={f['name']:trial.concurrent(f,f['name']) for f in CASES[:3]};packets['timeout']=trial.timeout(CASES[3])
  http=http_trial(env,budget,deadline);packets['http']=trial.state(CASES[-1])
  if packets['http']['eventCount']!=2:raise EventCaptureError('CHECKOUT_TRIAL_HTTP_DUPLICATED')
  replayed=replay(env,budget)
 outcome=dict(status='OBSERVED',scope='SYNTHETIC_STAGING_CHECKOUT',evidence=trial.evidence,http=http,replay=replayed,attempts=budget.summary(),notifications=0,productionWrites=0,verified=False)
 for name,value in [('packets.json',packets),('result.json',outcome)]:
  p=DIRECTORY/name;p.write_text(canonical(value));p.chmod(0o600)
 emit(**{k:v for k,v in outcome.items() if k!='verified'})

if __name__=='__main__':
 try:main()
 except Exception as error:
  emit(status='UNVERIFIED',reasonCode=str(error) if isinstance(error,EventCaptureError) else 'CHECKOUT_TRIAL_FAILED',sqlstate=getattr(error,'sqlstate',None));raise SystemExit(1)
