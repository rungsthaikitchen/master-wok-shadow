"""Default-off restricted staging delivery writer; plans come from a server callback."""
import json
from event_booking_transport import BookingTransport,CREATE_QUERY
from event_staging_handlers import QUERY as ACTION_QUERY
from event_capture_journal import EventCaptureError
from event_runtime_transport import ROLES
class DeliveryBookingTransport(BookingTransport):
 def __init__(self,dsn=None,*,enabled=False,planning=None,connect=None):
  self.enabled=enabled is True
  if not self.enabled:return
  if not callable(planning):raise EventCaptureError('TRUSTED_STAGING_PLANNING_REQUIRED')
  super().__init__(dsn,connect=connect);self.planning=planning
 def __call__(self,payload):
  if not self.enabled:return dict(status='DISABLED',sourceRequests=0,verified=False)
  if not isinstance(payload,dict) or set(payload)!={'query','parameters'} or not isinstance(payload['parameters'],list):raise EventCaptureError('FIXED_DELIVERY_QUERY_REQUIRED')
  params=payload['parameters'];create=payload['query']==CREATE_QUERY
  if create:
   if len(params)!=6:raise EventCaptureError('DELIVERY_PARAMETERS_REQUIRED')
  elif payload['query']==ACTION_QUERY:
   if len(params)!=3 or not isinstance(params[2],dict) or set(params[2])!={'action','orderId','targetAt','proposalEventId'}:raise EventCaptureError('DELIVERY_PARAMETERS_REQUIRED')
   if params[2]['action'] in ('accept','reject','cancel','complete'):return super().__call__(payload)
   if params[2]['action']!='offer':raise EventCaptureError('DELIVERY_ACTION_REFUSED')
  else:raise EventCaptureError('FIXED_DELIVERY_QUERY_REQUIRED')
  try:
   plan=self.planning(params[1])
   connect=self.connect
   if connect is None:
    import psycopg
    connect=psycopg.connect
   with connect(**self.parameters) as connection:
    with connection.cursor() as cursor:
     cursor.execute('SELECT current_user,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')
     if cursor.fetchone()!=(ROLES['writer'],False,False):raise EventCaptureError('DATABASE_ROLE_UNPROVEN')
     if create:
      cursor.execute('SELECT master_wok_event_test.create_delivery_booking(%s::uuid,%s::text,%s::uuid,%s::text,%s::timestamptz,%s::jsonb,%s::jsonb)',params[:5]+[json.dumps(params[5],allow_nan=False),json.dumps(plan,allow_nan=False)])
     else:
      stream,rid,cmd=params
      cursor.execute('SELECT master_wok_event_test.apply_delivery_booking(%s::uuid,%s::text,(SELECT id FROM master_wok_event_test.booking_rows WHERE stream_id=%s::uuid AND order_alias=%s),%s::text,%s::timestamptz,%s::jsonb)',[stream,rid,stream,cmd['orderId'],cmd['action'],cmd['targetAt'],json.dumps(plan,allow_nan=False)])
     return [dict(result=row[0]) for row in cursor.fetchall()]
  except EventCaptureError:raise
  except Exception:raise EventCaptureError('STAGING_DELIVERY_TRANSACTION_FAILED') from None
