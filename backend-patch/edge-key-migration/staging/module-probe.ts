// Rehearsal-only bootstrap: serve imports are mapped to a registration shim.
// Candidate business handlers are loaded but never execute here.
import { handlers } from './serve-shim.ts';

export function moduleProbe({ tokenHash, expiresAt }) {
  let attempted = false;
  return async (req: Request) => {
    const disabled = () => Response.json({ status: 'DISABLED', requests: 0 }, { status: 503 });
    if (req.method !== 'POST' || !Number.isFinite(Date.parse(expiresAt)) || Date.now() >= Date.parse(expiresAt)) return disabled();
    const token = req.headers.get('x-rehearsal-token') ?? '';
    if (token.length < 32 || token.length > 128) return disabled();
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    const hash = [...new Uint8Array(bytes)].map(v => v.toString(16).padStart(2, '0')).join('');
    if (hash !== tokenHash || attempted) return disabled();
    attempted = true;
    // Any provider/database request during module initialization is forbidden.
    const realFetch = globalThis.fetch;
    let requests = 0;
    globalThis.fetch = async () => { requests++; throw new Error('MODULE_NETWORK_REFUSED'); };
    try {
      if (Deno.env.get('SUPABASE_URL') !== 'https://hvrqgufqjslvgiohgkvu.supabase.co') throw new Error('SOURCE_REFUSED');
      await import('./candidates/review-order/index.ts');
      await import('./candidates/hyper-worker/index.ts');
      await import('./candidates/geocode-order/index.ts');
      if (handlers.length !== 3 || requests !== 0) throw new Error('MODULE_LOAD_FAILED');
      return Response.json({ status: 'PASSED', source: 'STAGING_ONLY', loadedModules: 3,
        businessHandlersExecuted: 0, requests: 0, writes: 0, notifications: 0, providerCalls: 0 });
    } catch {
      return Response.json({ status: 'FAILED', source: 'STAGING_ONLY', requests, writes: 0, notifications: 0, providerCalls: 0 }, { status: 500 });
    } finally { globalThis.fetch = realFetch; }
  };
}
