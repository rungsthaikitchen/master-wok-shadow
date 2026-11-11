"""Exercise the deployed source-bound staging writer, with fixed synthetic baskets.

No production URLs, control changes, provider dispatch or destructive cleanup.
A private checkpoint retains uncertain request keys; the committed report omits
bearer tokens and all credentials. Run only after the fixture dates are empty.
"""
import concurrent.futures
import json
from pathlib import Path
import uuid
import requests

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT.parent / 'master-wok-review-runtime-private.json'
PRIVATE = ROOT.parent / 'reviewed-checkout-hosted-checkpoint-private.json'
REPORT = ROOT / 'STAGING-REVIEW-DELIVERY-CONCURRENCY-RESULT.json'
URL = 'https://hvrqgufqjslvgiohgkvu.supabase.co/functions/v1/master-wok-booking'
PREFIX = 'release-nov6-delivery-review-20261111-' + uuid.uuid4().hex[:8] + '-'
ITEMS = [{'item_id': 'pad-thai', 'qty': 11, 'modifiers': [{'id': 'prawn'}], 'spice': None}]
ADDRESS = 'Morley Town Hall, Queen Street, Morley, Leeds LS27 9DY, UK'


def main():
    config = json.loads(CONFIG.read_text())
    proof = {'status': 'RUNNING', 'scope': 'DEPLOYED_STAGING_REVIEWED_CHECKOUT',
             'edgeVersion': 58, 'sourceSha256': '56a47189fd294172aac671b77a65dff12ef78aa5ceca46416b40f4e0e396c80d',
             'prefix': PREFIX, 'productionMutations': 0, 'providerDispatchCalls': 0, 'checks': [], 'bookings': []}
    checkpoint = {'requests': [], 'approvals': []}

    def save():
        PRIVATE.write_text(json.dumps(checkpoint, indent=2))
        PRIVATE.chmod(0o600)
        REPORT.write_text(json.dumps(proof, indent=2) + '\n')

    def call(operation, payload):
        r = requests.post(URL, json={'operation': operation, 'payload': payload},
                          headers={'x-master-wok-secret': config['MASTER_WOK_BOOKING_SECRET']},
                          timeout=50, allow_redirects=False)
        return r.status_code, r.json()

    def check(condition, name):
        if not condition:
            raise AssertionError(name)
        proof['checks'].append(name)
        save()
        print(name, flush=True)

    def reviewed(name, date, phone, order_type='collection', hold=50):
        customer = {'name': 'Synthetic reviewed ' + name, 'phone': phone,
                    'email': PREFIX + name + '@example.invalid',
                    'address': ADDRESS if order_type == 'delivery' else ''}
        review = {'requestKey': str(uuid.uuid4()), 'customer': customer, 'items': ITEMS,
                  'orderType': order_type, 'preferredTime': date + 'T20:15:00Z',
                  'deliveryAddress': customer['address']}
        code, body = call('basket_review', review)
        check(code == 200 and body.get('success') is True, name + '_REVIEW_SAVED')
        review_id = body['reviewId']
        approval = {'action': 'approve_agreed_time', 'reviewId': review_id, 'expectedStatus': 'pending',
                    'agreedTime': review['preferredTime'], 'maxHoldMinutes': hold,
                    'reason': 'Synthetic staging phone discussion: agreed specific basket, time and longer holding. No real customer.',
                    'staffActor': 'synthetic-staging-operator@example.invalid', 'customerDiscussed': True}
        code, body = call('basket_review_admin', approval)
        check(code == 200 and body.get('success') is True and body.get('reservesCapacity') is False,
              name + '_SCOPED_APPROVAL_CREATED')
        token = body['token']
        checkpoint['approvals'].append({'reviewId': review_id, 'token': token})
        request = {'key': PREFIX + name, 'customer': customer, 'orderType': order_type,
                   'preferredTime': review['preferredTime'], 'items': ITEMS,
                   'communicationPreference': 'email', 'reviewApprovalToken': token,
                   'reviewHoldingAcknowledged': True,
                   'expectedTotals': {'subtotal': 110, 'total': 110, 'delivery_fee': 0, 'discount': 0, 'loyalty_discount': 0}}
        checkpoint['requests'].append(request)
        save()
        return review_id, request, approval

    try:
        check(call('mode', {}) == (200, {'mode': 'MASTER_WOK'}), 'STAGING_MASTER_WOK_MODE')
        review_id, delivery, _ = reviewed('delivery', '2026-12-02', '07700900870', 'delivery', 60)
        for name, change in [('NO_ACK', {'reviewHoldingAcknowledged': False}),
                             ('CHANGED_TIME', {'preferredTime': '2026-12-02T20:20:00Z'}),
                             ('CHANGED_BASKET', {'items': [{**ITEMS[0], 'qty': 10}]}),
                             ('CHANGED_ADDRESS', {'customer': {**delivery['customer'], 'address': 'Different destination'}})]:
            code, body = call('checkout', {**delivery, 'key': PREFIX + name, **change})
            check(code == 409 and not body.get('success'), 'DELIVERY_' + name + '_REFUSED')
        code, body = call('checkout', delivery)
        check(code == 200 and body.get('committed') is True, 'DELIVERY_EXCEPTION_BOOKED')
        order_id = body['orderId']
        proof['bookings'].append({'case': 'delivery', 'orderId': order_id, 'orderRef': body['orderRef'], 'reviewId': review_id})
        code, replay = call('checkout', delivery)
        check(code == 200 and replay.get('orderId') == order_id and replay.get('replayed') is True,
              'DELIVERY_SAME_KEY_REPLAY_ONE_ORDER')
        code, used = call('checkout', {**delivery, 'key': PREFIX + 'spent-token'})
        check(code == 409 and not used.get('success'), 'CONSUMED_TOKEN_NEW_KEY_REFUSED')
        code, accepted = call('admin_action', {'action': 'accept', 'orderId': order_id})
        check(code == 200 and accepted.get('success') is True, 'DELIVERY_NORMAL_ADMIN_ACCEPT')

        normal = {'key': PREFIX + 'ordinary', 'orderType': 'collection', 'preferredTime': '2026-12-02T20:45:00Z',
                  'customer': {'name': 'Synthetic ordinary after exception', 'phone': '07700900873',
                               'email': PREFIX + 'ordinary@example.invalid', 'address': ''},
                  'items': [{'item_id': 'green-curry', 'qty': 1, 'modifiers': [{'id': 'chicken'}], 'spice': 2}],
                  'communicationPreference': 'email',
                  'expectedTotals': {'subtotal': 9, 'total': 9, 'delivery_fee': 0, 'discount': 0, 'loyalty_discount': 0}}
        checkpoint['requests'].append(normal); save()
        code, body = call('checkout', normal)
        check(code == 200 and body.get('committed') is True, 'ORDINARY_ORDER_AFTER_DELIVERY_EXCEPTION_BOOKED')
        proof['bookings'].append({'case': 'ordinary', 'orderId': body['orderId'], 'orderRef': body['orderRef']})

        review_id, first, _ = reviewed('distinct-race', '2026-12-03', '07700900871')
        second = {**first, 'key': PREFIX + 'distinct-race-b'}
        checkpoint['requests'].append(second); save()
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            replies = list(executor.map(lambda request: call('checkout', request), [first, second]))
        winners = [body for code, body in replies if code == 200 and body.get('committed') is True]
        losers = [(code, body) for code, body in replies if code != 200]
        check(len(winners) == 1 and len(losers) == 1 and losers[0][0] == 409,
              'DISTINCT_KEYS_COMPETING_FOR_ONE_GRANT_ONE_COMMIT_ONE_REFUSAL')
        proof['bookings'].append({'case': 'distinct-race', 'orderId': winners[0]['orderId'],
                                  'orderRef': winners[0]['orderRef'], 'reviewId': review_id})
        proof['distinctRaceHttp'] = [code for code, _ in replies]

        review_id, same, _ = reviewed('same-race', '2026-12-04', '07700900872')
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            replies = list(executor.map(lambda _: call('checkout', same), range(2)))
        check(all(code == 200 and body.get('success') is True for code, body in replies)
              and sum(body.get('committed') is True for _, body in replies) == 1
              and len({body['orderId'] for _, body in replies}) == 1,
              'SAME_KEY_CONCURRENT_RETRY_ONE_COMMIT_ONE_REPLAY')
        proof['bookings'].append({'case': 'same-race', 'orderId': replies[0][1]['orderId'],
                                  'orderRef': replies[0][1]['orderRef'], 'reviewId': review_id})

        review_id, revoked, approval = reviewed('renew-revoke', '2026-12-05', '07700900874')
        code, replacement = call('basket_review_admin', {**approval, 'expectedStatus': 'approved',
                           'reason': 'Synthetic staging renewed discussion: revoke the previous checkout capability.'})
        check(code == 200 and replacement.get('success') is True, 'REPLACEMENT_APPROVAL_CREATED')
        check(call('basket_review', {'action': 'approval_lookup', 'token': revoked['reviewApprovalToken']})[0] == 409,
              'REPLACED_CAPABILITY_REJECTED')
        code, closed = call('basket_review_admin', {'action': 'set_status', 'reviewId': review_id,
                                                  'expectedStatus': 'approved', 'status': 'closed'})
        check(code == 200 and closed.get('success') is True, 'UNUSED_RENEWAL_REVIEW_CLOSED')
        check(call('basket_review', {'action': 'approval_lookup', 'token': replacement['token']})[0] == 409,
              'CLOSED_REVIEW_CAPABILITY_REJECTED')
        check(call('mode', {}) == (200, {'mode': 'MASTER_WOK'}), 'STAGING_MODE_UNCHANGED')
        proof['status'] = 'PASS_HTTP_CHECKS_SQL_RECONCILIATION_PENDING'
        save()
        print(json.dumps({'status': proof['status'], 'bookings': proof['bookings'], 'checkCount': len(proof['checks'])}), flush=True)
    except Exception as error:
        proof['status'] = 'UNVERIFIED'
        proof['failure'] = str(error) if isinstance(error, AssertionError) else type(error).__name__
        save()
        print(json.dumps({'status': proof['status'], 'failure': proof['failure']}), flush=True)
        raise SystemExit(1)


if __name__ == '__main__':
    main()
