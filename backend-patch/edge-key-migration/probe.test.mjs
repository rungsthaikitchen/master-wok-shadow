import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { rehearsalHandler } from './staging/probe.mjs';
const token = 'synthetic-local-rehearsal-token-00000001';
const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))].map(v => v.toString(16).padStart(2, '0')).join('');
const env = { SUPABASE_URL: 'https://hvrqgufqjslvgiohgkvu.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-legacy', SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_SYNTHETIC_PROBE' }) };
const request = (body = { mode: 'new' }, auth = token) => new Request('https://probe.invalid', {
  method: 'POST', headers: { 'x-rehearsal-token': auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
function handler(overrides = {}) {
  return rehearsalHandler({ createClient, getEnv: name => env[name], tokenHash: hash,
    expiresAt: '2026-10-23T22:00:00Z', now: () => Date.parse('2026-10-23T21:45:00Z'),
    transport: () => { assert.fail('unexpected transport'); }, ...overrides });
}

test('probe is disabled without capability token, after expiry, or with invalid deadline', async () => {
  for (const [h, req] of [
    [handler(), request({}, '')], [handler(), request({}, token + 'wrong')],
    [handler({ now: () => Date.parse('2026-10-23T22:01:00Z') }), request()],
    [handler({ expiresAt: 'invalid' }), request()],
    [handler(), new Request('https://probe.invalid')],
  ]) {
    const response = await h(req);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).requests, 0);
  }
});

test('probe actual SDK reads both modes, returns no rows, and consumes its bounded attempts', async () => {
  let calls = 0;
  const h = handler({ transport: request => {
    calls++;
    assert.equal(request.method, 'GET');
    assert.equal(new URL(request.url).searchParams.get('limit'), '0');
    assert.equal(request.redirect, 'error');
    if (calls === 2) assert.equal(request.headers.has('authorization'), false);
    return Response.json([]);
  } });
  for (const mode of ['legacy', 'new']) {
    const response = await h(request({ mode }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, 'PASSED');
  }
  assert.equal((await h(request())).status, 503);
  assert.equal(calls, 2);
});

test('probe refuses production source, payload overrides and missing new-key JSON before network', async () => {
  const cases = [
    [handler({ getEnv: n => n === 'SUPABASE_URL' ? 'https://ubyjrrsvbbqomitpaidb.supabase.co' : env[n] }), request()],
    [handler(), request({ mode: 'new', table: 'customers' })],
    [handler(), request({ mode: 'write' })],
    [handler({ getEnv: n => n === 'SUPABASE_SECRET_KEYS' ? undefined : env[n] }), request()],
  ];
  for (const [h, req] of cases) {
    const response = await h(req);
    assert.equal(response.status, 500);
    assert.equal((await response.json()).requests, 0);
  }
});

test('probe fetch gate refuses writes and nonzero result limits', async () => {
  for (const [method, limit] of [['POST', '0'], ['GET', '1']]) {
    const h = handler({ createClient: (_url, _key, options) => ({ from: () => ({ select: () => ({ limit: async () => {
      await options.global.fetch(env.SUPABASE_URL + '/rest/v1/orders?select=id&limit=' + limit, { method });
      return { data: [] };
    } }) }) }) });
    const response = await h(request());
    assert.equal(response.status, 500);
    assert.equal((await response.json()).requests, 0);
  }
});

test('probe sanitizes transport errors and rejects unexpected rows', async () => {
  for (const transport of [() => { throw new Error('sb_secret_PRIVATE'); }, () => Response.json([{ id: 'unexpected' }])]) {
    const response = await handler({ transport })(request());
    assert.equal(response.status, 500);
    assert.equal((await response.text()).includes('PRIVATE'), false);
  }
});
