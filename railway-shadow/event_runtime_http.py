"""Authenticated synthetic staging operator API; no public customer authorization."""
import hmac
from http.server import HTTPServer,BaseHTTPRequestHandler
import json
import threading
from event_staging_handlers import admin_action,customer_response
from event_capture_journal import EventCaptureError

def serve_api(stream_id,operator_token,health_token,writer,health,*,host='127.0.0.1',port=0,response_secret=None,creation_transport=None,cutover_response=None,checkout_submission=None):
 if any(not isinstance(t,str) or len(t)<32 for t in (operator_token,health_token)) or operator_token==health_token:raise ValueError('DISTINCT_STAGING_TOKENS_REQUIRED')
 class Handler(BaseHTTPRequestHandler):
  def log_message(self,*args):pass
  def send(self,status,body):
   data=json.dumps(body).encode();self.send_response(status);self.send_header('Content-Type','application/json')
   self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
  def authorized(self,token):return hmac.compare_digest(self.headers.get('Authorization','').encode(),('Bearer '+token).encode())
  def do_GET(self):
   if self.path!='/healthz':return self.send(404,dict(status='NOT_FOUND'))
   if not self.authorized(health_token):return self.send(401,dict(status='UNAUTHORIZED'))
   okay=health();self.send(200 if okay else 503,dict(status='HEALTHY' if okay else 'UNHEALTHY',verified=False))
  def do_POST(self):
   self.connection.settimeout(5)
   if not self.authorized(operator_token):return self.send(401,dict(status='UNAUTHORIZED'))
   allowed=('/staging/admin-action','/staging/customer-response')+ (('/staging/proposal-response',) if response_secret is not None else ())
   if creation_transport is not None:allowed+=('/staging/create-booking',)
   if cutover_response is not None:allowed+=('/staging/cutover-proposal-response',)
   if checkout_submission is not None:allowed+=('/staging/submit-checkout',)
   if self.path not in allowed:return self.send(404,dict(status='NOT_FOUND'))
   try:
    if self.headers.get('Transfer-Encoding'):raise ValueError()
    size=int(self.headers.get('Content-Length','0'))
    limit=100512 if self.path=='/staging/submit-checkout' else 8192
    if not 1<=size<=limit:raise ValueError()
    data=self.rfile.read(size)
    if len(data)!=size:raise ValueError()
    def unique(pairs):
     result={}
     for key,value in pairs:
      if key in result:raise ValueError()
      result[key]=value
     return result
    body=json.loads(data,object_pairs_hook=unique) if self.path in ('/staging/cutover-proposal-response','/staging/submit-checkout') else json.loads(data)
    if not isinstance(body,dict):raise ValueError()
    if self.path=='/staging/submit-checkout':
     result=checkout_submission(body)
    elif self.path=='/staging/cutover-proposal-response':
     result=cutover_response(body)
    elif self.path=='/staging/create-booking':
     from event_booking_transport import CREATE_QUERY
     if set(body)!={'requestId','orderId','orderAlias','preferredTime','lines'}:raise ValueError()
     rows=creation_transport(dict(query=CREATE_QUERY,parameters=[stream_id,body['requestId'],body['orderId'],body['orderAlias'],body['preferredTime'],body['lines']]))
     if not isinstance(rows,list) or len(rows)!=1 or set(rows[0])!={'result'} or rows[0]['result'] not in ('RECORDED','ALREADY_RECORDED'):raise ValueError()
     result=dict(status=rows[0]['result'],sourceRequests=1,verified=False)
    elif self.path=='/staging/proposal-response':
     from event_customer_response_staging import respond
     result=respond('POST',body,stream_id,enabled=True,secret=response_secret,transport=writer)
    elif self.path=='/staging/admin-action':
     if set(body)!={'requestId','orderId','action','targetAt'}:raise ValueError()
     result=admin_action(stream_id,body['requestId'],body['orderId'],body['action'],body['targetAt'],enabled=True,transport=writer)
    else:
     if set(body)!={'requestId','orderId','response','proposalEventId'}:raise ValueError()
     result=customer_response(stream_id,body['requestId'],body['orderId'],body['response'],body['proposalEventId'],enabled=True,transport=writer)
    self.send(200,result)
   except Exception as error:
    safe={'DATABASE_AUTH_REFUSED','DATABASE_PERMISSION_REFUSED','DATABASE_READ_ONLY_REFUSED','DATABASE_TIMEOUT','DATABASE_LOCK_TIMEOUT','DATABASE_TLS_CERTIFICATE_UNVERIFIED','DATABASE_DNS_UNVERIFIED','DATABASE_NETWORK_UNREACHABLE','DATABASE_CONNECTION_UNVERIFIED','STAGING_DATABASE_REQUEST_FAILED','DATABASE_ROLE_UNPROVEN','READER_WRITE_PRIVILEGES_REFUSED','STAGING_REQUEST_BUDGET_EXHAUSTED'}
    reason=str(error) if isinstance(error,EventCaptureError) and str(error) in safe else 'STAGING_ACTION_REFUSED'
    self.send(409,dict(status='UNVERIFIED',reasonCode=reason,verified=False))
 class BoundedServer(HTTPServer):
  def get_request(self):
   sock,address=super().get_request();sock.settimeout(5);return sock,address
 server=BoundedServer((host,port),Handler)
 thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
 return server,thread
