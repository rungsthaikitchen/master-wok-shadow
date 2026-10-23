import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { publicAccess } from './public-access.mjs';
const require = createRequire(new URL('../edge-key-migration/package.json', import.meta.url));
const { createClient } = require('@supabase/supabase-js');
const old = 'eyJ.SYNTHETIC_ANON.KEY';
const modern = 'sb_publishable_SYNTHETIC_ONLY';
const env = { SUPABASE_ANON_KEY: old, SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: modern }) };
const legacyHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(old)))].map(v => v.toString(16).padStart(2, '0')).join('');
const cors = { 'Access-Control-Allow-Origin': '*' };
const check = (headers, patch = {}) => publicAccess(new Request('https://handler.invalid', { headers }), n => ({ ...env, ...patch })[n], cors, legacyHash);

test('default mode preserves old public-key callers and rejects publishable/unknown/missing keys', async () => {
  assert.equal(await check({ apikey: old, Authorization: `Bearer ${old}` }), null);
  assert.equal(await check({ Authorization: `Bearer ${old}` }), null);
  for (const headers of [{}, { apikey: modern }, { apikey: 'unknown' }, { Authorization: 'Bearer unrelated-user' }, { apikey: 'sb_secret_PRIVATE' }]) {
    assert.equal((await check(headers)).status, 401);
  }
});

test('dual mode accepts both public keys, including modern anonymous requests without Authorization', async () => {
  for (const headers of [{ apikey: old }, { apikey: modern }, { Authorization: `Bearer ${old}` }, { apikey: modern, Authorization: 'Bearer synthetic-user-session' }]) {
    assert.equal(await check(headers, { RTK_EDGE_PUBLIC_KEY_MODE: 'dual' }), null);
  }
});

test('publishable-only mode retires every old key path even when legacy environment variable remains', async () => {
  for (const headers of [{ apikey: old }, { Authorization: `Bearer ${old}` }, { apikey: 'wrong', Authorization: `Bearer ${old}` }]) {
    assert.equal((await check(headers, { RTK_EDGE_PUBLIC_KEY_MODE: 'publishable' })).status, 401);
  }
  assert.equal(await check({ apikey: modern }, { RTK_EDGE_PUBLIC_KEY_MODE: 'publishable', SUPABASE_ANON_KEY: undefined }), null);
});

test('hosted alias regression: SUPABASE_ANON_KEY may contain a publishable key without changing legacy admission', async () => {
  const getEnv = name => {
    if (name === 'SUPABASE_ANON_KEY') assert.fail('must not depend on the mutable legacy alias');
    return env[name];
  };
  assert.equal(await publicAccess(new Request('https://handler.invalid', { headers: { apikey: old } }), getEnv, cors, legacyHash), null);
  assert.equal((await publicAccess(new Request('https://handler.invalid', { headers: { apikey: modern } }), getEnv, cors, legacyHash)).status, 401);
});

test('legacy admission fails closed if the pinned fingerprint is missing or malformed', async () => {
  for (const hash of [undefined, '', 'PRIVATE_INVALID']) {
    assert.equal((await publicAccess(new Request('https://handler.invalid', { headers: { apikey: old } }), n => env[n], cors, hash)).status, 503);
  }
});

test('malformed configuration fails closed without leaking values or falling back', async () => {
  const cases = [
    { RTK_EDGE_PUBLIC_KEY_MODE: 'typo' }, { RTK_EDGE_PUBLIC_KEY_MODE: 'invalid' },
    ...[undefined, 'invalid_PRIVATE', 'null', '[]', '{}', JSON.stringify({ default: 'sb_secret_PRIVATE' }), JSON.stringify({ default: modern + '\n' })]
      .map(value => ({ RTK_EDGE_PUBLIC_KEY_MODE: 'dual', SUPABASE_PUBLISHABLE_KEYS: value })),
  ];
  for (const patch of cases) {
    const response = await check({ apikey: old }, patch);
    assert.equal(response.status, 503);
    assert.equal((await response.text()).includes('PRIVATE'), false);
  }
});

test('wrong supplied apikey cannot fall through to a valid legacy bearer; named publishable key is explicit', async () => {
  assert.equal((await check({ apikey: 'wrong', Authorization: `Bearer ${old}` })).status, 401);
  assert.equal(await check({ apikey: modern }, { RTK_EDGE_PUBLIC_KEY_MODE: 'dual', RTK_EDGE_PUBLISHABLE_KEY_NAME: 'checkout', SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ checkout: modern }) }), null);
  assert.equal((await check({ apikey: modern }, { RTK_EDGE_PUBLIC_KEY_MODE: 'dual', RTK_EDGE_PUBLISHABLE_KEY_NAME: 'missing' })).status, 503);
});

test('actual pinned SDK anonymous function call uses publishable apikey without a fake JWT', async () => {
  let calls = 0;
  const client = createClient('https://synthetic.invalid', modern, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      calls++;
      const request = new Request(input, init);
      assert.equal(request.headers.get('apikey'), modern);
      assert.equal(request.headers.has('authorization'), false);
      assert.equal(await publicAccess(request, n => ({ ...env, RTK_EDGE_PUBLIC_KEY_MODE: 'dual' })[n], cors, legacyHash), null);
      return Response.json({ ok: true });
    } },
  });
  const result = await client.functions.invoke('geocode-address', { body: {} });
  assert.equal(result.error, null);
  assert.equal(calls, 1);
});
