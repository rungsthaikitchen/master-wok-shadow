"""Default-off paired acquisition/comparison/recovery monitor. No writer client."""
import hmac
from http.server import HTTPServer,BaseHTTPRequestHandler
import json
import math
from pathlib import Path
import sqlite3
import threading
import time
import uuid
from event_capture_journal import EventCaptureError
from event_postgres_export import ingest_export
from event_transfer_bundle import TransferBundleStore,poll_pair,bundle_build
from event_transfer_recovery import fingerprint

class PairMonitor:
 def __init__(self,store=None,reader=None,recovery=None,*,enabled=False,read_limit=8,interval=60,stale_after=180,clock=time.time):
  self.enabled=enabled is True;self.clock=clock;self.failed=True
  if not self.enabled:return
  if not isinstance(store,TransferBundleStore) or not callable(reader) or not callable(getattr(recovery,'run',None)) or type(read_limit) is not int or not 1<=read_limit<=32 or not all(type(x) in (int,float) and math.isfinite(x) for x in (interval,stale_after)) or not 1<=interval<=stale_after<=180:raise EventCaptureError('PAIR_MONITOR_CONFIG_REQUIRED')
  store.assert_source_allowed();self.store=store;self.reader=reader;self.recovery=recovery;self.limit=read_limit;self.interval=interval;self.stale_after=stale_after;self.session=uuid.uuid4().hex
  with store.db:
   store.db.execute('CREATE TABLE IF NOT EXISTS pair_monitor_budget(id INTEGER PRIMARY KEY CHECK(id=1),max_reads INTEGER NOT NULL,used INTEGER NOT NULL)')
   store.db.execute('INSERT OR IGNORE INTO pair_monitor_budget VALUES (1,?,0)',(read_limit,))
   if store.db.execute('SELECT max_reads FROM pair_monitor_budget').fetchone()!=(read_limit,):raise EventCaptureError('PAIR_MONITOR_BUDGET_CHANGED')
   store.db.execute('CREATE TABLE IF NOT EXISTS pair_monitor_state(id INTEGER PRIMARY KEY CHECK(id=1),session TEXT NOT NULL,state TEXT NOT NULL,attempt_at REAL,success_at REAL,bundle_key TEXT,fingerprint TEXT,reason TEXT NOT NULL)')
   store.db.execute("INSERT OR REPLACE INTO pair_monitor_state VALUES (1,?,'STARTING',NULL,NULL,NULL,NULL,'FRESH_SOURCE_READ_REQUIRED')",(self.session,))
 def fail(self,reason='PAIR_MONITOR_CYCLE_FAILED'):
  self.failed=True
  if self.enabled:
   try:
    with self.store.db:self.store.db.execute("UPDATE pair_monitor_state SET state='FAILED',reason=? WHERE id=1 AND session=?",(reason,self.session))
   except Exception:pass
 def status(self):
  if not self.enabled:return dict(status='DISABLED',healthy=False,verified=False)
  try:
   db=sqlite3.connect(self.store.path.as_uri()+'?mode=ro',uri=True);db.execute('BEGIN')
   try:
    session,state,attempt,success,key,mark,reason=db.execute('SELECT session,state,attempt_at,success_at,bundle_key,fingerprint,reason FROM pair_monitor_state WHERE id=1').fetchone()
    used=db.execute('SELECT used FROM pair_monitor_budget').fetchone()[0]
    age=None if success is None else self.clock()-success
    okay=not self.failed and session==self.session and state=='HEALTHY' and age is not None and 0<=age<=self.stale_after
    if okay:
     okay=db.execute('SELECT build,state FROM bundles WHERE key=?',(key,)).fetchone()==(bundle_build(),'ACKED') and fingerprint(self.store,db)==mark
    return dict(status='HEALTHY' if okay else 'UNHEALTHY',healthy=bool(okay),reasonCode='FRESH_PAIRED_EVIDENCE_AND_RECOVERY' if okay else (reason if state!='HEALTHY' else 'SOURCE_STALE_OR_EVIDENCE_CHANGED'),lastAttemptAt=attempt,lastSuccessAt=success,ageSeconds=age,sourceReads=used,verified=False)
   finally:db.close()
  except Exception:return dict(status='UNHEALTHY',healthy=False,reasonCode='PAIR_MONITOR_INTEGRITY_FAILED',verified=False)
 def healthy(self):return self.status()['healthy']
 def cycle(self):
  if not self.enabled:return dict(status='DISABLED',sourceRequests=0,verified=False)
  requests=0
  try:
   now=self.clock()
   if not math.isfinite(now):raise EventCaptureError('PAIR_MONITOR_CLOCK_REQUIRED')
   prior=self.store.db.execute('SELECT attempt_at FROM pair_monitor_state WHERE id=1 AND session=?',(self.session,)).fetchone()
   if prior is None:raise EventCaptureError('PAIR_MONITOR_SESSION_REPLACED')
   if prior[0] is not None and 0<=now-prior[0]<self.interval:return dict(status='WAITING',sourceRequests=0,healthy=self.healthy(),verified=False)
   self.store.assert_source_allowed();self.failed=True
   with self.store.db:
    self.store.db.execute('BEGIN IMMEDIATE')
    used=self.store.db.execute('SELECT used FROM pair_monitor_budget').fetchone()[0]
    if used>=self.limit:raise EventCaptureError('PAIR_MONITOR_BUDGET_EXHAUSTED')
    self.store.db.execute('UPDATE pair_monitor_budget SET used=used+1')
    self.store.db.execute("UPDATE pair_monitor_state SET state='ACQUIRING',attempt_at=?,reason='SOURCE_READ_IN_PROGRESS' WHERE id=1 AND session=?",(now,self.session))
   requests=1;intake=poll_pair(self.store,enabled=True,transport=self.reader)
   for _ in range(16):
    if self.store.run_once()['status']=='IDLE':break
   counts=self.store.verify()
   if counts['bundles']!=counts['acknowledged'] or self.store.db.execute('SELECT build,state FROM bundles WHERE key=?',(intake['bundleKey'],)).fetchone()!=(bundle_build(),'ACKED'):raise EventCaptureError('PAIR_MONITOR_COMPARISON_REQUIRED')
   mark=fingerprint(self.store);proof=self.recovery.run(self.store)
   if proof.get('restored') is not True or proof.get('fingerprint')!=mark or proof.get('status') not in ('PAIR_RECOVERY_VERIFIED','CACHED_PAIR_RECOVERY_VERIFIED') or fingerprint(self.store)!=mark:raise EventCaptureError('PAIR_MONITOR_RECOVERY_REQUIRED')
   # Acquisition time, not completion or last event time, defines source freshness.
   with self.store.db:self.store.db.execute("UPDATE pair_monitor_state SET state='HEALTHY',success_at=?,bundle_key=?,fingerprint=?,reason='FRESH_PAIRED_EVIDENCE_AND_RECOVERY' WHERE id=1 AND session=?",(now,intake['bundleKey'],mark,self.session))
   self.failed=False
   if not self.healthy():raise EventCaptureError('PAIR_MONITOR_STALE_ON_COMPLETION')
   return dict(status='OBSERVED',sourceRequests=1,intake=intake['status'],recovery=proof['status'],acknowledgedBundles=counts['acknowledged'],healthy=True,verified=False)
  except Exception:
   self.fail();return dict(status='UNVERIFIED',reasonCode='PAIR_MONITOR_CYCLE_FAILED',sourceRequests=requests,healthy=False,verified=False)

