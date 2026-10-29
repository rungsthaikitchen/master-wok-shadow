"""Default-off, ten-minute, one-fixture Pages receiver. Never imports live backend."""
import hashlib
import hmac
import json
import os
import re
import sqlite3
import sys
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from uuid import UUID
from event_capture_journal import EventCaptureError
from event_cutover_trial import Budget as BaseBudget, role_check
from event_runtime_transport import connection_parameters

FIXTURE=json.loads((Path(__file__).resolve().parent.parent/'fixtures/preview-browser-29-oct-v3.json').read_text())
DIRECTORY=Path('/data/preview-browser-29-oct-v4')
END_LIMIT=1793291400  # 29 October 2026 16:30 UTC: never overlap fixture cooking.
APPLY='SELECT master_wok_event_test.apply_staff_command(%s::uuid,%s::uuid,%s::text,%s::uuid,%s::integer,%s::text,%s::timestamptz)'
STATE="""SELECT b.status,coalesce(b.proposed_time,b.confirmed_time,b.preferred_time),
 (SELECT max(e.sequence) FROM master_wok_event_test.events e WHERE e.stream_id=s.id AND
 (e.payload->>'orderId'=b.order_alias OR e.payload->'order'->>'orderId'=b.order_alias))
 FROM master_wok_event_test.command_routes r
 JOIN master_wok_event_test.streams s ON s.id=r.current_stream
 JOIN master_wok_event_test.booking_rows b ON b.stream_id=s.id
 WHERE r.id=%s::uuid AND r.generation=0 AND s.id=%s::uuid AND b.id=%s::uuid
 AND s.scope='SYNTHETIC_STAGING_EVENTS' AND s.enabled AND s.service_date=%s::date"""

def refuse(code='PREVIEW_FIXTURE_REFUSED'):
 raise EventCaptureError(code)

def connection_configuration(env):
 expected={'RAILWAY_PROJECT_ID':'7821ad5b-f5c2-4ab4-9206-c3d76eefd4c8','RAILWAY_ENVIRONMENT_ID':'c1b8fad6-dbfc-4188-b4b5-a5dbfbf53279','RAILWAY_SERVICE_ID':'012e5ef6-6225-4ab3-95f5-894583db7e83','MASTER_WOK_EVENT_RUNTIME_SCOPE':'SYNTHETIC_STAGING_EVENTS'}
 if any(env.get(k)!=v for k,v in expected.items()):refuse('PREVIEW_SCOPE_REFUSED')
 if any(k.startswith('MASTER_WOK_') and k.endswith('_ENABLED') and k!='MASTER_WOK_PREVIEW_BROWSER_ENABLED' and v!='false' for k,v in env.items()):refuse('PREVIEW_OTHER_FLAG_REFUSED')
 key=env.get('MASTER_WOK_PREVIEW_HOP_KEY','')
 if re.fullmatch('[a-f0-9]{64}',key) is None:refuse('PREVIEW_SERVER_KEY_REQUIRED')
 return dict(key=bytes.fromhex(key),reader=connection_parameters(env.get('MASTER_WOK_EVENT_READER_DSN'),'reader'),writer=connection_parameters(env.get('MASTER_WOK_EVENT_WRITER_DSN'),'writer'))

def configuration(env,now=None):
 if env.get('MASTER_WOK_PREVIEW_BROWSER_ENABLED')!='true':return None
 now=time.time() if now is None else now
 try:deadline=int(env.get('MASTER_WOK_PREVIEW_BROWSER_END_EPOCH','0'))
 except (TypeError,ValueError):refuse('PREVIEW_DEADLINE_REFUSED')
 if not now<deadline<=now+600 or deadline>=END_LIMIT:refuse('PREVIEW_DEADLINE_REFUSED')
 return dict(connection_configuration(env),deadline=deadline)

class Budget(BaseBudget):
 LIMITS={'started':1,'request':160,'state':60,'command':20,'preflight':1}

def unique(pairs):
 result={}
 for k,v in pairs:
  if k in result:refuse()
  result[k]=v
 return result

def decode(data):
 try:return json.loads(data,object_pairs_hook=unique,parse_constant=lambda _:refuse())
 except (ValueError,TypeError,UnicodeError):refuse()

