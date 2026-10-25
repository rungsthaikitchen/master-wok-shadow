"""Default-off, fixed-query synthetic checkout transport. No production integration."""
import json
import re
from event_capture_journal import EventCaptureError
from event_postgres_export import PROJECT,source_identity
from event_runtime_transport import connection_parameters,ROLES

QUERY='SELECT master_wok_event_test.submit_checkout($1::uuid,$2::text,$3::uuid,$4::uuid,$5::jsonb) AS result'
SQL='SELECT master_wok_event_test.submit_checkout(%s::uuid,%s::text,%s::uuid,%s::uuid,%s::jsonb)'
PRIVILEGES="SELECT has_table_privilege(current_user,'master_wok_event_test.checkout_quotes','INSERT,UPDATE,DELETE'),has_table_privilege(current_user,'master_wok_event_test.checkout_submissions','UPDATE,DELETE'),has_table_privilege(current_user,'master_wok_event_test.command_routes','INSERT,UPDATE,DELETE'),has_function_privilege(current_user,'master_wok_event_test.switch_command_route(uuid,integer,uuid,text)','EXECUTE')"
def check_role(conn):
 if conn.execute('SELECT current_user,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user').fetchone()!=(ROLES['writer'],False,False):raise EventCaptureError('DATABASE_ROLE_UNPROVEN')
 if conn.execute(PRIVILEGES).fetchone()!=(False,False,False,False):raise EventCaptureError('CHECKOUT_CONTROL_PRIVILEGES_REFUSED')
def parameters(payload):
 if not isinstance(payload,dict) or set(payload)!={'query','parameters'} or payload['query']!=QUERY:raise EventCaptureError('FIXED_CHECKOUT_QUERY_REQUIRED')
 p=payload['parameters']
 if not isinstance(p,list) or len(p)!=5 or not isinstance(p[1],str) or not re.fullmatch('[a-zA-Z0-9_-]{1,100}',p[1]) or not isinstance(p[4],dict):raise EventCaptureError('CHECKOUT_PARAMETERS_REQUIRED')
 for i in (0,2,3):source_identity(p[i])
 try:body=json.dumps(p[4],allow_nan=False)
 except Exception:raise EventCaptureError('CHECKOUT_PARAMETERS_REQUIRED') from None
 if len(body.encode())>100000:raise EventCaptureError('CHECKOUT_PARAMETERS_REQUIRED')
 return p[:4]+[body]
class CheckoutTransport:
 def __init__(self,dsn=None,*,enabled=False,connect=None):
  self.enabled=enabled is True
  if self.enabled:self.parameters=connection_parameters(dsn,'writer');self.connect=connect
 def __call__(self,payload):
  if not self.enabled:return dict(status='DISABLED',sourceRequests=0,verified=False)
  p=parameters(payload)
  try:
   connect=self.connect
   if connect is None:
    import psycopg
    connect=psycopg.connect
   with connect(**self.parameters) as conn:
    check_role(conn);rows=conn.execute(SQL,p).fetchall()
    if len(rows)!=1 or rows[0][0] not in ('RECORDED','ALREADY_RECORDED'):raise EventCaptureError('CHECKOUT_COMMITTED_RECEIPT_REQUIRED')
    return [dict(result=rows[0][0])]
  except EventCaptureError:raise
  except Exception as error:
   reason={'42501':'DATABASE_PERMISSION_REFUSED','55P03':'DATABASE_LOCK_TIMEOUT','57014':'DATABASE_TIMEOUT'}.get(getattr(error,'sqlstate',None),'STAGING_CHECKOUT_REQUEST_FAILED')
   raise EventCaptureError(reason) from None
def submit(body,route,*,enabled=False,project=PROJECT,transport=None):
 if enabled is not True:return dict(status='DISABLED',sourceRequests=0,verified=False)
 if project!=PROJECT or not callable(transport):raise EventCaptureError('STAGING_CHECKOUT_BACKEND_REQUIRED')
 if not isinstance(body,dict) or set(body)!={'requestId','orderId','quoteId','checkout'}:raise EventCaptureError('CHECKOUT_BODY_REQUIRED')
 payload=dict(query=QUERY,parameters=[route,body['requestId'],body['orderId'],body['quoteId'],body['checkout']]);parameters(payload)
 rows=transport(payload)
 if not isinstance(rows,list) or len(rows)!=1 or not isinstance(rows[0],dict) or set(rows[0])!={'result'} or rows[0]['result'] not in ('RECORDED','ALREADY_RECORDED'):raise EventCaptureError('CHECKOUT_COMMITTED_RECEIPT_REQUIRED')
 return dict(status=rows[0]['result'],sourceRequests=1,verified=False)