def route_export(rows,journal,stream_id,*,enabled=False,pair_monitor=None):
 """A transfer hint triggers NEW paired acquisition; never pair polled single sides."""
 if enabled is not True:return dict(status='DISABLED',sourceRequests=0,verified=False)
 try:return ingest_export(rows,journal,stream_id)
 except EventCaptureError as error:
  if str(error)!='TRANSFER_BUNDLE_REQUIRED':raise
  if not isinstance(pair_monitor,PairMonitor) or not pair_monitor.enabled or stream_id not in pair_monitor.store.streams:return dict(status='UNVERIFIED',reasonCode='TRANSFER_BUNDLE_REQUIRED',sourceRequests=0,verified=False)
  return pair_monitor.cycle()

def serve_health(monitor,token,*,host='127.0.0.1',port=0):
 if not isinstance(token,str) or len(token)<32:raise EventCaptureError('PRIVATE_PAIR_HEALTH_TOKEN_REQUIRED')
 class Handler(BaseHTTPRequestHandler):
  def log_message(self,*_):pass
  def send(self,code,body):
   data=json.dumps(body,allow_nan=False).encode();self.send_response(code);self.send_header('Content-Type','application/json');self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
  def do_GET(self):
   if self.path!='/healthz':return self.send(404,dict(status='NOT_FOUND'))
   if not hmac.compare_digest(self.headers.get('Authorization','').encode(),('Bearer '+token).encode()):return self.send(401,dict(status='UNAUTHORIZED'))
   result=monitor.status();self.send(200 if result['healthy'] else 503,result)
  def do_POST(self):self.send(405,dict(status='METHOD_NOT_ALLOWED'))
 class BoundedServer(HTTPServer):
  def get_request(self):
   sock,address=super().get_request();sock.settimeout(5);return sock,address
 server=BoundedServer((host,port),Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start();return server,thread
