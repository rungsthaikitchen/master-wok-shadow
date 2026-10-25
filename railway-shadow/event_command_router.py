"""Default-off fixed-query automatic command routing, synthetic staging only."""
import base64
import json
import re
from event_capture_journal import EventCaptureError
from event_customer_response_staging import respond
from event_postgres_export import PROJECT,source_identity
from event_runtime_transport import connection_parameters,ROLES
from event_booking_transport import CREATE_QUERY
from event_staging_handlers import QUERY as ACTION_QUERY
from shadow_collector import timestamp

READ_QUERY='SELECT master_wok_event_test.export_command_route($1::uuid) AS packet'
APPLY_QUERY='SELECT master_wok_event_test.routed_apply_booking($1::uuid,$2::text,$3::text,$4::text,$5::timestamptz,$6::text,$7::uuid) AS result'
READ_SQL='SELECT master_wok_event_test.export_command_route(%s::uuid)'
APPLY_SQL='SELECT master_wok_event_test.routed_apply_booking(%s::uuid,%s::text,%s::text,%s::text,%s::timestamptz,%s::text,%s::uuid)'
CREATE_SQL='SELECT master_wok_event_test.routed_create_booking(%s::uuid,%s::text,%s::uuid,%s::text,%s::timestamptz,%s::jsonb)'

def identifier(value):return isinstance(value,str) and re.fullmatch('[a-zA-Z0-9_-]{1,100}',value)
def alias(value):return isinstance(value,str) and re.fullmatch('synthetic-[a-z0-9_-]{1,80}',value)

class RoutedTransport:
 def __init__(self,dsn=None,kind='reader',*,enabled=False,connect=None):
  self.enabled=enabled is True
  if self.enabled:self.parameters=connection_parameters(dsn,kind);self.kind=kind;self.connect=connect
 def __call__(self,payload):
  if not self.enabled:return dict(status='DISABLED',sourceRequests=0,verified=False)
  if not isinstance(payload,dict) or set(payload)!={'query','parameters'} or not isinstance(payload['parameters'],list):raise EventCaptureError('FIXED_ROUTER_QUERY_REQUIRED')
  q,p=payload['query'],payload['parameters'];reading=self.kind=='reader'
  if reading:
   if q!=READ_QUERY or len(p)!=1:raise EventCaptureError('FIXED_ROUTER_QUERY_REQUIRED')
   source_identity(p[0]);sql=READ_SQL
  elif q==CREATE_QUERY:
   if len(p)!=6 or not identifier(p[1]) or not alias(p[3]) or not isinstance(p[5],list) or not 1<=len(p[5])<=100:raise EventCaptureError('ROUTER_PARAMETERS_REQUIRED')
   source_identity(p[0]);source_identity(p[2]);timestamp(p[4]);sql=CREATE_SQL;p=p[:5]+[json.dumps(p[5],allow_nan=False)]
  else:
   if q==ACTION_QUERY:
    if len(p)!=3 or not isinstance(p[2],dict) or set(p[2])!={'action','orderId','targetAt','proposalEventId'}:raise EventCaptureError('ROUTER_PARAMETERS_REQUIRED')
    route,request,c=p;p=[route,request,c['orderId'],c['action'],c['targetAt'],c['proposalEventId'],None]
    if c['action']=='confirm':raise EventCaptureError('ROUTED_CONFIRM_CONTRACT_REQUIRED')
   elif q!=APPLY_QUERY:raise EventCaptureError('FIXED_ROUTER_QUERY_REQUIRED')
   if len(p)!=7 or not identifier(p[1]) or not alias(p[2]) or p[3] not in ('offer','confirm','cancel','complete','accept','reject'):raise EventCaptureError('ROUTER_PARAMETERS_REQUIRED')
   source_identity(p[0])
   if p[4] is not None:timestamp(p[4])
   if p[3] in ('accept','reject'):
    source_identity(p[6])
    if p[4] is not None or not identifier(p[5]):raise EventCaptureError('ROUTER_PARAMETERS_REQUIRED')
   elif p[6] is not None or p[5] is not None:raise EventCaptureError('ROUTER_PARAMETERS_REQUIRED')
   sql=APPLY_SQL
  try:
   connect=self.connect
   if connect is None:
    import psycopg
    connect=psycopg.connect
   with connect(**self.parameters) as conn:
    with conn.cursor() as cur:
     if reading:cur.execute('SET TRANSACTION READ ONLY')
     cur.execute('SELECT current_user,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')
     if cur.fetchone()!=(ROLES[self.kind],False,False):raise EventCaptureError('DATABASE_ROLE_UNPROVEN')
     cur.execute("SELECT has_table_privilege(current_user,'master_wok_event_test.command_routes','INSERT,UPDATE,DELETE'),has_function_privilege(current_user,'master_wok_event_test.switch_command_route(uuid,integer,uuid,text)','EXECUTE'),has_table_privilege(current_user,'master_wok_event_test.cutover_response_routes','INSERT,UPDATE,DELETE')")
     if cur.fetchone()!=(False,False,False):raise EventCaptureError('ROUTE_CONTROL_PRIVILEGES_REFUSED')
     cur.execute(sql,p);rows=cur.fetchall()
     if len(rows)!=1 or (not reading and rows[0][0] not in ('RECORDED','ALREADY_RECORDED')):raise EventCaptureError('ROUTER_RESULT_REQUIRED')
     return [dict(packet=rows[0][0])] if reading else [dict(result=rows[0][0])]
  except EventCaptureError:raise
  except Exception:raise EventCaptureError('STAGING_ROUTER_REQUEST_FAILED') from None

