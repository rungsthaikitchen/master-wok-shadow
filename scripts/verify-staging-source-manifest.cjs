'use strict';
// Read-only provenance verifier. Never constructs a deployable release or rewrites a certificate.
const fs=require('node:fs');
const crypto=require('node:crypto');
function verifySourceManifest(manifest,{root=process.cwd()}={}){
 if(!manifest||manifest.schemaVersion!==1||!Array.isArray(manifest.files)||!manifest.files.length)
  throw Error('SOURCE_MANIFEST_INVALID');
 const seen=new Set();
 const verified=[];
 for(const entry of manifest.files){
  if(typeof entry.path!=='string'||!entry.path||
   entry.path.startsWith('/')||entry.path.split('/').includes('..')||
   entry.path.includes('\\')||seen.has(entry.path)||
   !/^[a-f0-9]{64}$/.test(entry.sha256||''))
   throw Error('SOURCE_MANIFEST_ENTRY_INVALID');
  seen.add(entry.path);
  const bytes=fs.readFileSync(require('node:path').join(root,entry.path));
  const actual=crypto.createHash('sha256').update(bytes).digest('hex');
  if(actual!==entry.sha256)throw Error('SOURCE_MANIFEST_MISMATCH: '+entry.path);
  verified.push(entry.path);
 }
 return verified;
}
if(require.main===module){
 const file=process.argv[2];
 if(!file)throw Error('USAGE: node scripts/verify-staging-source-manifest.cjs <manifest.json>');
 const manifest=JSON.parse(fs.readFileSync(file,'utf8'));
 const files=verifySourceManifest(manifest);
 console.log('Verified source files:',files.length);
 console.log('This is NOT a release source digest or deployment approval.');
}
module.exports={verifySourceManifest};
