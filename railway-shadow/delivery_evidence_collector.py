"""Prepared production evidence-only observer. Default off; no booking/route hooks."""
from dataclasses import dataclass,field
from datetime import datetime,timedelta,timezone
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler,HTTPServer
import json
import os
from pathlib import Path
import signal
import threading
from urllib.error import HTTPError
from zoneinfo import ZoneInfo

from delivery_evidence_journal import DeliveryEvidenceJournal,EvidenceError,poll_evidence,run_audit
from delivery_shadow_source import read_delivery_snapshot
from shadow_collector import digest

PROJECT='ubyjrrsvbbqomitpaidb'
RAILWAY_PROJECT='7821ad5b-f5c2-4ab4-9206-c3d76eefd4c8'
ENVIRONMENT='b61e66e7-dbaa-4343-9ca6-5e6f0f5d7612'
ENVIRONMENT_NAME='master-wok-production-shadow'
SERVICE_NAME='master-wok-delivery-evidence-production'
SOURCE='https://'+PROJECT+'.supabase.co'
DEFAULT_DB='/data/master-wok-delivery-evidence/delivery-evidence.sqlite3'
LONDON=ZoneInfo('Europe/London')

@dataclass(frozen=True)
class Config:
    token:str=field(repr=False)
    alias_key:str=field(repr=False)
    health_token:str=field(repr=False)
    db:str=DEFAULT_DB
    port:int=8080

def configuration(env):
    # Default-off gate before credential inspection, disk access or networking.
    if env.get('MASTER_WOK_DELIVERY_EVIDENCE_ENABLED')!='true':return None
    required={'RAILWAY_PROJECT_ID':RAILWAY_PROJECT,'RAILWAY_ENVIRONMENT_ID':ENVIRONMENT,
              'RAILWAY_ENVIRONMENT_NAME':ENVIRONMENT_NAME,'RAILWAY_SERVICE_NAME':SERVICE_NAME,
              'RAILWAY_VOLUME_MOUNT_PATH':'/data'}
    if any(env.get(k)!=v for k,v in required.items()):raise EvidenceError('PRODUCTION_EVIDENCE_SCOPE_REQUIRED')
    token=env.get('MASTER_WOK_MANAGEMENT_READ_TOKEN','')
    key=env.get('MASTER_WOK_PSEUDONYM_KEY','')
    health=env.get('MASTER_WOK_DELIVERY_EVIDENCE_HEALTH_TOKEN','')
    if not token or len(key)<32 or len(health)<32:raise EvidenceError('PRIVATE_CONFIGURATION_REQUIRED')
    path=env.get('MASTER_WOK_DELIVERY_EVIDENCE_DB',DEFAULT_DB)
    if path!=DEFAULT_DB:raise EvidenceError('DEDICATED_PRODUCTION_PATH_REQUIRED')
    port=int(env.get('PORT','8080'))
    if not 1<=port<=65535:raise EvidenceError('INVALID_PORT')
    return Config(token,key,health,path,port)

def utc_now():return datetime.now(timezone.utc).timestamp()

def service_dates(at):
    today=datetime.fromtimestamp(at,timezone.utc).astimezone(LONDON).date()
    return [today.isoformat(),(today+timedelta(days=1)).isoformat()]

def source_identity(key):
    namespace=hmac.new(key.encode(),b'master-wok-delivery-source-v1',hashlib.sha256).hexdigest()
    return digest({'project':PROJECT,'namespace':namespace})

