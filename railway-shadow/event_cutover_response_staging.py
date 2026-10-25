"""Unwired single-hop synthetic staging response compatibility. Default off."""
import re
from event_capture_journal import EventCaptureError
from event_customer_response_staging import respond
from event_postgres_export import PROJECT,source_identity
from event_staging_handlers import QUERY as ACTION_QUERY

QUERY='SELECT master_wok_event_test.apply_cutover_response($1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::text,$7::text) AS result'

def respond_after_cutover(method,body,origin_stream,current_stream,cutover_request,*,enabled=False,project=PROJECT,secret=None,transport=None):
 if enabled is not True:return dict(status='DISABLED',sourceRequests=0,verified=False)
 if project!=PROJECT:raise EventCaptureError('STAGING_BACKEND_REQUIRED')
 source_identity(origin_stream);source_identity(current_stream)
 if (origin_stream==current_stream or not isinstance(cutover_request,str) or
     not re.fullmatch('[a-zA-Z0-9_-]{1,100}',cutover_request) or not callable(transport)):
  raise EventCaptureError('CUTOVER_RESPONSE_ROUTE_REQUIRED')
 def relay(payload):
  if (not isinstance(payload,dict) or set(payload)!={'query','parameters'} or payload['query']!=ACTION_QUERY or
      not isinstance(payload['parameters'],list) or len(payload['parameters'])!=3):raise EventCaptureError('CUTOVER_RESPONSE_COMMAND_REQUIRED')
  stream,request,command=payload['parameters']
  if (stream!=origin_stream or set(command)!={'action','orderId','targetAt','proposalEventId'} or
      command['action'] not in ('accept','reject') or command['targetAt'] is not None):raise EventCaptureError('CUTOVER_RESPONSE_COMMAND_REQUIRED')
  return transport(dict(query=QUERY,parameters=[origin_stream,current_stream,cutover_request,request,command['orderId'],command['action'],command['proposalEventId']]))
 # Validates the original signed claims before the relay can contact a database.
 # Route identifiers are trusted server arguments, never accepted in the body.
 return respond(method,body,origin_stream,enabled=True,project=project,secret=secret,transport=relay)
