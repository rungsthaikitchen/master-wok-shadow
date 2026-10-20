"""Default-off fixed single-snapshot transfer reader; staging TLS and read-only role."""
from event_capture_journal import EventCaptureError
from event_runtime_transport import connection_parameters,ROLES
from event_transfer_bundle import QUERY
from event_postgres_export import source_identity
class TransferPairReader:
 def __init__(self,dsn=None,*,enabled=False,connect=None):
  self.enabled=enabled is True
  if self.enabled:self.parameters=connection_parameters(dsn,'reader');self.connect=connect
 def __call__(self,payload):
  if not self.enabled:return dict(status='DISABLED',sourceRequests=0,verified=False)
  if not isinstance(payload,dict) or set(payload)!={'query','parameters'} or payload['query']!=QUERY or not isinstance(payload['parameters'],list) or len(payload['parameters'])!=2 or payload['parameters'][0]==payload['parameters'][1]:raise EventCaptureError('FIXED_TRANSFER_READ_REQUIRED')
  for stream in payload['parameters']:source_identity(stream)
  try:
   connect=self.connect
   if connect is None:
    import psycopg
    connect=psycopg.connect
   with connect(**self.parameters) as connection:
    with connection.cursor() as cursor:
     cursor.execute('SET TRANSACTION READ ONLY')
     cursor.execute('SELECT current_user,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')
     if cursor.fetchone()!=(ROLES['reader'],False,False):raise EventCaptureError('DATABASE_ROLE_UNPROVEN')
     cursor.execute("SELECT has_function_privilege(current_user,'master_wok_event_test.move_booking_offer(uuid,uuid,text,uuid,timestamptz)','EXECUTE'),has_table_privilege(current_user,'master_wok_event_test.events','INSERT')")
     if cursor.fetchone()!=(False,False):raise EventCaptureError('READER_WRITE_PRIVILEGES_REFUSED')
     cursor.execute('SELECT master_wok_event_test.export_transfer_pair(%s::uuid,%s::uuid)',payload['parameters'])
     return [dict(bundle=row[0]) for row in cursor.fetchall()]
  except EventCaptureError:raise
  except Exception:raise EventCaptureError('STAGING_TRANSFER_READ_FAILED') from None
