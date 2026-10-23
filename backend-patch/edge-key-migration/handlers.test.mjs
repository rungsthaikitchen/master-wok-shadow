import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { edgeDatabaseClient } from './edge-credentials.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const sourceDir = process.env.RTK_EDGE_REVIEW_SOURCE_DIR;

test('exact deployed source candidates preserve handlers, CORS and admin authorization', async () => {
  assert.ok(sourceDir, 'RTK_EDGE_REVIEW_SOURCE_DIR must point to the fetched source snapshots; do not silently skip source verification');
  const output = mkdtempSync(join(tmpdir(), 'rtk-edge-candidate-'));
  try {
    execFileSync('python3', [join(root, 'build-candidates.py'), '--source-dir', sourceDir, '--output-dir', output]);
    for (const slug of ['review-order', 'hyper-worker', 'geocode-order']) {
      const before = readFileSync(join(sourceDir, slug + '.ts'), 'utf8').replaceAll('\r\n', '\n');
      const after = readFileSync(join(output, slug, 'index.ts'), 'utf8');
      // Entire serve handler and all following helpers must be byte-identical.
      assert.equal(after.slice(after.indexOf('serve(async')), before.slice(before.indexOf('serve(async')));
      for (const newMode of [false, true]) {
        let handler, dbCalls = 0, fetchCalls = 0;
        const env = {
          SUPABASE_URL: 'https://synthetic.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-legacy', ADMIN_SECRET: 'synthetic-admin',
          ...(newMode ? { RTK_EDGE_SECRET_KEY_ENABLED: 'true', SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_SYNTHETIC_REVIEW' }) } : {}),
        };
        const sandbox = {
          Request, Response, URL, Headers, Date, crypto,
          console: { log() {}, error() {}, warn() {} },
          Deno: { env: { get: name => env[name] } },
          serve: fn => { handler = fn; }, edgeDatabaseClient,
          createClient: () => ({ from() { dbCalls++; throw new Error('DB refused in boundary test'); } }),
          fetch: () => { fetchCalls++; throw new Error('Provider refused'); },
        };
        const code = stripTypeScriptTypes(after.replace(/^import .*;\n/gm, ''), { mode: 'strip' });
        new vm.Script(code).runInNewContext(sandbox, { timeout: 1000 });
        assert.equal(typeof handler, 'function');
        const options = await handler(new Request('https://handler.invalid', { method: 'OPTIONS' }));
        assert.equal(options.status, 200);
        assert.equal(options.headers.get('Access-Control-Allow-Origin'), '*');
        assert.equal((await handler(new Request('https://handler.invalid'))).status, 405);
        if (slug !== 'geocode-order') {
          for (const secret of [undefined, 'wrong']) {
            const headers = secret ? { 'x-admin-secret': secret } : {};
            assert.equal((await handler(new Request('https://handler.invalid', { method: 'POST', headers, body: '{}' }))).status, 401);
          }
        }
        const response = await handler(new Request('https://handler.invalid', {
          method: 'POST', headers: { 'x-admin-secret': 'synthetic-admin', 'Content-Type': 'application/json' }, body: '{}',
        }));
        assert.equal(response.status, 400);
        assert.equal(dbCalls, 0);
        assert.equal(fetchCalls, 0);
      }
    }
  } finally { rmSync(output, { recursive: true, force: true }); }
});
