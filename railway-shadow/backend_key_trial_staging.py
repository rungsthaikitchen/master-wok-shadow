"""Bounded synthetic backend behaviour trial; no listening server or notifications."""
import contextlib
import io
import json
import os
from pathlib import Path
import runpy
import sys
from types import SimpleNamespace

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend-patch'))
from rtk_supabase_credentials import backend_key, create_backend_client, rest_headers
from key_compatibility_staging import URL, IDENTITY, OTHER_FLAGS

FIXTURE = Path(__file__).resolve().parents[1]/'backend-patch/fixtures/credential_backend_51616be.py'
TABLES={name:'master_wok_credential_'+name for name in ('orders','customers','loyalty_accounts')}
CUSTOMER='11111111-1111-4111-8111-111111111123'
ORDER='22222222-2222-4222-8222-222222222223'
DECLINED='33333333-3333-4333-8333-333333333323'
PHONE='+440000000023'
EMAIL='key-trial@example.invalid'
MARKER=Path('/data/backend-key-trial-23-oct-v1.started')


def require(condition):
    if not condition:raise ValueError('TRIAL_ASSERTION_FAILED')


def configuration(env):
    if env.get('MASTER_WOK_BACKEND_KEY_TRIAL_ENABLED')!='true':return None
    require(all(env.get(k)==v for k,v in IDENTITY.items()))
    require(all(env.get(k,'false')=='false' for k in (*OTHER_FLAGS,'MASTER_WOK_KEY_COMPATIBILITY_ENABLED')))
    return backend_key({'SUPABASE_SECRET_KEY':env.get('MASTER_WOK_STAGING_SECRET_KEY')})


def transport(delegate=None):
    import httpx
    class Guard(httpx.BaseTransport):
        calls=0
        writes=0
        def __init__(self):self.inner=delegate or httpx.HTTPTransport(retries=0)
        def handle_request(self,request):
            require(request.url.scheme=='https' and request.url.host=='hvrqgufqjslvgiohgkvu.supabase.co' and request.url.port in (None,443))
            require(request.url.path in {'/rest/v1/'+v for v in TABLES.values()})
            require(request.method in ('GET','POST','PATCH','DELETE'))
            require('authorization' not in request.headers)
            require(self.calls<64)
            self.calls+=1
            if request.method!='GET':self.writes+=1
            return self.inner.handle_request(request)
        def close(self):self.inner.close()
    return Guard()


class MappedClient:
    def __init__(self,client):self.client=client
    def table(self,name):
        require(name in TABLES)
        return self.client.table(TABLES[name])


class DirectFixtureRequests:
    """Only booking GET/PATCH reaches fixtures; Edge post is a local stub."""
    def __init__(self,http,key,mapped):self.http=http;self.key=key;self.mapped=mapped;self.edge_calls=0
    def _request(self,method,url,**kwargs):
        require(url==URL+'/rest/v1/orders')
        require(kwargs.pop('headers')==rest_headers(self.key))
        params=kwargs.get('params',{})
        require(params.get('id') in ('eq.'+ORDER,'eq.'+DECLINED))
        return self.http.request(method,URL+'/rest/v1/'+TABLES['orders'],headers=rest_headers(self.key),**kwargs)
    def get(self,url,**kwargs):return self._request('GET',url,**kwargs)
    def patch(self,url,**kwargs):return self._request('PATCH',url,**kwargs)
    def post(self,url,**kwargs):
        require(url=='https://blocked.invalid/edge-action')
        require(kwargs['headers'].get('x-admin-secret')=='synthetic-admin-only')
        require(kwargs['json']==dict(action='complete',orderId=ORDER))
        self.edge_calls+=1;require(self.edge_calls==1)
        self.mapped.table('orders').update(dict(status='completed')).eq('id',ORDER).execute()
        return SimpleNamespace(ok=True,status_code=200,json=lambda:dict(ok=True))