def routed_response(method,body,route_id,*,enabled=False,project=PROJECT,secret=None,transport=None):
 if enabled is not True:return dict(status='DISABLED',sourceRequests=0,verified=False)
 if project!=PROJECT or not callable(transport):raise EventCaptureError('STAGING_BACKEND_REQUIRED')
 source_identity(route_id)
 try:
  token=body['token']
  if not isinstance(token,str) or len(token)>1024:raise ValueError()
  part=token.split('.')[0];origin=json.loads(base64.urlsafe_b64decode(part+'='*(-len(part)%4)))['streamId']
  source_identity(origin)
 except Exception:raise EventCaptureError('RESPONSE_TOKEN_REFUSED') from None
 def relay(payload):
  stream,request,c=payload['parameters']
  if stream!=origin:raise EventCaptureError('RESPONSE_TOKEN_REFUSED')
  return transport(dict(query=APPLY_QUERY,parameters=[route_id,request,c['orderId'],c['action'],c['targetAt'],c['proposalEventId'],origin]))
 # Decoding only chooses an origin claim. Existing respond authenticates every
 # claim before relay runs; the database then resolves current/previous ownership.
 return respond(method,body,origin,enabled=True,project=project,secret=secret,transport=relay)

def routed_admin(route_id,request_id,order_alias,action,target=None,*,enabled=False,project=PROJECT,transport=None):
 if enabled is not True:return dict(status='DISABLED',sourceRequests=0,verified=False)
 if project!=PROJECT or not callable(transport):raise EventCaptureError('STAGING_BACKEND_REQUIRED')
 source_identity(route_id)
 if not identifier(request_id) or not alias(order_alias) or action not in ('offer','confirm','cancel','complete') or (action=='offer')!=(target is not None):raise EventCaptureError('ROUTED_ADMIN_COMMAND_REQUIRED')
 if target is not None:timestamp(target)
 rows=transport(dict(query=APPLY_QUERY,parameters=[route_id,request_id,order_alias,action,target,None,None]))
 if not isinstance(rows,list) or len(rows)!=1 or not isinstance(rows[0],dict) or set(rows[0])!={'result'} or rows[0]['result'] not in ('RECORDED','ALREADY_RECORDED'):raise EventCaptureError('ROUTER_RESULT_REQUIRED')
 return dict(status=rows[0]['result'],sourceRequests=1,verified=False)
