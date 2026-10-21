"""Bounded default-off private staging monitor, paired reads and object recovery only."""
import json
import os
from pathlib import Path
import signal
import threading
import time
from event_capture_journal import EventCaptureError
from event_transfer_bundle import TransferBundleStore
from event_transfer_reader import TransferPairReader
from event_transfer_recovery import PairRecovery
from event_transfer_monitor import PairMonitor,serve_health
from delivery_evidence_backup import storage_configuration
from event_transfer_trial import FLAGS
DIRECTORY=Path('/data/transfer-monitor-staging')
def configuration(env,clock=time.time):
 if env.get('MASTER_WOK_TRANSFER_MONITOR_ENABLED')!='true':return None
 required={'RAILWAY_PROJECT_ID':'7821ad5b-f5c2-4ab4-9206-c3d76eefd4c8','RAILWAY_ENVIRONMENT_ID':'c1b8fad6-dbfc-4188-b4b5-a5dbfbf53279','RAILWAY_SERVICE_ID':'012e5ef6-6225-4ab3-95f5-894583db7e83','MASTER_WOK_EVENT_RUNTIME_SCOPE':'SYNTHETIC_STAGING_EVENTS','MASTER_WOK_TRANSFER_TRIAL_ENABLED':'false','MASTER_WOK_TRANSFER_MONITOR_RECOVERY_ENABLED':'true'}
 if any(env.get(k)!=v for k,v in required.items()) or any(env.get(k)!='false' for k in FLAGS):raise EventCaptureError('PAIR_MONITOR_STAGING_SCOPE_REQUIRED')
 deadline=float(env.get('MASTER_WOK_TRANSFER_MONITOR_END_EPOCH','0'));now=clock()
 if not now<deadline<=now+600:raise EventCaptureError('PAIR_MONITOR_DEADLINE_REQUIRED')
 streams=json.loads(env.get('MASTER_WOK_TRANSFER_MONITOR_STREAMS','null'))
 if not isinstance(streams,list) or len(streams)!=2 or len(set(streams))!=2:raise EventCaptureError('TWO_STREAMS_REQUIRED')
 from event_postgres_export import source_identity
 for stream in streams:source_identity(stream)
 token=env.get('MASTER_WOK_EVENT_HEALTH_TOKEN','');port=int(env.get('PORT','8080'))
 if len(token)<32 or not 0<=port<=65535:raise EventCaptureError('PRIVATE_PAIR_HEALTH_TOKEN_REQUIRED')
 return dict(deadline=deadline,streams=streams,token=token,port=port,storage=storage_configuration(env))
def run(env=None,*,stop=None,directory=DIRECTORY,clock=time.time,reader=None,client_factory=None,emit=lambda r:print(json.dumps(r),flush=True),ready=lambda _:None):
 env=os.environ if env is None else env;config=configuration(env,clock)
 if config is None:emit(dict(status='DISABLED',sourceRequests=0,verified=False));return
 stop=threading.Event() if stop is None else stop
 store=TransferBundleStore(Path(directory)/'transfer-bundles.sqlite3',config['streams'],enabled=True);server=None
 try:
  source=TransferPairReader(env.get('MASTER_WOK_EVENT_READER_DSN'),enabled=True) if reader is None else reader
  kwargs={} if client_factory is None else dict(client_factory=client_factory)
  recovery=PairRecovery(config['storage'],enabled=True,**kwargs)
  monitor=PairMonitor(store,source,recovery,enabled=True,read_limit=8,clock=clock)
  server,thread=serve_health(monitor,config['token'],host='0.0.0.0',port=config['port']);ready(server)
  while not stop.is_set() and clock()<config['deadline']:
   emit(monitor.cycle())
   if store.db.execute('SELECT used FROM pair_monitor_budget').fetchone()[0]>=8:break
   stop.wait(min(60,max(0,config['deadline']-clock())))
  monitor.fail('BOUNDED_MONITOR_STOPPED')
 finally:
  if server:server.shutdown();server.server_close();thread.join(timeout=2)
  store.close()
if __name__=='__main__':
 stop=threading.Event()
 for sig in (signal.SIGTERM,signal.SIGINT):signal.signal(sig,lambda *_:stop.set())
 try:run(stop=stop)
 except Exception:print(json.dumps(dict(status='UNVERIFIED',reasonCode='PAIR_MONITOR_STAGING_FAILED',verified=False)),flush=True);raise SystemExit(1)
