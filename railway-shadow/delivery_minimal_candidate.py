"""Default-off, fixed read-only query. Returns one private candidate in memory."""
import hashlib
import hmac
import math
from shadow_collector import ManagementReadOnlySource,ShadowError,day_bounds,timestamp,normalize,canonical

PROJECTS={'hvrqgufqjslvgiohgkvu','ubyjrrsvbbqomitpaidb'}
QUERY="""WITH selected_orders AS (
 SELECT id,created_at,preferred_time,proposed_time,confirmed_time,status,is_test,order_type,
 customer_lat,customer_lng FROM public.orders WHERE is_test=false AND (
 (preferred_time >= $1::timestamptz AND preferred_time < $2::timestamptz) OR
 (proposed_time >= $1::timestamptz AND proposed_time < $2::timestamptz) OR
 (confirmed_time >= $1::timestamptz AND confirmed_time < $2::timestamptz))
 ORDER BY created_at,id LIMIT 501
), first_order AS (
 SELECT * FROM selected_orders ORDER BY created_at,id LIMIT 1
), selected_items AS (
 SELECT i.id,i.order_id,i.item_id,i.qty,i.modifiers FROM public.order_items i
 JOIN selected_orders o ON o.id=i.order_id ORDER BY i.id LIMIT 5001
) SELECT current_user AS source_role,
 pg_catalog.current_setting('transaction_read_only') AS read_only,
 pg_catalog.transaction_timestamp() AS observed_at,
 (SELECT count(*) FROM selected_orders) AS order_count,
 (SELECT count(*) FROM selected_items) AS item_count,
 (SELECT count(*) FROM selected_orders o,first_order f WHERE o.created_at<f.created_at) AS earlier_count,
 (SELECT count(*) FROM selected_orders o,first_order f WHERE o.created_at=f.created_at) AS tie_count,
 pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_object(
 'orders',(SELECT pg_catalog.jsonb_agg(o ORDER BY o.id) FROM selected_orders o),
 'items',(SELECT pg_catalog.jsonb_agg(i ORDER BY i.id) FROM selected_items i))::text,'UTF8')),'hex') AS snapshot_hash,
 (SELECT pg_catalog.jsonb_agg(o) FROM first_order o) AS orders,
 (SELECT coalesce(pg_catalog.jsonb_agg(i ORDER BY i.id),'[]'::jsonb) FROM selected_items i
 JOIN first_order o ON o.id=i.order_id) AS items"""

def point(value):
    return (isinstance(value,dict) and set(value)=={'lat','lng'} and
        all(type(value[k]) in (int,float) and math.isfinite(value[k]) for k in value) and
        -90<=value['lat']<=90 and -180<=value['lng']<=180)

