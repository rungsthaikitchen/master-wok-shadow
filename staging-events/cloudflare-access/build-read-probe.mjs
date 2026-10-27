// Reproducible single-file Pages function; input is trusted operator config only.
import {build} from 'esbuild';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const config=process.argv[2]?JSON.parse(fs.readFileSync(process.argv[2],'utf8')):{enabled:false};
if(config.enabled===true&&(!Number.isSafeInteger(config.endEpoch)||config.endEpoch<=Date.now()/1000||config.endEpoch>Date.now()/1000+7200))throw Error('BOUNDED_PROBE_CONFIG_REQUIRED');
const license=fs.readFileSync(new URL('./node_modules/jose/LICENSE.md',import.meta.url),'utf8');
fs.mkdirSync(new URL('./deployment',import.meta.url),{recursive:true});
const target=new URL('./deployment/access-check.js',import.meta.url);
await build({stdin:{contents:"import {createReadProbe} from './read-probe.mjs';\nconst probeConfig=("+JSON.stringify(config)+");\nlet handler;\nexport function onRequest(context){handler??=createReadProbe(probeConfig);return handler(context.request);}\n",resolveDir:new URL('.',import.meta.url).pathname,sourcefile:'access-check-entry.mjs'},bundle:true,platform:'browser',format:'esm',target:'es2022',outfile:target.pathname,legalComments:'inline',banner:{js:'/*! jose 6.2.13 — MIT license\n'+license.replaceAll('*/','* /')+'\n*/'}});
const artifact=fs.readFileSync(target);
const manifest={enabled:config.enabled===true,endEpoch:config.endEpoch??null,expiresAt:config.endEpoch?new Date(config.endEpoch*1000).toISOString():null,bytes:artifact.length,sha256:createHash('sha256').update(artifact).digest('hex'),scope:'ACCESS_READ_ONLY_PROBE'};
fs.writeFileSync(new URL('./deployment/manifest.json',import.meta.url),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify(manifest));
