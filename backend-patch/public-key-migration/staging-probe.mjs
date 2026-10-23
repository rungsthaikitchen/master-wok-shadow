// Capability-protected staging-only public-key admission test. No outbound calls.
import { publicAccess } from './public-access.mjs';
export function publicKeyProbe({ getEnv, tokenHash, expiresAt, legacyPublicKeyHash, now = () => Date.now() }) {
  let attempts = 0;
  return async req => {
    const disabled = () => Response.json({ status: 'DISABLED', requests: 0 }, { status: 503 });
    if (req.method !== 'POST' || !Number.isFinite(Date.parse(expiresAt)) || now() >= Date.parse(expiresAt)) return disabled();
    const token = req.headers.get('x-rehearsal-token') ?? '';
    if (token.length < 32 || token.length > 128) return disabled();
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    const hash = [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, '0')).join('');
    if (hash !== tokenHash || attempts >= 8) return disabled();
    attempts++;
    try {
      if (getEnv('SUPABASE_URL') !== 'https://hvrqgufqjslvgiohgkvu.supabase.co') throw new Error('SOURCE_REFUSED');
      if (Number(req.headers.get('content-length') ?? 0) > 64) throw new Error('BODY_REFUSED');
      const text = await req.text();
      if (text.length > 64) throw new Error('BODY_REFUSED');
      const body = JSON.parse(text);
      if (!body || Object.keys(body).length !== 1 || !['legacy', 'dual', 'publishable'].includes(body.mode)) throw new Error('MODE_REFUSED');
      const denied = await publicAccess(req, n => n === 'RTK_EDGE_PUBLIC_KEY_MODE' ? body.mode : getEnv(n), {}, legacyPublicKeyHash);
      const legacy = getEnv('SUPABASE_ANON_KEY') ?? '';
      const supplied = req.headers.get('apikey') ?? '';
      return Response.json({ status: denied ? 'DENIED' : 'ALLOWED', mode: body.mode,
        diagnostic: { legacyEnvIsJwt: legacy.startsWith('eyJ'), legacyEnvIsPublishable: legacy.startsWith('sb_publishable_'),
          requestKeyIsJwt: supplied.startsWith('eyJ'), requestKeyIsPublishable: supplied.startsWith('sb_publishable_'),
          legacyMatchesRequestKey: legacy === supplied },
        databaseRequests: 0, writes: 0, providerCalls: 0, notifications: 0 }, { status: denied ? denied.status : 200 });
    } catch {
      return Response.json({ status: 'FAILED', databaseRequests: 0, writes: 0, providerCalls: 0, notifications: 0 }, { status: 500 });
    }
  };
}
