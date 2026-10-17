"""Private controlled-date staging integration. Not a production observer."""
import hmac
import json
import os
from pathlib import Path
import signal
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from urllib.request import Request,build_opener,ProxyHandler
from urllib.error import HTTPError

PROJECT='hvrqgufqjslvgiohgkvu'
DAY='2099-01-17'
DB='/data/master-wok-evidence/delivery-evidence.sqlite3'

def configuration(env):
    if env.get('MASTER_WOK_EVIDENCE_STAGING_ENABLED')!='true':return None
    if env.get('RAILWAY_ENVIRONMENT_NAME')!='master-wok-staging':raise ValueError('STAGING_REQUIRED')
    values=[env.get(name,'') for name in ('MASTER_WOK_MANAGEMENT_READ_TOKEN','MASTER_WOK_PSEUDONYM_KEY','MASTER_WOK_EVIDENCE_HEALTH_TOKEN')]
    if not values[0] or len(values[1])<32 or len(values[2])<32:raise ValueError('PRIVATE_CONFIGURATION_REQUIRED')
    return values

def serve(journal,token,state,port):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def do_GET(self):
            if self.path!='/healthz':self.send_error(404);return
            if not hmac.compare_digest(self.headers.get('Authorization','').encode(),('Bearer '+token).encode()):
                self.send_error(401);return
            healthy=state['observed'] and journal.health([DAY])['healthy']
            body=json.dumps({'status':'HEALTHY' if healthy else 'UNHEALTHY','scope':'STAGING_SAVED_STATE_EVIDENCE','verified':False}).encode()
            self.send_response(200 if healthy else 503)
            self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)))
            self.end_headers();self.wfile.write(body)
    server=ThreadingHTTPServer(('0.0.0.0',port),Handler);server.daemon_threads=True
    threading.Thread(target=server.serve_forever,daemon=True).start()
    return server

def probe(server,token):
    url='http://127.0.0.1:'+str(server.server_address[1])+'/healthz'
    opener=build_opener(ProxyHandler({}))
    try:response=opener.open(Request(url,headers={'Authorization':'Bearer '+token}),timeout=3)
    except HTTPError as error:
        if error.code!=503:
            error.close();raise
        response=error
    with response:
        status=response.status;body=json.loads(response.read(1024))
        if body.get('verified') is not False or body.get('status')!=('HEALTHY' if status==200 else 'UNHEALTHY'):raise ValueError('BAD_HEALTH_BODY')
    try:
        with opener.open(url,timeout=3):pass
    except HTTPError as error:
        code=error.code;error.close()
        if code==401:return {'authenticatedHealthStatus':status,'unauthenticatedHealthStatus':401}
    raise ValueError('HEALTH_AUTH_FAILED')

def backup_check(journal,factory):
    with tempfile.TemporaryDirectory(prefix='evidence-restore-',dir='/data') as directory:
        path=Path(directory)/'delivery-evidence.sqlite3'
        journal.backup_to(path)
        restored=factory(path,journal.identity,PROJECT,enabled=True)
        try:
            for table in ('evidence_states','evidence_polls','evidence_presence','evidence_transitions'):
                if journal.db.execute('SELECT count(*) FROM '+table).fetchone()!=restored.db.execute('SELECT count(*) FROM '+table).fetchone():raise ValueError('RESTORE_MISMATCH')
            if restored.db.execute('PRAGMA integrity_check').fetchone()!=('ok',):raise ValueError('RESTORE_CORRUPT')
        finally:restored.close()
    return 'PASSED_ON_SAME_VOLUME'

def main():
    journal=server=None
    try:
        config=configuration(os.environ)
        if config is None:
            print(json.dumps({'status':'DISABLED','networkRequests':0,'verified':False}),flush=True);return 0
        token,secret,health_token=config
        sys.path.insert(0,str(Path.cwd()/'railway-shadow'))
        from delivery_shadow_source import read_delivery_snapshot
        from delivery_evidence_journal import DeliveryEvidenceJournal,poll_evidence
        def fetch():return read_delivery_snapshot('https://'+PROJECT+'.supabase.co',token,secret,DAY,enabled=True)
        initial=fetch()
        journal=DeliveryEvidenceJournal(DB,initial['sourceIdentity'],PROJECT,enabled=True)
        state={'observed':False};server=serve(journal,health_token,state,int(os.environ.get('PORT','8080')))
        stop=threading.Event()
        for sig in (signal.SIGTERM,signal.SIGINT):signal.signal(sig,lambda *_:stop.set())
        cached=[initial]
        inject=os.environ.get('MASTER_WOK_EVIDENCE_STAGING_FAULT_ONCE')=='true'
        backup=os.environ.get('MASTER_WOK_EVIDENCE_STAGING_BACKUP_CHECK')=='true'
        while not stop.is_set():
            injected=inject
            def reader():
                nonlocal inject
                if inject:
                    inject=False;cached.clear();raise RuntimeError('CONTROLLED_STAGING_SOURCE_FAILURE')
                return cached.pop() if cached else fetch()
            result=poll_evidence(journal,DAY,reader,enabled=True)
            state['observed']=result['status']=='OBSERVED'
            event={**result,'scope':'STAGING_SAVED_STATE_EVIDENCE','serviceDate':DAY,
              'stagingFaultInjected':injected,'healthy':state['observed'] and journal.health([DAY])['healthy']}
            for label,table in [('durableStates','evidence_states'),('pollRecords','evidence_polls'),('presentOrders','evidence_presence'),('transitions','evidence_transitions')]:
                event[label]=journal.db.execute('SELECT count(*) FROM '+table).fetchone()[0]
            event.update(probe(server,health_token))
            if backup and state['observed']:
                event['backupRestore']=backup_check(journal,DeliveryEvidenceJournal);backup=False
            print(json.dumps(event,separators=(',',':')),flush=True)
            stop.wait(60)
        return 0
    except Exception:
        print(json.dumps({'status':'EVIDENCE_STAGING_WORKER_FAILED','verified':False}),flush=True);return 1
    finally:
        if server:server.shutdown();server.server_close()
        if journal:journal.close()

if __name__=='__main__':raise SystemExit(main())
