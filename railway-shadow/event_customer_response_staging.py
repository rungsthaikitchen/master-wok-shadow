"""Unwired synthetic staging response adapter. No HTTP listener or production hook."""
import base64
import hashlib
import hmac
import json
import re
from event_capture_journal import EventCaptureError, canonical
from event_postgres_export import PROJECT, source_identity
from event_staging_handlers import customer_response
SCOPE='SYNTHETIC_STAGING_PROPOSAL_RESPONSE_V1'

def _key(secret):
    if not isinstance(secret, bytes) or len(secret)<32:
        raise EventCaptureError('RESPONSE_SIGNING_KEY_REQUIRED')
    return secret

def _encode(value):
    return base64.urlsafe_b64encode(value).rstrip(b'=').decode('ascii')

def _claims(stream, order, proposal):
    source_identity(stream)
    if not isinstance(order,str) or not re.fullmatch(r'synthetic-[a-z0-9_-]{1,80}',order):
        raise EventCaptureError('SYNTHETIC_ORDER_REQUIRED')
    if not isinstance(proposal,str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,100}',proposal):
        raise EventCaptureError('PROPOSAL_ID_REQUIRED')
    return dict(scope=SCOPE,streamId=stream,orderId=order,proposalEventId=proposal)

def issue_token(stream_id,order_id,proposal_event_id,*,enabled=False,project=PROJECT,secret=None):
    if enabled is not True:return None
    if project!=PROJECT:raise EventCaptureError('STAGING_BACKEND_REQUIRED')
    payload=_encode(canonical(_claims(stream_id,order_id,proposal_event_id)).encode())
    signature=_encode(hmac.digest(_key(secret),payload.encode(),'sha256'))
    return payload+'.'+signature

def respond(method,body,stream_id,*,enabled=False,project=PROJECT,secret=None,transport=None):
    # Disabled gate precedes parsing, key handling and all transport work.
    if enabled is not True:return dict(status='DISABLED',sourceRequests=0,verified=False)
    if project!=PROJECT:raise EventCaptureError('STAGING_BACKEND_REQUIRED')
    source_identity(stream_id)
    if method!='POST':raise EventCaptureError('RESPONSE_POST_REQUIRED')
    if not isinstance(body,dict) or set(body)!={'token','decision'} or body['decision'] not in ('accept','reject'):
        raise EventCaptureError('RESPONSE_BODY_REQUIRED')
    token=body['token']
    if not isinstance(token,str) or len(token)>1024 or not re.fullmatch(r'[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}',token):
        raise EventCaptureError('RESPONSE_TOKEN_REFUSED')
    payload,signature=token.split('.')
    expected=_encode(hmac.digest(_key(secret),payload.encode(),'sha256'))
    if not hmac.compare_digest(signature,expected):raise EventCaptureError('RESPONSE_TOKEN_REFUSED')
    try:
        claims=json.loads(base64.urlsafe_b64decode(payload+'='*(-len(payload)%4)))
        approved=_claims(claims['streamId'],claims['orderId'],claims['proposalEventId'])
        if claims!=approved or claims['streamId']!=stream_id or _encode(canonical(claims).encode())!=payload:
            raise ValueError('claims')
    except Exception:raise EventCaptureError('RESPONSE_TOKEN_REFUSED') from None
    # Same proposal/response retries use one stable ID; opposite responses compete
    # as separate commands under the existing source transaction's proposal guard.
    request_id='reply_'+hashlib.sha256((token+'\0'+body['decision']).encode()).hexdigest()
    return customer_response(stream_id,request_id,claims['orderId'],body['decision'],claims['proposalEventId'],
        enabled=True,project=project,transport=transport)
