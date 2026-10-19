"""Pinned staging-only DB transports. Credentials are never logged or inferred."""
import json
import hashlib
import ssl
from pathlib import Path
from urllib.parse import urlsplit,unquote
from event_capture_journal import EventCaptureError
from event_postgres_export import PROJECT,QUERY as EXPORT_QUERY
from event_staging_handlers import QUERY as HANDLER_QUERY

ROLES={'reader':'master_wok_event_reader_login','writer':'master_wok_event_writer_login'}

def connection_parameters(dsn,kind):
 try:
  certificate=Path(__file__).with_name('supabase-root-2021.crt')
  if hashlib.sha256(ssl.PEM_cert_to_DER_cert(certificate.read_text())).hexdigest()!='807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa':raise ValueError()
  u=urlsplit(dsn)
  if (kind not in ROLES or u.scheme!='postgresql' or u.hostname!='db.'+PROJECT+'.supabase.co' or
      u.port not in (None,5432) or u.path!='/postgres' or u.query or u.fragment or
      unquote(u.username or '')!=ROLES[kind] or not u.password):raise ValueError()
  return dict(host=u.hostname,port=5432,dbname='postgres',user=ROLES[kind],password=unquote(u.password),
              sslmode='verify-full',sslrootcert=str(certificate),connect_timeout=5,
              options='-c statement_timeout=8000 -c lock_timeout=2000')
 except Exception:raise EventCaptureError('STAGING_DATABASE_CONNECTION_REQUIRED') from None

class DatabaseTransport:
 def __init__(self,dsn,kind,*,connect=None):
  self.parameters=connection_parameters(dsn,kind);self.kind=kind;self.connect=connect
 def __call__(self,payload):
  query=EXPORT_QUERY if self.kind=='reader' else HANDLER_QUERY
  if not isinstance(payload,dict) or set(payload)!={'query','parameters'} or payload['query']!=query:raise EventCaptureError('FIXED_DATABASE_QUERY_REQUIRED')
  params=payload['parameters']
  if not isinstance(params,list) or len(params)!=(1 if self.kind=='reader' else 3):raise EventCaptureError('DATABASE_PARAMETERS_REQUIRED')
  try:
   connect=self.connect
   if connect is None:
    import psycopg
    connect=psycopg.connect
   with connect(**self.parameters) as conn:
    with conn.cursor() as cur:
     if self.kind=='reader':cur.execute('SET TRANSACTION READ ONLY')
     cur.execute('SELECT current_user,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')
     if cur.fetchone()!=(ROLES[self.kind],False,False):raise EventCaptureError('DATABASE_ROLE_UNPROVEN')
     if self.kind=='reader':
      cur.execute("SELECT has_function_privilege(current_user,'master_wok_event_test.handle(uuid,text,jsonb)','EXECUTE'),has_table_privilege(current_user,'master_wok_event_test.events','INSERT')")
      if cur.fetchone()!=(False,False):raise EventCaptureError('READER_WRITE_PRIVILEGES_REFUSED')
      cur.execute('SELECT id::text,scope,event_count,master_wok_event_test.export(id) FROM master_wok_event_test.streams WHERE id=%s::uuid',params)
      return [dict(zip(('stream_id','scope','event_count','batch'),row)) for row in cur.fetchall()]
     cur.execute('SELECT master_wok_event_test.handle(%s::uuid,%s::text,%s::jsonb)',[params[0],params[1],json.dumps(params[2],allow_nan=False)])
     return [dict(result=row[0]) for row in cur.fetchall()]
  except EventCaptureError:raise
  except Exception as error:
   code=getattr(error,'sqlstate',None)
   reason={'28P01':'DATABASE_AUTH_REFUSED','42501':'DATABASE_PERMISSION_REFUSED','25006':'DATABASE_READ_ONLY_REFUSED','57014':'DATABASE_TIMEOUT','55P03':'DATABASE_LOCK_TIMEOUT'}.get(code,'STAGING_DATABASE_REQUEST_FAILED')
   if type(error).__name__=='OperationalError' and code is None:
    reason='DATABASE_CONNECTION_UNVERIFIED'
    message=str(error).lower()
    if 'certificate verify failed' in message or 'certificate verification' in message:reason='DATABASE_TLS_CERTIFICATE_UNVERIFIED'
    elif 'translate host name' in message or 'resolve' in message:reason='DATABASE_DNS_UNVERIFIED'
    elif 'network is unreachable' in message:reason='DATABASE_NETWORK_UNREACHABLE'
   raise EventCaptureError(reason) from None