def validate_envelope(signed,key,now):
 if not isinstance(signed,dict) or set(signed)!={'body','tag'} or not isinstance(signed['body'],str) or len(signed['body'].encode())>8192 or not isinstance(signed['tag'],str) or re.fullmatch('[a-f0-9]{64}',signed['tag']) is None:refuse()
 if not hmac.compare_digest(hmac.new(key,signed['body'].encode(),hashlib.sha256).hexdigest(),signed['tag']):refuse()
 e=decode(signed['body'])
 if not isinstance(e,dict) or set(e)!={'actorId','input','issuedAt','operation','version'} or type(e['version']) is not int or e['version']!=1 or not isinstance(e['actorId'],str) or re.fullmatch('[a-f0-9]{64}',e['actorId']) is None or type(e['issuedAt']) is not int or not 0<=now-e['issuedAt']<30:refuse()
 c=e['input']
 if e['operation']=='state':
  if not isinstance(c,dict) or set(c)!={'orderId'} or c['orderId']!=FIXTURE['orderId']:refuse()
 elif e['operation']=='command':
  if not isinstance(c,dict) or set(c)!={'version','commandId','orderId','expectedRevision','action',*(['target'] if c.get('action')=='offer' else [])} or type(c.get('version')) is not int or c['version']!=1 or c.get('orderId')!=FIXTURE['orderId'] or type(c.get('expectedRevision')) is not int or not 1<=c['expectedRevision']<=1000 or c.get('action') not in ('offer','confirm','cancel','complete'):refuse()
  try:
   if str(UUID(c['commandId']))!=c['commandId']:refuse()
  except (ValueError,TypeError,AttributeError):refuse()
  if c['action']=='offer' and c['target'] not in FIXTURE['targets']:refuse()
 else:refuse()
 return e

class Receiver:
 def __init__(self,config,budget,*,connect=None,clock=time.time):
  self.config=config;self.budget=budget;self.connect=connect;self.clock=clock
 def active(self):
  now=self.clock()
  if not now<self.config['deadline']:refuse('PREVIEW_TRIAL_EXPIRED')
  return now
 def connection(self,kind):
  connect=self.connect
  if connect is None:
   import psycopg
   connect=psycopg.connect
  return connect(**self.config[kind])
 def preflight(self):
  self.active();self.budget.take('preflight')
  with self.connection('reader') as conn:
   conn.execute('SET TRANSACTION READ ONLY');role_check(conn,'reader')
   row=conn.execute("SELECT s.event_count,(SELECT count(*) FROM master_wok_event_test.staff_commands a WHERE a.route_id=r.id) FROM master_wok_event_test.command_routes r JOIN master_wok_event_test.streams s ON s.id=r.current_stream WHERE r.id=%s::uuid AND r.generation=0 AND s.id=%s::uuid AND s.enabled AND s.scope='SYNTHETIC_STAGING_EVENTS' AND s.service_date=%s::date",[FIXTURE['routeId'],FIXTURE['streamId'],FIXTURE['serviceDate']]).fetchone()
   if row!=(2,0):refuse('PREVIEW_FRESH_FIXTURE_REQUIRED')
 def __call__(self,signed):
  e=validate_envelope(signed,self.config['key'],self.active());kind=e['operation'];self.budget.take(kind);self.active()
  if kind=='state':
   with self.connection('reader') as conn:
    conn.execute('SET TRANSACTION READ ONLY');role_check(conn,'reader')
    row=conn.execute(STATE,[FIXTURE['routeId'],FIXTURE['streamId'],FIXTURE['orderId'],FIXTURE['serviceDate']]).fetchone()
   if row is None or type(row[2]) is not int or row[2]<1:refuse()
   target=row[1].isoformat().replace('+00:00','Z')
   if row[0] not in ('pending','proposed','confirmed','customer_accepted_time','customer_declined_time','cancelled','completed') or target not in FIXTURE['targets']:refuse()
   result=dict(orderId=FIXTURE['orderId'],revision=row[2],status=row[0],target=target,proposalTargets=FIXTURE['targets'])
  else:
   c=e['input']
   with self.connection('writer') as conn:
    role_check(conn,'writer');result=conn.execute(APPLY,[FIXTURE['routeId'],c['commandId'],e['actorId'],FIXTURE['orderId'],c['expectedRevision'],c['action'],c.get('target')]).fetchone()[0]
    if not isinstance(result,dict) or set(result)!={'status','revision'} or result['status'] not in ('RECORDED','ALREADY_RECORDED') or type(result['revision']) is not int or result['revision']<1:refuse()
  self.active();return result

def serve(receiver,budget,*,host='0.0.0.0',port=8080):
 class Handler(BaseHTTPRequestHandler):
  def log_message(self,*_):pass
  def send(self,status,body):
   data=json.dumps(body).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
  def do_GET(self):self.send(404,dict(error='NOT_FOUND'))
  def do_POST(self):
   if self.path!='/staging/preview-fixture-v1':return self.send(404,dict(error='NOT_FOUND'))
   try:
    receiver.active();budget.take('request');self.connection.settimeout(5)
    if self.headers.get('Transfer-Encoding') or self.headers.get('Content-Type','').split(';')[0].strip().lower()!='application/json' or len(self.headers.get_all('Content-Length',[]))!=1:refuse()
    size=int(self.headers.get('Content-Length','0'))
    if not 1<=size<=12000:refuse()
    data=self.rfile.read(size)
    if len(data)!=size:refuse()
    result=receiver(decode(data));return self.send(200,result)
   except Exception as error:
    code=getattr(getattr(error,'diag',None),'message_primary',None)
    if code in ('STAFF_REVISION_CONFLICT','STAFF_COMMAND_ID_REUSED','STALE_PROPOSAL_RESPONSE','TERMINAL_ORDER'):return self.send(409,dict(error=code))
    return self.send(503,dict(error='PREVIEW_REQUEST_REFUSED'))
 class Server(HTTPServer):
  def get_request(self):
   sock,address=super().get_request();sock.settimeout(5);return sock,address
 return Server((host,port),Handler)

