"""Prepared read-only delivery evidence source. Not installed in either observer."""
import hashlib
import hmac
from shadow_collector import ManagementReadOnlySource, ShadowError, day_bounds, normalize, digest, timestamp

PROJECTS = {'hvrqgufqjslvgiohgkvu', 'ubyjrrsvbbqomitpaidb'}
# No addresses, coordinate values, customer details, notes or route provider calls.
QUERY = """WITH selected_orders AS (
 SELECT id,created_at,preferred_time,proposed_time,confirmed_time,status,is_test,order_type,
 CASE WHEN delivery_fee=0 THEN 'FREE' WHEN delivery_fee>0 THEN 'PAID' ELSE 'UNKNOWN' END AS delivery_fee_band,
 (customer_lat IS NOT NULL AND customer_lng IS NOT NULL
 AND customer_lat BETWEEN -90 AND 90 AND customer_lng BETWEEN -180 AND 180) AS has_coordinates
 FROM public.orders WHERE is_test=false AND (
 (preferred_time >= $1::timestamptz AND preferred_time < $2::timestamptz) OR
 (proposed_time >= $1::timestamptz AND proposed_time < $2::timestamptz) OR
 (confirmed_time >= $1::timestamptz AND confirmed_time < $2::timestamptz))
 ORDER BY id LIMIT $3
), selected_items AS (
 SELECT i.id,i.order_id,i.item_id,i.qty,i.modifiers FROM public.order_items i
 JOIN selected_orders o ON o.id=i.order_id ORDER BY i.id LIMIT $4
) SELECT current_user AS source_role, transaction_timestamp() AS observed_at,
 (SELECT coalesce(jsonb_agg(o ORDER BY o.id),'[]'::jsonb) FROM selected_orders o) AS orders,
 (SELECT coalesce(jsonb_agg(i ORDER BY i.id),'[]'::jsonb) FROM selected_items i) AS items"""


def prepare_snapshot(raw, service_date, project_ref, secret):
    day_bounds(service_date)
    if project_ref not in PROJECTS or not isinstance(secret, str) or len(secret) < 32:
        raise ShadowError('DELIVERY_SOURCE_CONFIGURATION_REQUIRED')
    if (not isinstance(raw, list) or len(raw) != 1 or not isinstance(raw[0], dict) or
        raw[0].get('source_role') != 'supabase_read_only_user'):
        raise ShadowError('SOURCE_READ_ONLY_ROLE_UNPROVEN')
    source = raw[0]
    for name, limit in [('orders', 500), ('items', 5000)]:
        rows = source.get(name)
        if (not isinstance(rows, list) or len(rows) > limit or
            any(not isinstance(r, dict) or not isinstance(r.get('id'), str) for r in rows) or
            len({r['id'] for r in rows}) != len(rows)):
            raise ShadowError('DELIVERY_SOURCE_LIMIT_OR_DUPLICATE')
    required = {'id','created_at','preferred_time','proposed_time','confirmed_time','status','is_test',
                'order_type','delivery_fee_band','has_coordinates'}
    for row in source['orders']:
        if not required.issubset(row):
            raise ShadowError('DELIVERY_SOURCE_FIELDS_MISSING')
        # A corrupt selected field must not turn into a preferred-time fallback.
        for field in ('preferred_time','proposed_time','confirmed_time'):
            if row[field] is not None:
                timestamp(row[field])
    observed_at = timestamp(source.get('observed_at')).isoformat()
    # Separate identity namespace from the existing kitchen collector.
    alias_secret = hmac.new(secret.encode(), b'master-wok-delivery-source-v1', hashlib.sha256).hexdigest()
    rows = normalize(source, alias_secret)
    by_alias = {hmac.new(alias_secret.encode(), r['id'].encode(), hashlib.sha256).hexdigest():r for r in source['orders']}
    for row in rows:
        original = by_alias[row['orderId']]
        if timestamp(row['createdAt']) > timestamp(observed_at):
            raise ShadowError('FUTURE_ORDER_PLACEMENT')
        row['orderType'] = original.get('order_type') if original.get('order_type') in ('collection','delivery') else 'UNKNOWN'
        row['deliveryFeeBand'] = original.get('delivery_fee_band') if original.get('delivery_fee_band') in ('FREE','PAID') else 'UNKNOWN'
        row['coordinateEvidence'] = 'PRESENT' if original.get('has_coordinates') is True else 'MISSING_OR_INVALID'
    state = {'serviceDate':service_date, 'projectRef':project_ref, 'orders':rows}
    return {**state, 'schemaVersion':1, 'basis':'ATOMIC_SAVED_ORDER_STATE',
            'sourceEvidence':'CURRENT_SAVED_STATE_NOT_DECISION_HISTORY', 'sourceRole':'supabase_read_only_user',
            'completeForServiceDate':True, 'observedAt':observed_at, 'snapshotHash':digest(state),
            'sourceIdentity':digest({'project':project_ref,'namespace':alias_secret}),
            'orderCount':len(rows), 'itemCount':len(source['items'])}


def read_delivery_snapshot(url=None, token=None, secret=None, service_date=None, *, enabled=False, transport=None):
    # No runtime environment or daemon is connected. Callers must opt in explicitly.
    if enabled is not True:
        return {'status':'DISABLED','verified':False}
    if url not in {'https://' + p + '.supabase.co' for p in PROJECTS}:
        raise ShadowError('DELIVERY_SOURCE_PROJECT_REFUSED')
    project = url.split('//')[1].split('.')[0]
    start, end = day_bounds(service_date)
    if not isinstance(secret, str) or len(secret) < 32:
        raise ShadowError('PSEUDONYM_KEY_REQUIRED')
    reader = ManagementReadOnlySource(url, token, transport=transport)
    raw = reader.transport({'query':QUERY,'parameters':[start,end,501,5001]})
    return prepare_snapshot(raw, service_date, project, secret)
