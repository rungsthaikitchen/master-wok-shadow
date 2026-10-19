"""Authenticated synthetic staging operator API; no public customer authorization."""
import hmac
from http.server import HTTPServer,BaseHTTPRequestHandler
import json
import threading
from event_staging_handlers import admin_action,customer_response
from event_capture_journal import EventCaptureError

def serve_api(stream_id,operator_token,health_token,writer,health,*,host='127.0.0.1',port=0):
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
   if self.path not in ('/staging/admin-action','/staging/customer-response'):return self.send(404,dict(status='NOT_FOUND'))
   try:
    if self.headers.get('Transfer-Encoding'):raise ValueError()
    size=int(self.headers.get('Content-Length','0'))
    if not 1<=size<=8192:raise ValueError()
    data=self.rfile.read(size)
    if len(data)!=size:raise ValueError()
    body=json.loads(data)
    if not isinstance(body,dict):raise ValueError()
    if self.path=='/staging/admin-action':
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
