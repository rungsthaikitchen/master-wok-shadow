'use strict';
// Emits a deployable staging runner to stdout. Supply a temporary random token
// through MASTER_WOK_CERTIFICATION_TOKEN; never commit the emitted bundle.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),seen=new Map();
const releaseBuild=['--release','--release-staging','--release-four-ring','--release-payments','--release-combined-payments','--release-amendments','--release-actual-payments'].includes(process.argv[2]);
const certificateFile=process.argv[2]==='--release-actual-payments'?'master-wok-release-candidate.actual-payments.production.json':process.argv[2]==='--release-amendments'?'master-wok-release-candidate.amendments.production.json':process.argv[2]==='--release-combined-payments'?'master-wok-release-candidate.combined-payment.production.json':process.argv[2]==='--release-payments'?'master-wok-release-candidate.payments.production.json':process.argv[2]==='--release-staging'?'master-wok-release-candidate.staging.json':
 process.argv[2]==='--release-four-ring'?'master-wok-release-candidate.four-ring.production.json':'master-wok-release-candidate.json';
let stagingConfiguration={};
if(process.argv[2]==='--release-staging'&&process.env.MASTER_WOK_STAGING_CONFIG_FILE){
 stagingConfiguration=JSON.parse(fs.readFileSync(process.env.MASTER_WOK_STAGING_CONFIG_FILE,'utf8'));
 const keys=['MASTER_WOK_RELEASE_ID','MASTER_WOK_BOOKING_SECRET','MASTER_WOK_NOTIFICATION_SECRET',
  'MASTER_WOK_DELIVERY_PROJECT_REF','MASTER_WOK_DELIVERY_PUBLIC_KEY','MASTER_WOK_REVIEW_APPROVALS','MASTER_WOK_PAYMENTS'];
 if(!stagingConfiguration||Array.isArray(stagingConfiguration)||Object.keys(stagingConfiguration).some(k=>!keys.includes(k)||typeof stagingConfiguration[k]!=='string'))
  throw Error('INVALID_PRIVATE_STAGING_CONFIGURATION');
}
const runner=fs.readFileSync(releaseBuild?path.join(root,'deployment/booking-edge.js'):path.join(__dirname,process.argv[2]||'atomic-checkout-edge.js'),'utf8');
const token=process.env.MASTER_WOK_CERTIFICATION_TOKEN;
if(!releaseBuild&&!/^[a-f0-9]{64}$/.test(token||''))throw Error('TEMPORARY_64_HEX_TOKEN_REQUIRED');
function add(name){
 if(seen.has(name))return;
 const filename=name.endsWith('.json')?name.slice(2):name.slice(2)+'.js';
 const raw=fs.readFileSync(path.join(root,releaseBuild&&name==='./master-wok-release-candidate.json'?certificateFile:filename),'utf8').replace(/^\uFEFF/,'');
 const source=name.endsWith('.json')?'module.exports='+JSON.stringify(JSON.parse(raw))+';':raw;
 seen.set(name,source);
 for(const match of source.matchAll(/require\(['"](\.\/[^'"]+)['"]\)/g))add(match[1]);
}
for(const match of runner.matchAll(/require\(['"](\.\/[^'"]+)['"]\)/g))add(match[1]);
const sourceHash=crypto.createHash('sha256').update(runner);
// Exclude only the certificate itself to avoid a circular digest. The complete
// runtime, model, price catalogue and every imported implementation are bound.
for(const [name,source] of [...seen].sort(([a],[b])=>a.localeCompare(b)))
 if(name!=='./master-wok-release-candidate.json')sourceHash.update(JSON.stringify([name,source]));
const sourceSha256=sourceHash.digest('hex');
if(releaseBuild)process.stderr.write(JSON.stringify({sourceSha256,certificateStatus:JSON.parse(fs.readFileSync(path.join(root,certificateFile),'utf8')).status})+'\n');
const factories=[...seen].map(([name,source])=>JSON.stringify(name)+':function(module,exports,require){\n'+source+'\n}');
process.stdout.write('const factories={\n'+factories.join(',\n')+'\n};\n'+
 'const cache={};\nfunction require(id){if(cache[id])return cache[id].exports;const module={exports:{}};cache[id]=module;factories[id](module,module.exports,require);return module.exports;}\n'+
 runner.replace('__RUNTIME_CONFIGURATION__',()=>JSON.stringify(stagingConfiguration)).replace('__RUNTIME_SOURCE_SHA256__',sourceSha256).replace('__CERTIFICATION_TOKEN__',token||'').replace('__BROWSER_RUN__',()=>process.env.MASTER_WOK_BROWSER_RUN||'__BROWSER_RUN__').replace('__BROWSER_EXPIRES__',()=>process.env.MASTER_WOK_BROWSER_EXPIRES||'__BROWSER_EXPIRES__').replace('__WRITE_FENCE_SQL__',()=>JSON.stringify(fs.readFileSync(path.join(root,'sql/booking-write-fence.sql'),'utf8'))));

