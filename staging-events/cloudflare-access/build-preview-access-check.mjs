// Explicit temporary artifact; does not change the default-disabled preview build.
import {build} from 'esbuild';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {PREVIEW_ACCESS} from './preview-access-profile.mjs';
const endEpoch=Number(process.argv[2]),now=Math.floor(Date.now()/1000);
if(!Number.isSafeInteger(endEpoch)||endEpoch<=now||endEpoch>now+7200)throw Error('FRESH_DEADLINE_WITHIN_TWO_HOURS_REQUIRED');
const root=new URL('.',import.meta.url),out=new URL('deployment/preview-access-check.js',root);
const config={enabled:true,teamDomain:PREVIEW_ACCESS.teamDomain,audience:PREVIEW_ACCESS.audience,requestOrigin:PREVIEW_ACCESS.requestOrigin,endEpoch};
const license=fs.readFileSync(new URL('node_modules/jose/LICENSE.md',root),'utf8');
await build({stdin:{contents:`import {createReadProbe} from './read-probe.mjs';const config=${JSON.stringify(config)};let handler;export function onRequest(context){handler??=createReadProbe(config);return handler(context.request);}`,resolveDir:root.pathname},bundle:true,platform:'browser',format:'esm',target:'es2022',minify:true,banner:{js:'/*! jose 6.2.13 — MIT license\n'+license.replaceAll('*/','* /')+'\n*/'},outfile:out.pathname});
const manifest={scope:'ACCESS_READ_ONLY_PROBE',...config,expiresAt:new Date(endEpoch*1000).toISOString(),sha256:createHash('sha256').update(fs.readFileSync(out)).digest('hex'),bookingRequests:0,databaseRequests:0,notifications:0};
fs.writeFileSync(new URL('deployment/preview-access-check.json',root),JSON.stringify(manifest,null,2)+'\n');
fs.writeFileSync(new URL('deployment/preview-access-routes.json',root),JSON.stringify({version:1,include:['/admin-api/staff-command-v1','/admin-api/staff-state-v1','/admin-api/access-check'],exclude:[]})+'\n');
console.log(JSON.stringify({expiresAt:manifest.expiresAt,sha256:manifest.sha256}));
