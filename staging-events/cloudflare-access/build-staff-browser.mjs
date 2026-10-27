import {build} from 'esbuild';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const root=new URL('.',import.meta.url),preview=new URL('browser-preview/',root);
const joseLicense=fs.readFileSync(new URL('node_modules/jose/LICENSE.md',root),'utf8');
await build({entryPoints:[new URL('staff-browser-client.mjs',root).pathname],bundle:true,platform:'browser',format:'esm',target:'es2022',outfile:new URL('admin-staging/staff-browser.js',preview).pathname});
// An explicit disabled server entry: no enabled configuration, secrets or transport.
await build({stdin:{contents:"import {createStagingBrowserApi} from './staff-browser-api.mjs';const handler=createStagingBrowserApi();export function onRequest(context){return handler(context.request);}",resolveDir:root.pathname},bundle:true,platform:'browser',format:'esm',target:'es2022',minify:true,banner:{js:'/*! jose 6.2.13 — MIT license\n'+joseLicense.replaceAll('*/','* /')+'\n*/'},outfile:new URL('functions/admin-api/staff-command-v1.js',preview).pathname});
const entry=fs.readFileSync(new URL('functions/admin-api/staff-command-v1.js',preview));
fs.writeFileSync(new URL('functions/admin-api/staff-state-v1.js',preview),entry);
const names=['index.html','_headers','_routes.json','admin-staging/master-wok.html','admin-staging/staff-browser.css','admin-staging/staff-browser.js','functions/admin-api/staff-command-v1.js','functions/admin-api/staff-state-v1.js'];
fs.writeFileSync(new URL('manifest.json',preview),JSON.stringify({enabled:false,files:Object.fromEntries(names.map(n=>[n,createHash('sha256').update(fs.readFileSync(new URL(n,preview))).digest('hex')]))},null,2)+'\n');
console.log(JSON.stringify({enabled:false,files:names.length}));
