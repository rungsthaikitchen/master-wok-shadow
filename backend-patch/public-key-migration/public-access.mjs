// Public application-key compatibility only; not staff/user authorization.
export async function publicAccess(req, getEnv, corsHeaders, legacyPublicKeyHash) {
  const response = (status, error) => Response.json({ ok: false, error }, { status, headers: corsHeaders });
  const mode = getEnv('RTK_EDGE_PUBLIC_KEY_MODE') ?? 'legacy';
  if (!['legacy', 'dual', 'publishable'].includes(mode)) return response(503, 'Public key configuration unavailable');
  const accepted = [];
  if (mode !== 'publishable') {
    if (!/^[a-f0-9]{64}$/.test(legacyPublicKeyHash ?? '')) return response(503, 'Public key configuration unavailable');
  }
  if (mode !== 'legacy') {
    let keys;
    try { keys = JSON.parse(getEnv('SUPABASE_PUBLISHABLE_KEYS')); }
    catch { return response(503, 'Public key configuration unavailable'); }
    const name = getEnv('RTK_EDGE_PUBLISHABLE_KEY_NAME') ?? 'default';
    if (!/^[A-Za-z0-9_-]+$/.test(name) || !keys || Array.isArray(keys) ||
        !Object.hasOwn(keys, name) || typeof keys[name] !== 'string' ||
        !/^sb_publishable_[A-Za-z0-9_-]+$/.test(keys[name])) return response(503, 'Public key configuration unavailable');
    accepted.push(keys[name]);
  }
  const supplied = req.headers.get('apikey');
  const matchesLegacy = async value => {
    if (mode === 'publishable' || !value || value.length > 4096) return false;
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    const hash = [...new Uint8Array(bytes)].map(v => v.toString(16).padStart(2, '0')).join('');
    return hash === legacyPublicKeyHash;
  };
  if (supplied !== null) return accepted.includes(supplied) || await matchesLegacy(supplied) ? null : response(401, 'Unauthorized');
  // Historical anonymous JWT callers without apikey remain accepted only while
  // legacy mode is explicitly allowed. Never accept an arbitrary user/server JWT.
  const bearer = req.headers.get('authorization');
  if (bearer?.startsWith('Bearer ') && await matchesLegacy(bearer.slice(7))) return null;
  return response(401, 'Unauthorized');
}
