// Outbound database credentials only. This module does not authenticate callers.
export function edgeDatabaseClient(createClient, url, legacyKey, options, getEnv, transport = globalThis.fetch) {
  const enabled = getEnv('RTK_EDGE_SECRET_KEY_ENABLED');
  if (enabled === undefined || enabled === 'false') {
    return options === undefined ? createClient(url, legacyKey) : createClient(url, legacyKey, options);
  }
  if (enabled !== 'true') throw new Error('EDGE_KEY_FLAG_INVALID');
  let keys;
  try { keys = JSON.parse(getEnv('SUPABASE_SECRET_KEYS')); }
  catch { throw new Error('EDGE_SECRET_KEYS_INVALID'); }
  const name = getEnv('RTK_EDGE_SECRET_KEY_NAME') ?? 'default';
  if (!/^[A-Za-z0-9_-]+$/.test(name) || !keys || Array.isArray(keys) ||
      typeof keys !== 'object' || !Object.hasOwn(keys, name) ||
      typeof keys[name] !== 'string' || !/^sb_secret_[A-Za-z0-9_-]+$/.test(keys[name])) {
    throw new Error('EDGE_SECRET_KEY_INVALID');
  }
  const key = keys[name];
  let base;
  try { base = new URL(url); } catch { throw new Error('EDGE_DATABASE_ORIGIN_INVALID'); }
  if (base.protocol !== 'https:' || base.username || base.password ||
      base.pathname !== '/' || base.search || base.hash) throw new Error('EDGE_DATABASE_ORIGIN_INVALID');
  const guardedFetch = async (input, init) => {
    const request = new Request(input, init);
    const target = new URL(request.url);
    if (target.origin !== base.origin || !target.pathname.startsWith('/rest/v1/')) {
      throw new Error('EDGE_DATABASE_DESTINATION_REFUSED');
    }
    const headers = new Headers(request.headers);
    if (headers.has('apikey') && headers.get('apikey') !== key) throw new Error('EDGE_DATABASE_KEY_MISMATCH');
    headers.set('apikey', key);
    if (headers.get('authorization') === `Bearer ${key}`) headers.delete('authorization');
    return transport(new Request(request, { headers, redirect: 'error' }));
  };
  return createClient(url, key, {
    ...options,
    auth: { ...options?.auth, persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { ...options?.global, fetch: guardedFetch },
  });
}
