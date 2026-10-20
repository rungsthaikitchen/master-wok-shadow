"""Fixed-query production-shaped synthetic staging writer; no production path."""
import json
import uuid
from event_capture_journal import EventCaptureError
from event_runtime_transport import connection_parameters,ROLES
from event_staging_handlers import QUERY as ACTION_QUERY
CREATE_QUERY='SELECT master_wok_event_test.create_booking($1::uuid,$2::text,$3::uuid,$4::text,$5::timestamptz,$6::jsonb) AS result'

class BookingTransport:
 def __init__(self,dsn,*,connect=None):
  self.parameters=connection_parameters(dsn,'writer');self.connect=connect
 def __call__(self,payload):
  if not isinstance(payload,dict) or set(payload)!={'query','parameters'}:raise EventCaptureError('FIXED_BOOKING_QUERY_REQUIRED')
  params=payload['parameters']
  if not isinstance(params,list):raise EventCaptureError('BOOKING_PARAMETERS_REQUIRED')
  create=payload['query']==CREATE_QUERY
  if create:
   if len(params)!=6:raise EventCaptureError('BOOKING_PARAMETERS_REQUIRED')
  elif payload['query']==ACTION_QUERY:
   if len(params)!=3 or not isinstance(params[2],dict) or set(params[2])!={'action','orderId','targetAt','proposalEventId'}:raise EventCaptureError('BOOKING_PARAMETERS_REQUIRED')
  else:raise EventCaptureError('FIXED_BOOKING_QUERY_REQUIRED')
  try:
   connect=self.connect
   if connect is None:
    import psycopg
    connect=psycopg.connect
   with connect(**self.parameters) as connection:
    with connection.cursor() as cursor:
     cursor.execute('SELECT current_user,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')
     if cursor.fetchone()!=(ROLES['writer'],False,False):raise EventCaptureError('DATABASE_ROLE_UNPROVEN')
     if create:
      cursor.execute('SELECT master_wok_event_test.create_booking(%s::uuid,%s::text,%s::uuid,%s::text,%s::timestamptz,%s::jsonb)',params[:5]+[json.dumps(params[5],allow_nan=False)])
     else:
      stream,rid,command=params
      # The signed alias is resolved by the database, never by a caller-supplied UUID.
      cursor.execute('SELECT master_wok_event_test.apply_booking(%s::uuid,%s::text,(SELECT id FROM master_wok_event_test.booking_rows WHERE stream_id=%s::uuid AND order_alias=%s),%s::text,%s::timestamptz,%s::text)',
       [stream,rid,stream,command['orderId'],command['action'],command['targetAt'],command['proposalEventId']])
     return [dict(result=row[0]) for row in cursor.fetchall()]
  except EventCaptureError:raise
  except Exception:
   raise EventCaptureError('STAGING_BOOKING_TRANSACTION_FAILED') from None
