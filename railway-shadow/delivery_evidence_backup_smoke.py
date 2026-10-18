"""Default-off, staging-only real object-store acceptance with synthetic evidence."""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import tempfile
import time

from delivery_evidence_backup import storage_configuration,BackupWorker
from delivery_evidence_journal import DeliveryEvidenceJournal
from shadow_collector import digest

def main(env=None):
    env=os.environ if env is None else env
    if env.get('MASTER_WOK_BACKUP_SMOKE_ENABLED')!='true':
        print(json.dumps({'status':'DISABLED','networkRequests':0}));return 0
    scope={'RAILWAY_PROJECT_ID':'7821ad5b-f5c2-4ab4-9206-c3d76eefd4c8',
           'RAILWAY_ENVIRONMENT_ID':'c1b8fad6-dbfc-4188-b4b5-a5dbfbf53279',
           'RAILWAY_ENVIRONMENT_NAME':'master-wok-staging',
           'RAILWAY_SERVICE_NAME':'master-wok-evidence-backup-acceptance'}
    try:
        if any(env.get(k)!=v for k,v in scope.items()):raise ValueError('scope')
        config=storage_configuration(env)
        at=time.time();day=datetime.fromtimestamp(at,timezone.utc).date().isoformat()
        identity=hashlib.sha256(b'master-wok-synthetic-backup-acceptance-v1').hexdigest()
        audit={'status':'OBSERVED','assessmentScope':'SAVED_STATE_EVIDENCE_AUDIT_ONLY',
          'sourceEvidence':'CURRENT_SAVED_STATE_NOT_DECISION_HISTORY','serviceDate':day,
          'observedAt':datetime.fromtimestamp(at,timezone.utc).isoformat(),'snapshotHash':digest('synthetic-backup'),
          'sourceIdentity':identity,'prediction':'UNVERIFIED','recommendation':None,'verified':False,
          'deliveryOrders':0,'unknownOrderTypes':0,'records':[{'orderId':digest('synthetic-order'),
            'observedStatus':'confirmed','orderType':'collection','targetBasis':'PREFERRED','targetMinute':1140,
            'deliveryFeeBand':'UNKNOWN','coordinateEvidence':'MISSING_OR_INVALID','inServiceDate':True,
            'prediction':'UNVERIFIED','reasonCodes':[],'verified':False}]}
        with tempfile.TemporaryDirectory(prefix='mw-backup-acceptance-') as folder:
            path=Path(folder)/'delivery-evidence.sqlite3'
            journal=DeliveryEvidenceJournal(path,identity,'hvrqgufqjslvgiohgkvu',enabled=True)
            try:journal.commit(audit,at)
            finally:journal.close()
            worker=BackupWorker(config,identity,source=path,project='hvrqgufqjslvgiohgkvu')
            result=worker.run_once();worker.close()
            print(json.dumps({**result,'scope':'SYNTHETIC_STAGING_ONLY','sourceRequests':0}))
            return 0 if result['status']=='BACKUP_VERIFIED' else 1
    except Exception:
        print(json.dumps({'status':'BACKUP_ACCEPTANCE_FAILED','scope':'SYNTHETIC_STAGING_ONLY'}));return 1

if __name__=='__main__':raise SystemExit(main())
