// Default build is disabled. Enabling requires an explicit fresh deadline and
// endpoint independently verified against the approved Railway service metadata.
import {build} from 'esbuild';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {previewEndpoint} from './preview-fixture-http.mjs';
const root=new URL('.',import.meta.url),out=new URL('deployment/preview-fixture-plan/',root);
const args=process.argv.slice(2),config={enabled:false};
if(args.length){
 if(args.length!==5||args[0]!=='--enable'||args[1]!=='--end-epoch'||args[3]!=='--endpoint')throw Error('EXPLICIT_TRIAL_ARGUMENTS_REQUIRED');
 const endEpoch=Number(args[2]),now=Math.floor(Date.now()/1000);
 if(!Number.isSafeInteger(endEpoch)||!(now<endEpoch&&endEpoch<=now+600)||endEpoch>=1793205000)throw Error('FRESH_TEN_MINUTE_DEADLINE_REQUIRED');
 Object.assign(config,{enabled:true,endEpoch,endpoint:previewEndpoint(args[4])});
}
const f=JSON.parse(fs.readFileSync(new URL('../../fixtures/preview-browser-28-oct-v1.json',root),'utf8'));
fs.mkdirSync(new URL('functions/admin-api/',out),{recursive:true});fs.mkdirSync(new URL('admin-staging/',out),{recursive:true});
const source=`import {createPreviewFixtureApi} from './preview-fixture-api.mjs';import {createPreviewFixtureHttp} from './preview-fixture-http.mjs';const config=${JSON.stringify(config)};const fixture=${JSON.stringify({orderId:f.orderId,targets:f.targets})};const disabled=createPreviewFixtureApi();let handler;export function onRequest(context){if(!config.enabled)return disabled(context.request);try{handler??=createPreviewFixtureApi({enabled:true,fixture,endEpoch:config.endEpoch,hopKey:context.env.MASTER_WOK_PREVIEW_HOP_KEY,actorKey:context.env.MASTER_WOK_PREVIEW_ACTOR_KEY,sendEnvelope:createPreviewFixtureHttp({enabled:true,endpoint:config.endpoint})});return handler(context.request);}catch{return new Response(JSON.stringify({error:'STAFF_BROWSER_STAGING_DISABLED'}),{status:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});}}`;
const license=fs.readFileSync(new URL('node_modules/jose/LICENSE.md',root),'utf8');
await build({stdin:{contents:source,resolveDir:root.pathname},bundle:true,platform:'browser',format:'esm',target:'es2022',minify:true,banner:{js:'/*! jose 6.2.13 — MIT license\n'+license.replaceAll('*/','* /')+'\n*/'},outfile:new URL('functions/admin-api/staff-command-v1.js',out).pathname});
fs.copyFileSync(new URL('functions/admin-api/staff-command-v1.js',out),new URL('functions/admin-api/staff-state-v1.js',out));
const files=['index.html','_headers','_routes.json','admin-staging/master-wok.html','admin-staging/staff-browser.css','admin-staging/staff-browser.js'];
for(const n of files){let data=fs.readFileSync(new URL('browser-preview/'+n,root));if(n.endsWith('master-wok.html'))data=Buffer.from(data.toString().replace(/data-order-id="[^"]+"/,'data-order-id="'+f.orderId+'"'));fs.writeFileSync(new URL(n,out),data);}
const names=[...files,'functions/admin-api/staff-command-v1.js','functions/admin-api/staff-state-v1.js'];
fs.writeFileSync(new URL('manifest.json',out),JSON.stringify({config,fixture:f,files:Object.fromEntries(names.map(n=>[n,createHash('sha256').update(fs.readFileSync(new URL(n,out))).digest('hex')]))},null,2)+'\n');
console.log(JSON.stringify({enabled:config.enabled,files:names.length}));
