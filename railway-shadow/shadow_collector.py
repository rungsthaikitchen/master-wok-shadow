"""Independent GET-only Supabase state sampler. Disabled unless explicitly enabled.
No imports of server.py/notifications.py, no booking or notification code.
"""
from __future__ import annotations
import argparse
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import time
from datetime import date, datetime, timedelta, timezone
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler
from zoneinfo import ZoneInfo

LONDON = ZoneInfo('Europe/London')
STATUSES = {'pending', 'confirmed', 'accepted', 'proposed', 'customer_accepted_time',
            'customer_declined_time', 'preparing', 'completed', 'cancelled'}
ORDER_FIELDS = 'id,created_at,preferred_time,proposed_time,confirmed_time,status,is_test'
ITEM_FIELDS = 'id,order_id,item_id,qty,modifiers'
STARTUP_PHASE = 'ARGUMENTS'
SAFE_STARTUP_REASONS = {
    'PSEUDONYM_KEY_REQUIRED', 'INVALID_SUPABASE_ORIGIN', 'INVALID_SOURCE_CONFIG',
    'ABSOLUTE_PERSISTENT_DB_PATH_REQUIRED', 'MONITOR_IDENTITY_CHANGED',
    'INVALID_POLL_INTERVAL', 'SERVICE_DATE_LIMIT', 'INVALID_SERVICE_DATE'
}

class ShadowError(Exception):
    pass

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise ShadowError('REDIRECT_REFUSED')

def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)

def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()

def day_bounds(service_date):
    day = date.fromisoformat(service_date)
    if day.isoformat() != service_date:
        raise ShadowError('INVALID_SERVICE_DATE')
    start = datetime.combine(day, datetime.min.time(), LONDON)
    end = datetime.combine(day + timedelta(days=1), datetime.min.time(), LONDON)
    return start.astimezone(timezone.utc).isoformat(), end.astimezone(timezone.utc).isoformat()

def timestamp(value):
    if not isinstance(value, str):
        raise ShadowError('INVALID_TIMESTAMP')
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if result.tzinfo is None:
        raise ShadowError('TIMESTAMP_OFFSET_REQUIRED')
    return result.astimezone(timezone.utc)

class ReadOnlySource:
    """Projection and endpoints are fixed. There is deliberately no write method."""
    def __init__(self, url, key, transport=None, page_size=250, max_rows=5000):
        parsed = urlsplit(url)
        if (parsed.scheme != 'https' or not parsed.hostname or
            not re.fullmatch(r'[a-z0-9-]+\.supabase\.co', parsed.hostname) or
            parsed.username or parsed.password or parsed.port not in (None, 443) or
            parsed.path not in ('', '/') or parsed.query or parsed.fragment):
            raise ShadowError('INVALID_SUPABASE_ORIGIN')
        if not key or not 1 <= page_size <= 500 or max_rows < page_size:
            raise ShadowError('INVALID_SOURCE_CONFIG')
        self.url, self.key = url.rstrip('/'), key
        self.transport = transport or self._get
        self.page_size, self.max_rows = page_size, max_rows

    def _get(self, url, headers):
        # Fixed GET; never follow a redirect with the authentication headers.
        request = Request(url, headers=headers, method='GET')
        with build_opener(NoRedirect).open(request, timeout=10) as response:
            if response.status != 200:
                raise ShadowError('SOURCE_HTTP_ERROR')
            body = response.read(5_000_001)
            if len(body) > 5_000_000:
                raise ShadowError('SOURCE_RESPONSE_TOO_LARGE')
            return json.loads(body), response.headers.get('Content-Range', '')

    def _pages(self, table, params):
        if table not in ('orders', 'order_items'):
            raise ShadowError('SOURCE_TABLE_REFUSED')
        data, seen, expected = [], set(), None
        while True:
            query = {**params, 'order': 'id.asc', 'offset': len(data), 'limit': self.page_size}
            url = self.url + '/rest/v1/' + table + '?' + urlencode(query)
            rows, count_range = self.transport(url, {'apikey': self.key,
                'Authorization': 'Bearer ' + self.key, 'Prefer': 'count=exact'})
            match = re.fullmatch(r'(?:\d+-\d+|\*)/(\d+)', count_range)
