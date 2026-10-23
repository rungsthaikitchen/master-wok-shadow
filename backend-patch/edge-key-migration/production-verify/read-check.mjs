// Temporary, capability-protected credential read check. Not a business endpoint.
import { edgeDatabaseClient } from '../edge-credentials.mjs';

export function productionReadCheck({ createClient, getEnv, transport, tokenHash, expiresAt, now = () => Date.now() }) {
  const origin = 'https://ubyjrrsvbbqomitpaidb.supabase.co';
  let attempted = false;
  return async (req) => {
    const disabled = () => Response.json({ status: 'DISABLED', requests: 0 }, { status: 503 });
    if (req.method !== 'POST' || !Number.isFinite(Date.parse(expiresAt)) || now() >= Date.parse(expiresAt)) return disabled();
    const token = req.headers.get('x-rehearsal-token') ?? '';
    if (token.length < 32 || token.length > 128) return disabled();
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    const hash = [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, '0')).join('');
    if (hash !== tokenHash || attempted) return disabled();
    attempted = true;
    let requests = 0;
    let phase = 'CONFIGURATION';
    try {
      if (getEnv('SUPABASE_URL') !== origin || getEnv('RTK_EDGE_SECRET_KEY_ENABLED') !== 'true') throw new Error('SOURCE_OR_FLAG_REFUSED');
      if (Number(req.headers.get('content-length') ?? 0) > 16) throw new Error('BODY_REFUSED');
      const raw = await req.text();
      if (raw.length > 16) throw new Error('BODY_REFUSED');
      const body = JSON.parse(raw);
      if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).length !== 0) throw new Error('BODY_REFUSED');
      const boundedRead = async (input, init) => {
        const request = new Request(input, init);
        const url = new URL(request.url);
        if (requests !== 0 || request.method !== 'GET' || url.origin !== origin ||
            url.pathname !== '/rest/v1/orders' || url.searchParams.get('select') !== 'id' ||
            url.searchParams.get('limit') !== '0' || [...url.searchParams.keys()].some(k => !['select', 'limit'].includes(k)) ||
            request.headers.has('authorization')) throw new Error('REQUEST_REFUSED');
        requests++;
        return transport(new Request(request, { redirect: 'error', signal: AbortSignal.timeout(8000) }));
      };
      // Read the actual project flag/key map. Never override the flag or read a legacy credential.
      phase = 'CLIENT';
      const client = edgeDatabaseClient(createClient, origin, undefined, undefined, getEnv, boundedRead);
      phase = 'READ';
      const result = await client.from('orders').select('id').limit(0);
      if (result.error || !Array.isArray(result.data) || result.data.length !== 0 || requests !== 1) throw new Error('READ_FAILED');
      return Response.json({ status: 'PASSED', source: 'PRODUCTION_ZERO_ROW_READ', mode: 'NEW_SECRET',
        flagEnabled: true, requests, customerRows: 0, writes: 0, notifications: 0, providerCalls: 0 });
    } catch {
      return Response.json({ status: 'FAILED', phase, requests, writes: 0, notifications: 0, providerCalls: 0 }, { status: 500 });
    }
  };
}
