"""Build review candidates from independently fetched deployed sources. No deployment."""
from pathlib import Path
import argparse, difflib, hashlib, json, shutil

ROOT = Path(__file__).resolve().parent
SPECS = {
    'review-order': ('supabaseUrl', 'serviceRoleKey', 'const supabase = createClient(supabaseUrl, serviceRoleKey);'),
    'hyper-worker': ('SUPABASE_URL', 'SERVICE_ROLE_KEY', 'const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {\n  auth: {\n    persistSession: false\n  }\n});'),
    'geocode-order': ('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);'),
}

def build(source_dir, output_dir):
    manifest = json.loads((ROOT / 'source-manifest.json').read_text())
    for slug, (url, key, old_client) in SPECS.items():
        source = (source_dir / (slug + '.ts')).read_text()
        source = source.replace('\r\n', '\n')
        assert hashlib.sha256(source.encode()).hexdigest() == manifest[slug]['normalizedSha256'], 'SOURCE_CHANGED:' + slug
        old_import = 'import { createClient } from "https://esm.sh/@supabase/supabase-js@2";'
        assert source.count(old_import) == 1 and source.count(old_client) == 1
        new_import = 'import { createClient } from "npm:@supabase/supabase-js@2.118.0";\nimport { edgeDatabaseClient } from "./edge-credentials.mjs";'
        options = '{ auth: { persistSession: false } }' if slug == 'hyper-worker' else 'undefined'
        new_client = f'const supabase = edgeDatabaseClient(createClient, {url}, {key}, {options}, (name) => Deno.env.get(name));'
        candidate = source.replace(old_import, new_import).replace(old_client, new_client)
        # Only the import and client initialization may differ; all handler text is retained.
        assert candidate.replace(new_import, old_import).replace(new_client, old_client) == source
        target = output_dir / slug
        target.mkdir(parents=True, exist_ok=True)
        (target / 'index.ts').write_text(candidate)
        shutil.copyfile(ROOT / 'edge-credentials.mjs', target / 'edge-credentials.mjs')
        patch = ''.join(difflib.unified_diff(source.splitlines(True), candidate.splitlines(True), fromfile='a/index.ts', tofile='b/index.ts'))
        (output_dir / (slug + '.patch')).write_text(patch)
    return manifest

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', required=True, type=Path)
    parser.add_argument('--output-dir', required=True, type=Path)
    args = parser.parse_args()
    build(args.source_dir, args.output_dir)