def exercise(client,key,guard):
    mapped=MappedClient(client)
    direct=DirectFixtureRequests(client.options.httpx_client,key,mapped)
    app_module=runpy.run_path(str(FIXTURE),run_name='isolated_backend_trial')
    g=app_module['find_order'].__globals__
    g.update(supabase=mapped,requests=direct,SUPABASE_URL=URL,SUPABASE_SERVICE_ROLE_KEY=key)
    app=app_module['app'].test_client()
    # No cleanup is attempted if a fixture was already occupied at entry.
    for name in TABLES:require(mapped.table(name).select('id').limit(1).execute().data==[])
    try:
        mapped.table('customers').insert(dict(id=CUSTOMER,full_name='SYNTHETIC KEY TRIAL',phone=PHONE,email=EMAIL)).execute()
        for oid in (ORDER,DECLINED):
            mapped.table('orders').insert(dict(id=oid,customer_id=CUSTOMER,created_at='2026-10-23T12:00:00Z',preferred_time='2026-10-23T18:30:00Z',proposed_time='2026-10-23T19:00:00Z',status='proposed',is_test=True,loyalty_points_earned_pending=32)).execute()
        denied=app.post('/admin-order-action',json=dict(action='complete',orderId=ORDER))
        require(denied.status_code==401 and direct.edge_calls==0)
        require(app.get('/orders/'+ORDER+'/time/accept?token=synthetic').status_code==200)
        accepted=mapped.table('orders').select('*').eq('id',ORDER).execute().data[0]
        require(accepted['status']=='customer_accepted_time')
        require(accepted['confirmed_time']==accepted['proposed_time'])
        require(accepted['preferred_time']!=accepted['confirmed_time'])
        require(app.get('/orders/'+DECLINED+'/time/decline?token=synthetic').status_code==200)
        require(mapped.table('orders').select('status').eq('id',DECLINED).execute().data[0]['status']=='customer_declined_time')
        incomplete=app.post('/settle-loyalty',json=dict(order_id=ORDER))
        require(incomplete.status_code==400)
        complete=app.post('/admin-order-action',headers={'x-rtk-proxy-secret':'synthetic-proxy-only'},json=dict(action='complete',orderId=ORDER))
        require(complete.status_code==200 and complete.json['loyalty_settlement']['ok'])
        require(direct.edge_calls==1)
        repeated=app.post('/settle-loyalty',json=dict(order_id=ORDER))
        require(repeated.status_code==200 and repeated.json['message']=='Loyalty already settled')
        summary=app.post('/loyalty-balance',json=dict(phone=PHONE))
        require(summary.status_code==200 and summary.json['loyalty']['points_balance']==32)
        require(summary.json['loyalty']['lifetime_points']==32)
        awarded=g['award_loyalty_points'](PHONE,EMAIL,food_total=100.75)
        require(awarded['points_earned']==100 and awarded['new_balance']==132)
        redeemed=g['apply_loyalty_redemption'](PHONE,5)
        require(redeemed['points_deducted']==100 and redeemed['new_balance']==32)
        final=g['build_loyalty_summary'](PHONE)
        require(final['points_balance']==32 and final['lifetime_points']==132)
        settled=mapped.table('orders').select('loyalty_settled').eq('id',ORDER).execute().data[0]
        require(settled['loyalty_settled'] is True)
    finally:
        # These tables contain only this trial's constrained synthetic records.
        for oid in (ORDER,DECLINED):mapped.table('orders').delete().eq('id',oid).execute()
        mapped.table('loyalty_accounts').delete().eq('customer_phone',PHONE).execute()
        mapped.table('customers').delete().eq('id',CUSTOMER).execute()
    for name in TABLES:require(mapped.table(name).select('id').limit(1).execute().data==[])
    return dict(status='PASSED',source='STAGING_FIXTURES_ONLY',requests=guard.calls,
                fixtureWrites=guard.writes,fixtureRowsRemaining=0,notifications=0,
                edgeBoundary='LOCAL_STUB',productionWrites=0,
                concurrentSettlementVerified=False,fullProductionSchemaVerified=False)


def main():
    try:
        key=configuration(os.environ)
        if key is None:result=dict(status='DISABLED',requests=0)
        elif MARKER.exists():result=dict(status='ALREADY_ATTEMPTED',requests=0)
        else:
            require(MARKER.parent.is_dir() and not MARKER.parent.is_symlink())
            with MARKER.open('x') as marker:marker.write('bounded-backend-key-trial-v1\n');marker.flush();os.fsync(marker.fileno())
            guard=transport();client=None
            # Suppress the legacy handlers' verbose payload/error logging.
            with contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()):
                try:
                    client=create_backend_client(URL,key,transport=guard)
                    client.options.httpx_client.timeout=5
                    result=exercise(client,key,guard)
                finally:
                    if client:client.options.httpx_client.close()
                    else:guard.close()
    except Exception:
        print(json.dumps(dict(status='FAILED',reason='TRIAL_DID_NOT_COMPLETE',retryAutomatically=False)),flush=True)
        return 1
    result['buildSha']=os.environ.get('RAILWAY_GIT_COMMIT_SHA','UNAVAILABLE')
    print(json.dumps(result,sort_keys=True),flush=True)
    return 0


if __name__=='__main__':raise SystemExit(main())
