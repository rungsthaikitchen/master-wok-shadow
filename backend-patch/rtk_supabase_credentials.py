"""Candidate backend credential migration; not imported by the shadow runtime.

Keep secrets in the service environment. Never pass a new secret as a JWT.
"""
import re
from urllib.parse import urlsplit


def backend_key(environ):
    if 'SUPABASE_SECRET_KEY' in environ:
        key = environ['SUPABASE_SECRET_KEY']
        if not isinstance(key, str) or not re.fullmatch(r'sb_secret_[A-Za-z0-9_-]+', key):
            raise ValueError('SUPABASE_SECRET_KEY_INVALID')
        return key
    return environ.get('SUPABASE_SERVICE_ROLE_KEY')


def rest_headers(key):
    headers = {'apikey': key, 'Content-Type': 'application/json'}
    if not key.startswith('sb_secret_'):
        headers['Authorization'] = 'Bearer ' + key
    return headers


def create_backend_client(url, key, *, transport=None):
    from supabase import create_client
    if not key.startswith('sb_secret_'):
        if transport is not None:
            raise ValueError('LEGACY_TEST_TRANSPORT_UNSUPPORTED')
        return create_client(url, key)

    import httpx
    from supabase import ClientOptions
    target = urlsplit(url)
    if target.scheme != 'https' or not target.hostname or target.username or target.password:
        raise ValueError('SUPABASE_URL_INVALID')

    def prepare(request):
        # SDK 2.33.0 puts the API key in Authorization by default. Use its public
        # custom HTTP client option to normalize the actual outgoing request.
        if (request.url.scheme, request.url.host, request.url.port or 443) != (
                target.scheme, target.hostname, target.port or 443):
            raise ValueError('SUPABASE_REQUEST_ORIGIN_REFUSED')
        if request.headers.get('authorization') == 'Bearer ' + key:
            del request.headers['authorization']

    options = ClientOptions(auto_refresh_token=False, persist_session=False)
    http = httpx.Client(transport=transport, follow_redirects=False,
                        timeout=options.postgrest_client_timeout,
                        event_hooks={'request': [prepare]})
    options.httpx_client = http
    try:
        return create_client(url, key, options=options)
    except Exception:
        http.close()
        raise
