import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { productionReadCheck } from './production-verify/read-check.mjs';
const token = 'synthetic-production-read-token-00000000001';
const tokenHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))].map(v => v.toString(16).padStart(2, '0')).join('');
const env = { SUPABASE_URL: 'https://ubyjrrsvbbqomitpaidb.supabase.co', RTK_EDGE_SECRET_KEY_ENABLED: 'true', SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_SYNTHETIC_ONLY' }) };
const req = (body = {}, auth = token) => new Request('https://probe.invalid', { method: 'POST', headers: { 'x-rehearsal-token': auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const make = (overrides = {}) => productionReadCheck({ createClient, getEnv: n => env[n], tokenHash, expiresAt: '2999-01-01T00:00:00Z',
  transport: () => { assert.fail('unexpected network'); }, ...overrides });

test('production read verifier defaults disabled without matching capability or before invalid/expired deadline', async () => {
  for (const [handler, request] of [[make(), req({}, 'wrong')], [make({ expiresAt: 'invalid' }), req()], [make({ expiresAt: '2000-01-01T00:00:00Z' }), req()]]) {
    const response = await handler(request);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).requests, 0);
  }
});

test('verifier requires actual enabled flag and production origin; never falls back to legacy', async () => {
  for (const patch of [{ RTK_EDGE_SECRET_KEY_ENABLED: undefined }, { RTK_EDGE_SECRET_KEY_ENABLED: 'false' }, { SUPABASE_URL: 'https://hvrqgufqjslvgiohgkvu.supabase.co' }, { SUPABASE_SECRET_KEYS: undefined }]) {
    const response = await make({ getEnv: n => ({ ...env, ...patch })[n] })(req());
    assert.equal(response.status, 500);
    assert.equal((await response.json()).requests, 0);
  }
});

test('actual SDK makes one zero-row GET with new secret, then verifier refuses repeat', async () => {
  let calls = 0;
  const handler = make({ transport: request => {
    calls++;
    const url = new URL(request.url);
    assert.equal(request.method, 'GET');
    assert.equal(url.origin, env.SUPABASE_URL);
    assert.equal(url.searchParams.get('limit'), '0');
    assert.equal(request.headers.has('authorization'), false);
    assert.equal(request.headers.get('apikey'), 'sb_secret_SYNTHETIC_ONLY');
    assert.equal(request.redirect, 'error');
    return Response.json([]);
  } });
  const response = await handler(req());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).mode, 'NEW_SECRET');
  assert.equal((await handler(req())).status, 503);
  assert.equal(calls, 1);
});

test('verifier refuses custom body, writes and nonzero limits without any transport', async () => {
  assert.equal((await make()(req({ mode: 'legacy' }))).status, 500);
  for (const [method, limit] of [['POST', '0'], ['GET', '1']]) {
    const handler = make({ createClient: (_url, _key, options) => ({ from: () => ({ select: () => ({ limit: async () => {
      await options.global.fetch(env.SUPABASE_URL + '/rest/v1/orders?select=id&limit=' + limit, { method });
      return { data: [] };
    } }) }) }) });
    const response = await handler(req());
    assert.equal(response.status, 500);
    assert.equal((await response.json()).requests, 0);
  }
});

test('verifier refuses unexpected results without returning row contents', async () => {
  const response = await make({ transport: () => Response.json([{ id: 'PRIVATE_ROW' }]) })(req());
  assert.equal(response.status, 500);
  assert.equal((await response.text()).includes('PRIVATE_ROW'), false);
});
