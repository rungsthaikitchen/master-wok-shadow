import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { edgeDatabaseClient } from './edge-credentials.mjs';

const secret = 'sb_secret_SYNTHETIC_EDGE_REVIEW';
const origin = 'https://synthetic.invalid';
const enabled = { RTK_EDGE_SECRET_KEY_ENABLED: 'true', SUPABASE_SECRET_KEYS: JSON.stringify({ default: secret }) };
const get = (env) => (name) => env[name];

test('disabled default preserves the exact legacy factory arguments and ignores new key config', () => {
  for (const flag of [undefined, 'false']) {
    for (const options of [undefined, { auth: { persistSession: false } }]) {
      let seen;
      const client = edgeDatabaseClient((...args) => { seen = args; return 'legacy'; }, origin, 'legacy-placeholder', options,
        get({ RTK_EDGE_SECRET_KEY_ENABLED: flag, SUPABASE_SECRET_KEYS: 'invalid-json' }));
      assert.equal(client, 'legacy');
      assert.deepEqual(seen, options === undefined ? [origin, 'legacy-placeholder'] : [origin, 'legacy-placeholder', options]);
    }
  }
});

test('explicit enable requires a valid named new secret; configuration errors never call factory or leak values', () => {
  for (const patch of [
    { RTK_EDGE_SECRET_KEY_ENABLED: 'yes' }, { SUPABASE_SECRET_KEYS: undefined },
    { SUPABASE_SECRET_KEYS: '{private-invalid' }, { SUPABASE_SECRET_KEYS: 'null' },
    { SUPABASE_SECRET_KEYS: '[]' }, { SUPABASE_SECRET_KEYS: '{}' },
    ...['', 'sb_publishable_PRIVATE', 'eyJ_PRIVATE', secret + '\n', 7].map(value => ({ SUPABASE_SECRET_KEYS: JSON.stringify({ default: value }) })),
    { RTK_EDGE_SECRET_KEY_NAME: 'missing' }, { RTK_EDGE_SECRET_KEY_NAME: '__proto__' },
  ]) {
    let calls = 0;
    assert.throws(() => edgeDatabaseClient(() => calls++, origin, 'legacy', undefined, get({ ...enabled, ...patch })),
      error => /^EDGE_(KEY_FLAG_INVALID|SECRET_KEYS_INVALID|SECRET_KEY_INVALID)$/.test(error.message));
    assert.equal(calls, 0);
  }
});

test('named keys and stateless SDK options override persistent sessions', () => {
  let seen;
  edgeDatabaseClient((...args) => { seen = args; }, origin, 'legacy', { auth: { persistSession: true, autoRefreshToken: true }, global: { headers: { 'x-review': 'yes' } } },
    get({ ...enabled, RTK_EDGE_SECRET_KEY_NAME: 'backend', SUPABASE_SECRET_KEYS: JSON.stringify({ backend: secret }) }));
  assert.equal(seen[1], secret);
  assert.deepEqual(seen[2].auth, { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false });
  assert.equal(seen[2].global.headers['x-review'], 'yes');
});

test('actual SDK GET/POST/PATCH/DELETE send apikey only and preserve request bodies', async () => {
  const requests = [];
  const client = edgeDatabaseClient(createClient, origin, 'legacy', undefined, get(enabled), async request => {
    assert.equal(request.headers.get('apikey'), secret);
    assert.equal(request.headers.has('authorization'), false);
    assert.equal(request.redirect, 'error');
    requests.push({ method: request.method, body: await request.text(), path: new URL(request.url).pathname });
    return Response.json([{ id: 'synthetic' }]);
  });
  assert.equal((await client.from('orders').select('id')).error, null);
  assert.equal((await client.from('orders').insert({ id: 'synthetic' })).error, null);
  assert.equal((await client.from('orders').update({ status: 'synthetic' }).eq('id', 'synthetic')).error, null);
  assert.equal((await client.from('orders').delete().eq('id', 'synthetic')).error, null);
  assert.deepEqual(requests.map(r => r.method), ['GET', 'POST', 'PATCH', 'DELETE']);
  assert.deepEqual(JSON.parse(requests[1].body), { id: 'synthetic' });
  assert.deepEqual(JSON.parse(requests[2].body), { status: 'synthetic' });
  assert.ok(requests.every(r => r.path === '/rest/v1/orders'));
});

function captureFetch(transport = () => { throw new Error('transport must not run'); }) {
  let options;
  edgeDatabaseClient((_url, _key, opts) => { options = opts; }, origin, 'legacy', undefined, get(enabled), transport);
  return options.global.fetch;
}

test('foreign origins, non-REST paths and mismatched API keys are refused before transport', async () => {
  const fetch = captureFetch();
  for (const url of ['https://other.invalid/rest/v1/orders', 'http://synthetic.invalid/rest/v1/orders', origin + '/auth/v1/user', origin + '/rest/v10/orders']) {
    await assert.rejects(fetch(url), /EDGE_DATABASE_DESTINATION_REFUSED/);
  }
  await assert.rejects(fetch(origin + '/rest/v1/orders', { headers: { apikey: 'wrong' } }), /EDGE_DATABASE_KEY_MISMATCH/);
});

test('unrelated user JWT is preserved; backend secret Bearer is removed', async () => {
  const seen = [];
  const fetch = captureFetch(request => { seen.push(request); return Response.json([]); });
  await fetch(new Request(origin + '/rest/v1/orders', { headers: { Authorization: 'Bearer synthetic-user-jwt' } }));
  await fetch(origin + '/rest/v1/orders', { headers: { Authorization: `Bearer ${secret}` } });
  assert.equal(seen[0].headers.get('authorization'), 'Bearer synthetic-user-jwt');
  assert.equal(seen[1].headers.has('authorization'), false);
});

test('invalid origins fail without transport or credentials in error messages', () => {
  for (const url of ['invalid', 'http://synthetic.invalid', 'https://user:pass@synthetic.invalid', origin + '/path', origin + '?x=1']) {
    assert.throws(() => edgeDatabaseClient(createClient, url, 'legacy', undefined, get(enabled)), /^Error: EDGE_DATABASE_ORIGIN_INVALID$/);
  }
});

test('client startup makes no network calls', () => {
  edgeDatabaseClient(createClient, origin, 'legacy', undefined, get(enabled), () => { assert.fail('startup network'); });
});
