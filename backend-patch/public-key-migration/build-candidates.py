"""Hash-checked public key migration; outputs candidates only, never deploys."""
from pathlib import Path
import argparse, base64, difflib, hashlib, json, re, shutil

ROOT = Path(__file__).resolve().parent
SLUGS = ['get-delivery-route-quote', 'geocode-address', 'geocode-order']

def load_source(source_dir, name):
    raw = (source_dir / name).read_bytes()
    expected = json.loads((ROOT / 'source-manifest.json').read_text())[name]['sha256']
    assert hashlib.sha256(raw).hexdigest() == expected, 'SOURCE_CHANGED:' + name
    return raw.decode()

def build(source_dir, output_dir, publishable_key):
    assert re.fullmatch(r'sb_publishable_[A-Za-z0-9_-]+', publishable_key), 'PUBLISHABLE_KEY_REQUIRED'
    output_dir.mkdir(parents=True, exist_ok=True)
    legacy_tokens = set(re.findall(r'eyJ[\w-]+\.[\w-]+\.[\w-]+', load_source(source_dir, 'index.html')))
    assert len(legacy_tokens) == 1, 'LEGACY_PUBLIC_KEY_SCOPE_AMBIGUOUS'
    legacy_token = next(iter(legacy_tokens))
    payload = legacy_token.split('.')[1]
    claims = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))
    assert claims.get('role') == 'anon' and claims.get('ref') == 'ubyjrrsvbbqomitpaidb', 'LEGACY_PUBLIC_KEY_SCOPE_INVALID'
    legacy_hash = hashlib.sha256(legacy_token.encode()).hexdigest()
    for slug in SLUGS:
        original = load_source(source_dir, slug + '.ts')
        normalized = original.replace('\r\n', '\n')
        # Place auth after existing OPTIONS handling and before all business work.
        marker = '  try {' if slug != 'geocode-order' else '  if (req.method !== "POST") {'
        start = normalized.index('serve(async')
        position = normalized.index(marker, start)
        guard = '  const denied = await publicAccess(req, (name) => Deno.env.get(name), corsHeaders, legacyPublicKeyHash);\n  if (denied) return denied;\n\n'
        candidate = normalized[:position] + guard + normalized[position:]
        added_import = 'import { publicAccess } from "./public-access.mjs";\nimport { legacyPublicKeyHash } from "./legacy-public-key.mjs";\n'
        candidate = added_import + candidate
        assert candidate.removeprefix(added_import).replace(guard, '', 1) == normalized
        dest = output_dir / slug
        dest.mkdir(exist_ok=True)
        (dest / 'index.ts').write_text(candidate)
        shutil.copyfile(ROOT / 'public-access.mjs', dest / 'public-access.mjs')
        (dest / 'legacy-public-key.mjs').write_text('export const legacyPublicKeyHash = ' + json.dumps(legacy_hash) + ';\n')
        if slug == 'geocode-order':
            shutil.copyfile(ROOT.parent / 'edge-key-migration/edge-credentials.mjs', dest / 'edge-credentials.mjs')
        (output_dir / (slug + '.patch')).write_text(''.join(difflib.unified_diff(normalized.splitlines(True), candidate.splitlines(True), fromfile='a/index.ts', tofile='b/index.ts')))
    for name, expected_literals in [('index.html', 3), ('admin.html', 1)]:
        original = load_source(source_dir, name)
        tokens = re.findall(r'eyJ[\w-]+\.[\w-]+\.[\w-]+', original)
        assert len(tokens) == expected_literals, 'UNEXPECTED_KEY_LITERALS:' + name
        candidate = original
        for token in set(tokens):
            body = token.split('.')[1]
            claims = json.loads(base64.urlsafe_b64decode(body + '=' * (-len(body) % 4)))
            assert claims.get('role') == 'anon' and claims.get('ref') == 'ubyjrrsvbbqomitpaidb', 'UNEXPECTED_KEY_SCOPE'
            candidate = candidate.replace(token, publishable_key)
        candidate = candidate.replace('SUPABASE_ANON_KEY', 'SUPABASE_PUBLIC_KEY')
        urls = re.findall(r'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2(?:/dist/umd/supabase.min.js)?', candidate)
        assert len(urls) == (3 if name == 'index.html' else 1)
        for url in set(urls):
            candidate = candidate.replace(url, 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js')
        if name == 'index.html':
            before = '"apikey": SUPABASE_PUBLIC_KEY,\r\n        "Authorization": `Bearer ${SUPABASE_PUBLIC_KEY}`'
            assert candidate.count(before) == 1, 'DIRECT_HEADERS_CHANGED'
            candidate = candidate.replace(before, '"apikey": SUPABASE_PUBLIC_KEY')
        assert not re.search(r'eyJ[\w-]+\.[\w-]+\.[\w-]+', candidate)
        dest = output_dir / 'website'
        dest.mkdir(exist_ok=True)
        (dest / name).write_bytes(candidate.encode())
        # Publishable key is public, but keep candidate key literals out of the
        # committed review diff so the patch remains reusable across environments.
        old_redacted = re.sub(r'eyJ[\w-]+\.[\w-]+\.[\w-]+', '[LEGACY_PUBLIC_KEY]', original)
        new_redacted = candidate.replace(publishable_key, '[NEW_PUBLISHABLE_KEY]')
        (output_dir / (name + '.review.patch')).write_text(''.join(difflib.unified_diff(old_redacted.splitlines(True), new_redacted.splitlines(True), fromfile='a/' + name, tofile='b/' + name)))

if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source-dir', required=True, type=Path)
    p.add_argument('--output-dir', required=True, type=Path)
    p.add_argument('--publishable-key-file', required=True, type=Path)
    args = p.parse_args()
    build(args.source_dir, args.output_dir, args.publishable_key_file.read_text().strip())
