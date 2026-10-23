import test from 'node:test';
import assert from 'node:assert/strict';
import { moduleProbe } from './staging/module-probe.ts';
const token = 'synthetic-module-probe-capability-00000000001';
const tokenHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))].map(v => v.toString(16).padStart(2, '0')).join('');
const req = (auth = token) => new Request('https://probe.invalid', { method: 'POST', headers: { 'x-rehearsal-token': auth } });

test('module probe remains disabled without a matching capability or after expiration', async () => {
  for (const [expiresAt, auth] of [['2999-01-01T00:00:00Z', 'wrong'], ['2000-01-01T00:00:00Z', token], ['invalid', token]]) {
    const response = await moduleProbe({ tokenHash, expiresAt })(req(auth));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).requests, 0);
  }
});

test('module probe refuses production source, consumes attempt, and restores global fetch', async () => {
  const previousDeno = globalThis.Deno, previousFetch = globalThis.fetch;
  globalThis.Deno = { env: { get: () => 'https://ubyjrrsvbbqomitpaidb.supabase.co' } };
  try {
    const handler = moduleProbe({ tokenHash, expiresAt: '2999-01-01T00:00:00Z' });
    const response = await handler(req());
    assert.equal(response.status, 500);
    assert.equal((await response.json()).requests, 0);
    assert.equal(globalThis.fetch, previousFetch);
    assert.equal((await handler(req())).status, 503);
  } finally { globalThis.Deno = previousDeno; }
});

test('module probe sanitizes module failures and restores network guard state', async () => {
  const previousDeno = globalThis.Deno, previousFetch = globalThis.fetch;
  // No candidate source modules are installed beside this local bootstrap;
  // test the import-failure path, never evaluate customer/provider code.
  globalThis.Deno = { env: { get: () => 'https://hvrqgufqjslvgiohgkvu.supabase.co' } };
  try {
    const response = await moduleProbe({ tokenHash, expiresAt: '2999-01-01T00:00:00Z' })(req());
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { status: 'FAILED', source: 'STAGING_ONLY', requests: 0, writes: 0, notifications: 0, providerCalls: 0 });
    assert.equal(globalThis.fetch, previousFetch);
  } finally { globalThis.Deno = previousDeno; }
});
