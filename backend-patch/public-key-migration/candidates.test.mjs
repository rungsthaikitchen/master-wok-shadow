import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { publicAccess } from './public-access.mjs';
import { edgeDatabaseClient } from '../edge-key-migration/edge-credentials.mjs';
const root = dirname(fileURLToPath(import.meta.url));
const sources = process.env.RTK_PUBLIC_KEY_SOURCE_DIR;
const require = createRequire(new URL('../edge-key-migration/package.json', import.meta.url));
const legacy = 'eyJ.SYNTHETIC_ANON.KEY', modern = 'sb_publishable_SYNTHETIC_ONLY';
const legacyPublicKeyHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(legacy)))].map(v => v.toString(16).padStart(2, '0')).join('');

function loadHandler(source, mode) {
  let handler;
  const effects = { google: [], writes: [] };
  const env = { SUPABASE_URL: 'https://synthetic.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-legacy', GOOGLE_MAPS_API_KEY: 'SYNTHETIC',
    SUPABASE_ANON_KEY: legacy, SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: modern }), RTK_EDGE_PUBLIC_KEY_MODE: mode };
  const sandbox = {
    Request, Response, Headers, URL, console: { log() {}, error() {}, warn() {} },
    crypto, legacyPublicKeyHash, Deno: { env: { get: n => env[n] } }, publicAccess, edgeDatabaseClient,
    serve: fn => { handler = fn; },
    createClient: () => ({ from: table => ({ update: values => ({ eq: async (column, id) => { effects.writes.push({ table, values, column, id }); return { error: null }; } }) }) }),
    fetch: async (input, init) => {
      effects.google.push(String(input));
      if (String(input).includes('routes.googleapis.com')) return Response.json({ routes: [{ distanceMeters: 1609.344, duration: '600s' }] });
      return Response.json({ status: 'OK', results: [{ geometry: { location: { lat: 53.7, lng: -1.6 } }, formatted_address: 'SYNTHETIC ADDRESS' }] });
    },
  };
  const code = stripTypeScriptTypes(source.replaceAll('\r\n', '\n').replace(/^import .*;\n/gm, ''), { mode: 'strip' });
  new vm.Script(code).runInNewContext(sandbox, { timeout: 1000 });
  return { handler, effects };
}

const payloadFor = slug => slug === 'get-delivery-route-quote'
  ? { origin: { lat: 53.7, lng: -1.6 }, destination: { lat: 53.71, lng: -1.61 } }
  : { customer_address: 'SYNTHETIC ADDRESS', ...(slug === 'geocode-order' ? { order_id: 'synthetic-order' } : {}) };
const request = (slug, key) => new Request('https://handler.invalid/' + slug, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: key }, body: JSON.stringify(payloadFor(slug)) });

test('hash-checked candidates preserve business responses with synthetic Google/DB stubs and gate all side effects', async () => {
  assert.ok(sources, 'RTK_PUBLIC_KEY_SOURCE_DIR required; do not skip snapshot verification');
  const output = mkdtempSync(join(tmpdir(), 'rtk-public-candidates-'));
  try {
    const keyFile = join(output, 'public.txt'); writeFileSync(keyFile, modern);
    execFileSync('python3', [join(root, 'build-candidates.py'), '--source-dir', sources, '--output-dir', output, '--publishable-key-file', keyFile]);
    for (const slug of ['get-delivery-route-quote', 'geocode-address', 'geocode-order']) {
      const before = readFileSync(join(sources, slug + '.ts'), 'utf8');
      const after = readFileSync(join(output, slug, 'index.ts'), 'utf8');
      const baseline = loadHandler(before, 'legacy');
      const baselineResponse = await baseline.handler(request(slug, legacy));
      assert.equal(baselineResponse.status, 200);
      const baselineBody = await baselineResponse.json();
      for (const [mode, key] of [['legacy', legacy], ['dual', legacy], ['dual', modern], ['publishable', modern]]) {
        const current = loadHandler(after, mode);
        const response = await current.handler(request(slug, key));
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), baselineBody);
        assert.deepEqual(JSON.parse(JSON.stringify(current.effects)), JSON.parse(JSON.stringify(baseline.effects)));
      }
      const denied = loadHandler(after, 'publishable');
      for (const key of ['wrong', legacy]) {
        assert.equal((await denied.handler(request(slug, key))).status, 401);
      }
      assert.deepEqual(denied.effects, { google: [], writes: [] });
      const preflight = await denied.handler(new Request('https://handler.invalid', { method: 'OPTIONS' }));
      assert.equal(preflight.status, 200);
      assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), '*');
      assert.deepEqual(denied.effects, { google: [], writes: [] });
    }
  } finally { rmSync(output, { recursive: true, force: true }); }
});

