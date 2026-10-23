import test from 'node:test';
import assert from 'node:assert/strict';
import { publicKeyProbe } from './staging-probe.mjs';
const token = 'synthetic-public-probe-capability-0000000001';
const tokenHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))].map(v => v.toString(16).padStart(2, '0')).join('');
const legacyPublicKeyHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('synthetic-legacy')))].map(v => v.toString(16).padStart(2, '0')).join('');
const env = { SUPABASE_URL: 'https://hvrqgufqjslvgiohgkvu.supabase.co', SUPABASE_ANON_KEY: 'synthetic-legacy', SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: 'sb_publishable_SYNTHETIC' }) };
const make = (patch = {}) => publicKeyProbe({ getEnv: n => env[n], tokenHash, legacyPublicKeyHash, expiresAt: '2999-01-01T00:00:00Z', ...patch });
const req = (mode, key = 'sb_publishable_SYNTHETIC', capability = token) => new Request('https://probe.invalid', { method: 'POST', headers: { 'x-rehearsal-token': capability, apikey: key }, body: JSON.stringify({ mode }) });

test('host probe requires capability and deadline before public key evaluation', async () => {
  for (const [handler, request] of [[make(), req('dual', 'unknown', 'wrong')], [make({ expiresAt: 'invalid' }), req('dual')], [make({ expiresAt: '2000-01-01T00:00:00Z' }), req('dual')]]) {
    const response = await handler(request);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).requests, 0);
  }
});

test('host probe tests mode matrix without changing project environment or accessing any provider', async () => {
  const handler = make();
  for (const [mode, key, status] of [['legacy', 'synthetic-legacy', 200], ['legacy', 'sb_publishable_SYNTHETIC', 401], ['dual', 'synthetic-legacy', 200], ['dual', 'sb_publishable_SYNTHETIC', 200], ['publishable', 'synthetic-legacy', 401], ['publishable', 'sb_publishable_SYNTHETIC', 200]]) {
    const response = await handler(req(mode, key));
    assert.equal(response.status, status);
    const body = await response.json();
    assert.equal(body.databaseRequests, 0);
    assert.equal(body.providerCalls, 0);
  }
});

test('host probe refuses production source and consumes finite attempts', async () => {
  const prod = make({ getEnv: n => n === 'SUPABASE_URL' ? 'https://ubyjrrsvbbqomitpaidb.supabase.co' : env[n] });
  assert.equal((await prod(req('dual'))).status, 500);
  const handler = make();
  for (let i = 0; i < 8; i++) assert.equal((await handler(req('dual'))).status, 200);
  assert.equal((await handler(req('dual'))).status, 503);
});

test('host probe rejects malformed mode/body and does not return key configuration details', async () => {
  const response = await make()(req('sb_secret_PRIVATE'));
  assert.equal(response.status, 500);
  assert.equal((await response.text()).includes('PRIVATE'), false);
});
