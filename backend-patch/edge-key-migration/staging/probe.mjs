// Isolated staging diagnostic, not a production endpoint or booking handler.
import { edgeDatabaseClient } from '../edge-credentials.mjs';

export function rehearsalHandler({ createClient, getEnv, transport, tokenHash, expiresAt, now = () => Date.now() }) {
  const origin = 'https://hvrqgufqjslvgiohgkvu.supabase.co';
  let attempts = 0;
  return async (req) => {
    const disabled = () => Response.json({ status: 'DISABLED', requests: 0 }, { status: 503 });
    if (req.method !== 'POST' || !Number.isFinite(Date.parse(expiresAt)) || now() >= Date.parse(expiresAt)) return disabled();
    const token = req.headers.get('x-rehearsal-token') ?? '';
    if (token.length < 32 || token.length > 128) return disabled();
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    const hash = [...new Uint8Array(bytes)].map(v => v.toString(16).padStart(2, '0')).join('');
    if (hash !== tokenHash || attempts >= 2) return disabled();
    // Consume attempt before creating clients or sending requests, including failed runs.
    attempts++;
    let requests = 0;
    try {
      if (getEnv('SUPABASE_URL') !== origin) throw new Error('SOURCE_REFUSED');
      const length = Number(req.headers.get('content-length') ?? 0);
      if (length > 64) throw new Error('BODY_REFUSED');
      const body = await req.text();
      if (body.length > 64) throw new Error('BODY_REFUSED');
      const payload = JSON.parse(body);
      if (!payload || Object.keys(payload).length !== 1 || !['legacy', 'new'].includes(payload.mode)) throw new Error('MODE_REFUSED');
      const mode = payload.mode;
      const boundedRead = async (input, init) => {
        const request = new Request(input, init);
        const url = new URL(request.url);
        if (requests >= 1 || request.method !== 'GET' || url.origin !== origin ||
            url.pathname !== '/rest/v1/orders' || url.searchParams.get('select') !== 'id' ||
            url.searchParams.get('limit') !== '0' || [...url.searchParams.keys()].some(k => !['select', 'limit'].includes(k))) {
          throw new Error('REQUEST_REFUSED');
        }
        if (mode === 'new' && request.headers.has('authorization')) throw new Error('AUTH_HEADER_REFUSED');
        requests++;
        return transport(new Request(request, { redirect: 'error', signal: AbortSignal.timeout(8000) }));
      };
      const client = edgeDatabaseClient(createClient, origin, getEnv('SUPABASE_SERVICE_ROLE_KEY'), {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { fetch: boundedRead },
      }, name => name === 'RTK_EDGE_SECRET_KEY_ENABLED' ? (mode === 'new' ? 'true' : 'false') : getEnv(name), boundedRead);
      const result = await client.from('orders').select('id').limit(0);
      if (result.error || !Array.isArray(result.data) || result.data.length !== 0 || requests !== 1) throw new Error('READ_FAILED');
      return Response.json({ status: 'PASSED', source: 'STAGING_ONLY', mode, requests,
        customerRows: 0, writes: 0, notifications: 0, providerCalls: 0 });
    } catch {
      return Response.json({ status: 'FAILED', source: 'STAGING_ONLY', requests,
        writes: 0, notifications: 0, providerCalls: 0 }, { status: 500 });
    }
  };
}