def main(env=None):
 env=os.environ if env is None else env;config=configuration(env)
 if config is None:print(json.dumps(dict(status='DISABLED',sourceRequests=0)),flush=True);return
 if any(p.is_symlink() for p in (DIRECTORY,*DIRECTORY.parents)):refuse('PREVIEW_PATH_REFUSED')
 DIRECTORY.mkdir(parents=True,exist_ok=True,mode=0o700);budget=Budget(DIRECTORY/'budget.sqlite3',config['deadline']);budget.take('started')
 receiver=Receiver(config,budget);receiver.preflight();server=serve(receiver,budget,port=int(env.get('PORT','8080')));server.timeout=1
 print(json.dumps(dict(status='READY',scope='ONE_SYNTHETIC_STAGING_FIXTURE',productionWrites=0,notifications=0)),flush=True)
 try:
  while time.time()<config['deadline']:server.handle_request()
 finally:server.server_close()
 print(json.dumps(dict(status='EXPIRED',attempts=budget.summary(),productionWrites=0,notifications=0)),flush=True)

def safe_reason(error):
 allowed={'PREVIEW_SCOPE_REFUSED','PREVIEW_OTHER_FLAG_REFUSED','PREVIEW_DEADLINE_REFUSED','PREVIEW_SERVER_KEY_REQUIRED','STAGING_DATABASE_CONNECTION_REQUIRED','DATABASE_ROLE_UNPROVEN','CUTOVER_TRIAL_PRIVILEGES_REFUSED','PREVIEW_PATH_REFUSED','PREVIEW_FRESH_FIXTURE_REQUIRED','CUTOVER_TRIAL_BUDGET_REFUSED','CUTOVER_TRIAL_BUDGET_EXHAUSTED','PREVIEW_TRIAL_EXPIRED','PREVIEW_DIAGNOSTIC_DISABLED_REQUIRED'}
 if isinstance(error,EventCaptureError) and str(error) in allowed:return str(error)
 code=getattr(error,'sqlstate',None)
 if code in ('28P01','42501','42P01','55P03','57014'):return 'DATABASE_'+code
 if isinstance(error,PermissionError):return 'LOCAL_ACCESS_REFUSED'
 return 'PREVIEW_RECEIVER_FAILED'

def diagnose(env=None,*,connect=None,clock=time.time,directory=DIRECTORY):
 """Private one-off diagnostic: no HTTP, writes, budget consumption or resets."""
 env=os.environ if env is None else env
 if env.get('MASTER_WOK_PREVIEW_BROWSER_ENABLED')!='false':refuse('PREVIEW_DIAGNOSTIC_DISABLED_REQUIRED')
 # Diagnostics remain read-only after expiry. Validate scope/roles/connections,
 # without inventing a new active deadline or weakening configuration()/main().
 config=connection_configuration(env)
 path=directory/'budget.sqlite3'
 if any(p.is_symlink() for p in (path,*path.parents)):refuse('PREVIEW_PATH_REFUSED')
 budget=None
 if path.exists():
  with sqlite3.connect(path.as_uri()+'?mode=ro',uri=True) as db:budget=dict(db.execute('SELECT kind,used FROM attempts'))
 if connect is None:
  import psycopg
  connect=psycopg.connect
 with connect(**config['reader']) as conn:
  conn.execute('SET TRANSACTION READ ONLY');role_check(conn,'reader')
  row=conn.execute('SELECT event_count,enabled FROM master_wok_event_test.streams WHERE id=%s::uuid',[FIXTURE['streamId']]).fetchone()
 if row is None:refuse('PREVIEW_FRESH_FIXTURE_REQUIRED')
 return dict(status='DIAGNOSED',scope='PRIVATE_STAGING_READ_ONLY',configurationVerified=True,roleVerified=True,fixtureEventCount=row[0],fixtureEnabled=row[1],budget=budget,productionWrites=0,notifications=0)

if __name__=='__main__':
 try:
  if sys.argv[1:]==['--diagnose']:print(json.dumps(diagnose()),flush=True)
  elif sys.argv[1:]:refuse()
  else:main()
 except Exception as error:print(json.dumps(dict(status='REFUSED',reasonCode=safe_reason(error))),flush=True);raise SystemExit(1)
