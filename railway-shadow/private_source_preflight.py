"""Two bounded staging SELECT cases, no database writes or provider calls."""
import json
import os
import time
from shadow_collector import ManagementReadOnlySource,ShadowError
from delivery_minimal_candidate import read,QUERY,point
from delivery_private_bridge import PrivateCandidateBridge

PROJECT='hvrqgufqjslvgiohgkvu'
DAY='2026-10-15'
FIXTURE="""WITH synthetic_orders AS (
 SELECT 'synthetic-order'::text AS id,'2026-10-15T15:45:00Z'::timestamptz AS created_at,
 '2026-10-15T16:00:00Z'::timestamptz AS preferred_time,
 '2026-10-15T16:30:00Z'::timestamptz AS proposed_time,
 '2026-10-15T16:30:00Z'::timestamptz AS confirmed_time,
 'completed'::text AS status,false AS is_test,'delivery'::text AS order_type,
 51.51::numeric AS customer_lat,-0.13::numeric AS customer_lng
), synthetic_items AS (
 SELECT 'synthetic-line'::text AS id,'synthetic-order'::text AS order_id,
 'panang-curry'::text AS item_id,1 AS qty,'[{"id":"chicken"}]'::jsonb AS modifiers
), """
SYNTHETIC_QUERY=FIXTURE+QUERY.removeprefix('WITH ').replace('public.orders','synthetic_orders').replace('public.order_items','synthetic_items')
SAFE_REASONS={'FIRST_ORDER_COMMITMENT_UNVERIFIED','SOURCE_COVERAGE_UNVERIFIED',
    'SOURCE_READ_ONLY_PROOF_REQUIRED','CUSTOMER_POINT_UNVERIFIED','SOURCE_ITEM_MEMBERSHIP_UNVERIFIED',
    'SINGLE_SOURCE_CANDIDATE_REQUIRED','SOURCE_CLOCK_UNVERIFIED'}

def run(env,*,transport=None,invoke=None,clock=time.time):
    if env.get('MASTER_WOK_PRIVATE_PREFLIGHT_ENABLED')!='true':
        return dict(status='DISABLED',sourceRequests=0,googleRequests=0,verified=False)
    required={'RAILWAY_PROJECT_ID':'7821ad5b-f5c2-4ab4-9206-c3d76eefd4c8',
        'RAILWAY_ENVIRONMENT_ID':'c1b8fad6-dbfc-4188-b4b5-a5dbfbf53279',
        'RAILWAY_ENVIRONMENT_NAME':'master-wok-staging','RAILWAY_SERVICE_NAME':'master-wok-private-source-check'}
    if any(env.get(k)!=v for k,v in required.items()):
        return dict(status='UNVERIFIED',reasonCode='EXPLICIT_STAGING_SCOPE_REQUIRED',sourceRequests=0,googleRequests=0,verified=False)
    calls=0
    try:
        if 'MASTER_WOK_STAGING_GOOGLE_ROUTES_KEY' in env:raise ShadowError('PROVIDER_KEY_REFUSED')
        # Owner explicitly approved this private staging configuration. Never
        # include its value in logs, results, source control or public endpoints.
        origin_point=json.loads(env.get('MASTER_WOK_PRIVATE_PREFLIGHT_ORIGIN',''))
        if not point(origin_point):raise ShadowError('VERIFIED_KITCHEN_ORIGIN_REQUIRED')
        origin=dict(point=origin_point,verified=True,provenance='OWNER_VERIFIED_KITCHEN_ORIGIN')
        token=env.get('MASTER_WOK_MANAGEMENT_READ_TOKEN')
        secret=env.get('MASTER_WOK_PSEUDONYM_KEY')
        actual=ManagementReadOnlySource('https://'+PROJECT+'.supabase.co',token,transport=transport)
        results={}
        for name,query in [('saved',QUERY),('synthetic',SYNTHETIC_QUERY)]:
            def selected_transport(payload):
                nonlocal calls
                if payload['query']!=QUERY:raise ShadowError('FIXED_QUERY_REQUIRED')
                calls+=1
                return actual.transport(dict(payload,query=query))
            def reader():return read('https://'+PROJECT+'.supabase.co',token,DAY,secret,origin,
                enabled=True,approved_project=PROJECT,transport=selected_transport,clock=clock)
            bridge=PrivateCandidateBridge(reader,enabled=True,invoke=invoke)
            try:
                candidate=bridge.read_candidate()
                results[name]=dict(status='PREPARED' if candidate else 'NO_CANDIDATE')
            except Exception as error:
                reason=str(error) if isinstance(error,ShadowError) and str(error) in SAFE_REASONS else 'PRIVATE_PREFLIGHT_REFUSED'
                results[name]=dict(status='UNVERIFIED',reasonCode=reason)
                if name=='synthetic':raise ShadowError('SYNTHETIC_PREFLIGHT_FAILED') from None
            finally:
                bridge.prepared=None;bridge.candidate=None
        return dict(status='PREFLIGHT_ACCEPTANCE_PASSED',cases=results,sourceRequests=calls,
            googleRequests=0,sourceWrites=0,originBasis='OWNER_CONFIRMED_PRIVATE_CONFIGURATION',customerCoordinatesPersisted=False,verified=False)
    except Exception:
        return dict(status='UNVERIFIED',reasonCode='STAGING_PREFLIGHT_FAILED',sourceRequests=calls,
                    googleRequests=0,sourceWrites=0,verified=False)

if __name__=='__main__':
    result=run(os.environ);print(json.dumps(result),flush=True)
    if result['status']=='UNVERIFIED':raise SystemExit(1)
