"""Fixed-query, default-off restricted synthetic staging transport."""
import re
from event_capture_journal import EventCaptureError
from event_cutover_response_staging import QUERY
from event_postgres_export import source_identity
from event_runtime_transport import connection_parameters,ROLES

SQL='SELECT master_wok_event_test.apply_cutover_response(%s::uuid,%s::uuid,%s::text,%s::text,%s::text,%s::text,%s::text)'

class CutoverResponseTransport:
 def __init__(self,dsn=None,*,enabled=False,connect=None):
  self.enabled=enabled is True
  if self.enabled:self.parameters=connection_parameters(dsn,'writer');self.connect=connect
 def __call__(self,payload):
  if not self.enabled:return dict(status='DISABLED',sourceRequests=0,verified=False)
  if not isinstance(payload,dict) or set(payload)!={'query','parameters'} or payload['query']!=QUERY:raise EventCaptureError('FIXED_CUTOVER_RESPONSE_QUERY_REQUIRED')
  p=payload['parameters']
  if not isinstance(p,list) or len(p)!=7:raise EventCaptureError('CUTOVER_RESPONSE_PARAMETERS_REQUIRED')
  source_identity(p[0]);source_identity(p[1])
  if (p[0]==p[1] or any(not isinstance(p[i],str) or not re.fullmatch('[a-zA-Z0-9_-]{1,100}',p[i]) for i in (2,3,6)) or
      not isinstance(p[4],str) or not re.fullmatch('synthetic-[a-z0-9_-]{1,80}',p[4]) or p[5] not in ('accept','reject')):raise EventCaptureError('CUTOVER_RESPONSE_PARAMETERS_REQUIRED')
  try:
   connect=self.connect
   if connect is None:
    import psycopg
    connect=psycopg.connect
   with connect(**self.parameters) as conn:
    with conn.cursor() as cur:
     cur.execute('SELECT current_user,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')
     if cur.fetchone()!=(ROLES['writer'],False,False):raise EventCaptureError('DATABASE_ROLE_UNPROVEN')
     cur.execute("SELECT has_table_privilege(current_user,'master_wok_event_test.cutover_response_routes','INSERT,UPDATE,DELETE'),has_function_privilege(current_user,'master_wok_event_test.authorize_cutover_response_route(uuid,uuid,text)','EXECUTE'),has_column_privilege(current_user,'master_wok_event_test.streams','enabled','UPDATE')")
     if cur.fetchone()!=(False,False,False):raise EventCaptureError('CUTOVER_ATTESTATION_PRIVILEGES_REFUSED')
     cur.execute(SQL,p);rows=cur.fetchall()
     if len(rows)!=1 or rows[0][0] not in ('RECORDED','ALREADY_RECORDED'):raise EventCaptureError('CUTOVER_RESPONSE_RESULT_REQUIRED')
     return [dict(result=rows[0][0])]
  except EventCaptureError:raise
  except Exception:raise EventCaptureError('STAGING_CUTOVER_RESPONSE_FAILED') from None
