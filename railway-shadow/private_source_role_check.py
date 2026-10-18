"""One-shot staging-only connection proof. No order or coordinate projection."""
import json
import os
from shadow_collector import ManagementReadOnlySource

QUERY="SELECT current_user AS source_role, pg_catalog.current_setting('transaction_read_only') AS read_only"
PROJECT='hvrqgufqjslvgiohgkvu'

def run(env,*,transport=None):
    if env.get('MASTER_WOK_PRIVATE_SOURCE_CHECK_ENABLED')!='true':
        return dict(status='DISABLED',sourceRequests=0,googleRequests=0,verified=False)
    expected={'RAILWAY_PROJECT_ID':'7821ad5b-f5c2-4ab4-9206-c3d76eefd4c8',
        'RAILWAY_ENVIRONMENT_ID':'c1b8fad6-dbfc-4188-b4b5-a5dbfbf53279',
        'RAILWAY_ENVIRONMENT_NAME':'master-wok-staging',
        'RAILWAY_SERVICE_NAME':'master-wok-private-source-check'}
    if any(env.get(k)!=v for k,v in expected.items()):
        return dict(status='UNVERIFIED',reasonCode='EXPLICIT_STAGING_SCOPE_REQUIRED',
                    sourceRequests=0,googleRequests=0,verified=False)
    attempted=0
    try:
        reader=ManagementReadOnlySource('https://'+PROJECT+'.supabase.co',
            env.get('MASTER_WOK_MANAGEMENT_READ_TOKEN'),transport=transport)
        attempted=1
        rows=reader.transport({'query':QUERY})
        if (not isinstance(rows,list) or len(rows)!=1 or not isinstance(rows[0],dict) or
            rows[0].get('source_role')!='supabase_read_only_user' or rows[0].get('read_only')!='on'):
            return dict(status='UNVERIFIED',reasonCode='RESTRICTED_READ_ONLY_PROOF_MISSING',
                        sourceRequests=attempted,googleRequests=0,verified=False)
        return dict(status='READ_ONLY_CONNECTION_CONFIRMED',sourceRole='supabase_read_only_user',
                    transactionReadOnly=True,sourceRequests=attempted,googleRequests=0,
                    orderDataRead=False,verified=False)
    except Exception:
        return dict(status='UNVERIFIED',reasonCode='STAGING_SOURCE_CHECK_FAILED',
                    sourceRequests=attempted,googleRequests=0,verified=False)

if __name__=='__main__':
    result=run(os.environ);print(json.dumps(result),flush=True)
    if result['status']=='UNVERIFIED':raise SystemExit(1)