test('browser candidates remove legacy literals, pin the actual UMD artifact and keep inline scripts syntactically valid', () => {
  assert.ok(sources, 'source snapshots required');
  const output = mkdtempSync(join(tmpdir(), 'rtk-browser-candidates-'));
  try {
    const keyFile = join(output, 'public.txt'); writeFileSync(keyFile, modern);
    execFileSync('python3', [join(root, 'build-candidates.py'), '--source-dir', sources, '--output-dir', output, '--publishable-key-file', keyFile]);
    const parse = `from html.parser import HTMLParser\nimport json,sys\nclass P(HTMLParser):\n def __init__(self): super().__init__(); self.scripts=[]; self.current=None\n def handle_starttag(self,t,a):\n  if t=='script': self.current={'attrs':dict(a),'code':''}\n def handle_data(self,d):\n  if self.current is not None: self.current['code']+=d\n def handle_endtag(self,t):\n  if t=='script' and self.current is not None: self.scripts.append(self.current); self.current=None\np=P();p.feed(open(sys.argv[1]).read());print(json.dumps(p.scripts))`;
    for (const name of ['index.html', 'admin.html']) {
      const source = readFileSync(join(output, 'website', name), 'utf8');
      assert.equal(/eyJ[\w-]+\.[\w-]+\.[\w-]+/.test(source), false);
      assert.equal(source.includes('SUPABASE_ANON_KEY'), false);
      assert.equal(source.includes('Bearer ${SUPABASE_PUBLIC_KEY}'), false);
      const before = JSON.parse(execFileSync('python3', ['-c', parse, join(sources, name)], { maxBuffer: 2e6 }));
      const after = JSON.parse(execFileSync('python3', ['-c', parse, join(output, 'website', name)], { maxBuffer: 2e6 }));
      assert.equal(after.length, before.length);
      for (const [i, script] of after.entries()) {
        if (!script.attrs.src && (!script.attrs.type || script.attrs.type === 'text/javascript')) {
          new vm.Script(script.code, { filename: name + ':script' + i });
        }
        if (script.attrs.src?.includes('@supabase/supabase-js')) {
          assert.equal(script.attrs.src, 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js');
        }
      }
    }
  } finally { rmSync(output, { recursive: true, force: true }); }
});

test('pinned browser UMD client invokes public functions with apikey only', async () => {
  const packagePath = require.resolve('@supabase/supabase-js/package.json');
  const source = readFileSync(join(dirname(packagePath), 'dist/umd/supabase.js'), 'utf8');
  let calls = 0;
  const sandbox = { console, URL, Headers, Request, Response, AbortController, WebSocket: globalThis.WebSocket, setTimeout, clearTimeout, setInterval, clearInterval,
    fetch: async (input, init) => {
      calls++;
      const req = new Request(input, init);
      assert.equal(req.headers.get('apikey'), modern);
      assert.equal(req.headers.has('authorization'), false);
      return Response.json({ ok: true });
    } };
  sandbox.window = sandbox; sandbox.self = sandbox;
  new vm.Script(source).runInNewContext(sandbox);
  const client = sandbox.supabase.createClient('https://synthetic.invalid', modern, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  assert.equal((await client.functions.invoke('geocode-address', { body: {} })).error, null);
  assert.equal(calls, 1);
});