def prepare(raw,service_date,project,secret,origin,*,clock):
    day_bounds(service_date)
    if project not in PROJECTS or not isinstance(secret,str) or len(secret)<32:
        raise ShadowError('MINIMAL_SOURCE_CONFIGURATION_REQUIRED')
    if (not isinstance(origin,dict) or set(origin)!={'point','verified','provenance'} or
        origin['verified'] is not True or origin['provenance']!='OWNER_VERIFIED_KITCHEN_ORIGIN' or not point(origin['point'])):
        raise ShadowError('VERIFIED_KITCHEN_ORIGIN_REQUIRED')
    if not isinstance(raw,list) or len(raw)!=1 or not isinstance(raw[0],dict):
        raise ShadowError('ATOMIC_SOURCE_REQUIRED')
    r=raw[0]
    if r.get('source_role')!='supabase_read_only_user' or r.get('read_only')!='on':
        raise ShadowError('SOURCE_READ_ONLY_PROOF_REQUIRED')
    observed=timestamp(r.get('observed_at'))
    if not -5<=clock()-observed.timestamp()<=180:raise ShadowError('SOURCE_CLOCK_UNVERIFIED')
    if type(r.get('order_count')) is int and r['order_count']==0:
        if (type(r.get('item_count')) is int and r['item_count']==0 and
            type(r.get('earlier_count')) is int and r['earlier_count']==0 and
            type(r.get('tie_count')) is int and r['tie_count']==0 and
            r.get('orders') in (None,[]) and r.get('items')==[]):
            return None
        raise ShadowError('EMPTY_SOURCE_COVERAGE_UNVERIFIED')
    if (type(r.get('order_count')) is not int or not 1<=r['order_count']<=500 or
        type(r.get('item_count')) is not int or not 1<=r['item_count']<=5000 or
        type(r.get('earlier_count')) is not int or r['earlier_count']!=0 or
        type(r.get('tie_count')) is not int or r['tie_count']!=1 or
        not isinstance(r.get('snapshot_hash'),str) or len(r['snapshot_hash'])!=64 or
        any(c not in '0123456789abcdef' for c in r['snapshot_hash'])):
        raise ShadowError('SOURCE_COVERAGE_UNVERIFIED')
    orders,items=r.get('orders'),r.get('items')
    if (not isinstance(orders,list) or len(orders)!=1 or not isinstance(orders[0],dict) or
        not isinstance(items,list) or not 1<=len(items)<=100 or len(items)>r['item_count']):
        raise ShadowError('SINGLE_SOURCE_CANDIDATE_REQUIRED')
    order=orders[0]
    if (not isinstance(order.get('id'),str) or not order['id'] or order.get('order_type')!='delivery' or
        order.get('status') not in {'confirmed','completed'} or order.get('is_test') is not False or
        (order.get('proposed_time') is not None and order.get('confirmed_time') is None)):
        raise ShadowError('FIRST_ORDER_COMMITMENT_UNVERIFIED')
    required={'created_at','preferred_time','proposed_time','confirmed_time'}
    if not required.issubset(order):raise ShadowError('SOURCE_TIMESTAMPS_REQUIRED')
    if timestamp(order['created_at'])>observed:raise ShadowError('FUTURE_SOURCE_ORDER')
    ids=set()
    for item in items:
        if (not isinstance(item,dict) or not isinstance(item.get('id'),str) or item['id'] in ids or
            item.get('order_id')!=order['id'] or not isinstance(item.get('modifiers'),list)):
            raise ShadowError('SOURCE_ITEM_MEMBERSHIP_UNVERIFIED')
        ids.add(item['id'])
    customer={'lat':order.get('customer_lat'),'lng':order.get('customer_lng')}
    if not point(customer):raise ShadowError('CUSTOMER_POINT_UNVERIFIED')
    namespace=hmac.new(secret.encode(),('delivery-minimal-v1/'+project).encode(),hashlib.sha256).hexdigest()
    safe=normalize({'orders':orders,'items':items},namespace)[0]
    safe['orderType']='delivery'
    source=dict(serviceDate=service_date,timezone='Europe/London',
        evidenceBasis='CURRENT_SAVED_STATE_NOT_DECISION_HISTORY',completeForServiceDate=False,
        coverageBasis='FIRST_SAVED_ORDER_WITH_PRIOR_COVERAGE',orderCount=1,orders=[safe],
        totalSavedOrderCount=r['order_count'],earlierSavedOrderCount=0,candidateCreationTieCount=1,
        sourceSnapshotHash=r['snapshot_hash'])
    payload=dict(source=source,sourceObservedAt=observed.isoformat(),points={'KITCHEN':dict(origin['point']),'CANDIDATE':customer})
    sealed=canonical(payload)
    return dict(privateJson=sealed,bindingHash=hashlib.sha256(sealed.encode()).hexdigest(),
        sourceIdentity=hashlib.sha256(namespace.encode()).hexdigest(),
        observedStatus=safe['status'],serviceDate=service_date,sourceObservedAt=observed.isoformat())

def read(url=None,token=None,service_date=None,secret=None,origin=None,*,enabled=False,
         approved_project=None,transport=None,clock):
    if enabled is not True:return dict(status='DISABLED',verified=False)
    if approved_project not in PROJECTS or url!='https://'+approved_project+'.supabase.co':
        raise ShadowError('EXACT_APPROVED_SOURCE_REQUIRED')
    # Validate origin before constructing a client or making a source request.
    if (not isinstance(origin,dict) or set(origin)!={'point','verified','provenance'} or
        origin.get('verified') is not True or origin.get('provenance')!='OWNER_VERIFIED_KITCHEN_ORIGIN' or not point(origin.get('point'))):
        raise ShadowError('VERIFIED_KITCHEN_ORIGIN_REQUIRED')
    if not isinstance(secret,str) or len(secret)<32:raise ShadowError('PSEUDONYM_KEY_REQUIRED')
    start,end=day_bounds(service_date)
    reader=ManagementReadOnlySource(url,token,transport=transport)
    raw=reader.transport({'query':QUERY,'parameters':[start,end]})
    return prepare(raw,service_date,approved_project,secret,origin,clock=clock)
