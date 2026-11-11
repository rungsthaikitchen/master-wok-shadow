"""Synthetic staging review test, using the existing HTTP/store implementation.

Fixed staging host, synthetic contacts, no booking submission or provider calls.
Saved requests are closed after testing and retained as staging evidence.
"""
import concurrent.futures
import json
from pathlib import Path
import subprocess
import uuid
import requests

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT.parent / 'master-wok-review-runtime-private.json'
URL = 'https://hvrqgufqjslvgiohgkvu.supabase.co/functions/v1/master-wok-booking'


def main():
    config = json.loads(CONFIG.read_text())
    secret = config['MASTER_WOK_BOOKING_SECRET']
    fixtures = json.loads(subprocess.check_output(
        ['node', '-e', "process.stdout.write(JSON.stringify(require('./staging-tests/large-basket-examples')))"], cwd=ROOT))

    def call(operation, payload):
        response = requests.post(URL, json={'operation': operation, 'payload': payload},
                                 headers={'x-master-wok-secret': secret}, timeout=35, allow_redirects=False)
        return response.status_code, response.json()

    assert call('mode', {}) == (200, {'mode': 'LEGACY'})
    saved = []
    try:
        for name, items in fixtures.items():
            payload = {'requestKey': str(uuid.uuid4()), 'orderType': 'collection',
                       'customer': {'name': 'Synthetic basket review ' + name, 'phone': '07000000000'},
                       'preferredTime': '2026-11-12T20:15:00Z', 'items': items,
                       'assessment': {'message': 'UNTRUSTED CLIENT DIAGNOSTIC'}}
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
                replies = list(executor.map(lambda _: call('basket_review', payload), range(2)))
            for status, body in replies:
                assert status == 200 and body.get('success') is True, (name, status, body.get('reason', body.get('error')))
                assert body.get('bookingApprovalAllowed') is False
                if body['reviewId'] not in saved:
                    saved.append(body['reviewId'])
            assert replies[0][1]['reviewId'] == replies[1][1]['reviewId'], 'Concurrent retry duplicated review'
            code, body = call('basket_review', {**payload, 'customer': {'name': 'Changed details', 'phone': '07000000000'}})
            assert code == 409 and body.get('reason') == 'REVIEW_REQUEST_KEY_CONFLICT'

        code, listing = call('basket_review_admin', {'action': 'list'})
        assert code == 200
        rows = {row['id']: row for row in listing['reviews'] if row['id'] in saved}
        assert len(rows) == 4
        for row in rows.values():
            assert sum(line['unit_price'] * line['qty'] for line in row['basket']) == 150
            assert 'UNTRUSTED CLIENT DIAGNOSTIC' not in json.dumps(row['assessment'])

        target = saved[0]
        action = {'action': 'set_status', 'reviewId': target, 'status': 'contacted', 'expectedStatus': 'pending'}
        assert call('basket_review_admin', action)[0] == 200
        assert call('basket_review_admin', action)[0] == 409
        report = {'result': 'PASS', 'scope': 'HOSTED_STAGING_WRITER', 'basketExamples': 4,
                  'simultaneousIdenticalRequestsPerBasket': 2, 'uniqueReviews': len(saved),
                  'changedRequestConflict': True, 'staleAdminStatusConflict': True,
                  'serverPricedBasketValues': [150] * 4, 'mode': 'LEGACY',
                  'bookingSubmissions': 0, 'reviewIds': saved}
    finally:
        for review_id in saved:
            code, listing = call('basket_review_admin', {'action': 'list'})
            assert code == 200
            row = next((row for row in listing['reviews'] if row['id'] == review_id), None)
            if row:
                assert call('basket_review_admin', {'action': 'set_status', 'reviewId': review_id,
                           'status': 'closed', 'expectedStatus': row['status']})[0] == 200
    print(json.dumps(report), flush=True)


if __name__ == '__main__':
    main()
