"""Staging-only logical route adapters; no web server or production backend hooks."""
import re
from event_capture_journal import EventCaptureError
from event_postgres_export import PROJECT,source_identity
from shadow_collector import timestamp
QUERY='SELECT master_wok_event_test.handle($1::uuid,$2::text,$3::jsonb) AS result'

def _handle(stream_id,request_id,order_id,action,target,proposal,enabled,project,transport):
 if enabled is not True:return dict(status='DISABLED',sourceRequests=0,verified=False)
 source_identity(stream_id)
 if project!=PROJECT or not callable(transport):raise EventCaptureError('STAGING_BACKEND_REQUIRED')
 if not isinstance(request_id,str) or not re.fullmatch('[a-zA-Z0-9_-]{1,100}',request_id):raise EventCaptureError('REQUEST_ID_REQUIRED')
 if not isinstance(order_id,str) or not re.fullmatch('synthetic-[a-z0-9_-]{1,80}',order_id):raise EventCaptureError('SYNTHETIC_ORDER_REQUIRED')
 if target is not None:timestamp(target)
 if proposal is not None and (not isinstance(proposal,str) or not re.fullmatch('[a-zA-Z0-9_-]{1,100}',proposal)):raise EventCaptureError('PROPOSAL_ID_REQUIRED')
 command=dict(action=action,orderId=order_id,targetAt=target,proposalEventId=proposal)
 rows=transport(dict(query=QUERY,parameters=[stream_id,request_id,command]))
 if not isinstance(rows,list) or len(rows)!=1 or not isinstance(rows[0],dict) or set(rows[0])!={'result'} or rows[0]['result'] not in ('RECORDED','ALREADY_RECORDED'):raise EventCaptureError('BACKEND_RESULT_REQUIRED')
 return dict(status=rows[0]['result'],sourceRequests=1,verified=False)

def admin_action(stream_id=None,request_id=None,order_id=None,action=None,target_at=None,*,enabled=False,project=PROJECT,transport=None):
 if enabled is not True:return dict(status='DISABLED',sourceRequests=0,verified=False)
 if action not in ('offer','confirm','cancel','complete') or (action in ('offer','confirm'))!=(target_at is not None):raise EventCaptureError('ADMIN_ACTION_REQUIRED')
 return _handle(stream_id,request_id,order_id,action,target_at,None,enabled,project,transport)

def customer_response(stream_id=None,request_id=None,order_id=None,response=None,proposal_event_id=None,*,enabled=False,project=PROJECT,transport=None):
 if enabled is not True:return dict(status='DISABLED',sourceRequests=0,verified=False)
 if response not in ('accept','reject') or proposal_event_id is None:raise EventCaptureError('CUSTOMER_RESPONSE_REQUIRED')
 return _handle(stream_id,request_id,order_id,response,None,proposal_event_id,enabled,project,transport)