class EvidenceCollector:
    def __init__(self,config,*,reader=None,assessor=run_audit,clock=utc_now):
        self.config,self.clock,self.assessor=config,clock,assessor
        self.reader=reader or self.fetch
        self.stopping=threading.Event()
        self.journal=DeliveryEvidenceJournal(config.db,source_identity(config.alias_key),PROJECT,enabled=True)
        self.collector_build=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()

    def fetch(self,day):
        try:
            return read_delivery_snapshot(SOURCE,self.config.token,self.config.alias_key,day,enabled=True)
        except HTTPError as error:
            # urllib raises before entering the response context on 4xx/5xx.
            error.close()
            raise EvidenceError('SOURCE_FAILED') from None

    def health(self):
        try:
            healthy=not self.stopping.is_set() and self.journal.health(service_dates(self.clock()),at=self.clock())['healthy']
        except Exception:healthy=False
        return {'status':'HEALTHY' if healthy else 'UNHEALTHY',
                'scope':'SAVED_STATE_EVIDENCE_ONLY','prediction':'UNVERIFIED','verified':False}

    def summary(self,day):
        db=self.journal.db
        return {'durableStates':db.execute('SELECT count(*) FROM evidence_states').fetchone()[0],
                'pollRecords':db.execute('SELECT count(*) FROM evidence_polls').fetchone()[0],
                'presentOrdersForDay':db.execute('SELECT count(*) FROM evidence_presence WHERE service_date=?',(day,)).fetchone()[0]}

    def cycle(self,emit=None):
        events=[]
        for day in service_dates(self.clock()):
            if self.stopping.is_set():break
            result=poll_evidence(self.journal,day,lambda:self.reader(day),enabled=True,assessor=self.assessor,clock=self.clock)
            try:counts=self.summary(day)
            except Exception:
                self.journal.failed.add(day)
                try:self.journal.failure(day,self.clock(),'JOURNAL_FAILED')
                except Exception:pass
                result={'status':'POLL_FAILED','reasonCode':'JOURNAL_FAILED','verified':False};counts={}
            event={**result,'serviceDate':day,'scope':'SAVED_STATE_EVIDENCE_ONLY',
                   'healthy':self.health()['status']=='HEALTHY','collectorBuild':self.collector_build,
                   'auditBuild':self.journal.build,**counts}
            events.append(event)
            if emit:emit(event)
        return events

    def close(self):
        self.stopping.set();self.journal.close()

class HealthServer(HTTPServer):
    def get_request(self):
        connection,address=super().get_request();connection.settimeout(2)
        return connection,address

def serve_health(collector,port):
    token=collector.config.health_token
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def do_GET(self):
            if self.path!='/healthz':self.reply(404,{'status':'NOT_FOUND'});return
            if not hmac.compare_digest(self.headers.get('Authorization','').encode(),('Bearer '+token).encode()):
                self.reply(401,{'status':'UNAUTHORIZED'});return
            result=collector.health();self.reply(200 if result['status']=='HEALTHY' else 503,result)
        def reply(self,code,result):
            body=json.dumps(result,separators=(',',':')).encode()
            self.send_response(code);self.send_header('Content-Type','application/json')
            self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(body)))
            self.end_headers();self.wfile.write(body)
    server=HealthServer(('0.0.0.0',port),Handler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    return server

def main():
    collector=server=None;phase='CONFIGURATION'
    previous={}
    try:
        config=configuration(os.environ)
        if config is None:
            print(json.dumps({'status':'DISABLED','networkRequests':0,'verified':False}),flush=True);return 0
        phase='VOLUME'
        if not os.path.ismount('/data'):raise EvidenceError('PERSISTENT_VOLUME_REQUIRED')
        phase='JOURNAL'
        collector=EvidenceCollector(config)
        phase='HEALTH_BIND'
        server=serve_health(collector,config.port)
        def stop(*args):collector.stopping.set()
        previous={sig:signal.signal(sig,stop) for sig in (signal.SIGTERM,signal.SIGINT)}
        phase='COLLECTOR'
        def emit(value):print(json.dumps(value,separators=(',',':')),flush=True)
        while not collector.stopping.is_set():
            collector.cycle(emit)
            collector.stopping.wait(60)
        return 0
    except Exception:
        print(json.dumps({'status':'EVIDENCE_START_OR_RUNTIME_FAILED','reasonCode':phase+'_FAILED','verified':False}),flush=True)
        return 1
    finally:
        if collector:collector.stopping.set()
        if server:server.shutdown();server.server_close()
        if collector:collector.close()
        for sig,handler in previous.items():signal.signal(sig,handler)

if __name__=='__main__':raise SystemExit(main())
