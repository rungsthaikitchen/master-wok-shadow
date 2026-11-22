'use strict';
// Reproducible, non-executable source package for review only.
// NOT a Supabase bundle, release digest, certificate, or deployment artifact.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {inventoryGraph}=require('./inventory-staging-module-graph.cjs');
function createSourcePackage(entry,{root=process.cwd()}={}){
 const graph=inventoryGraph(entry,{root});
 const files=graph.files.map(file=>{
  const bytes=fs.readFileSync(path.resolve(root,file.path));
  const sha256=crypto.createHash('sha256').update(bytes).digest('hex');
  if(sha256!==file.sha256)throw Error('SOURCE_CHANGED_DURING_PACKAGING');
  return {path:file.path,sha256,dependencies:file.dependencies,base64:bytes.toString('base64')};
 });
 const payload={schemaVersion:1,kind:'MASTER_WOK_SOURCE_PACKAGE_NOT_DEPLOYABLE',entry,files};
 const canonical=JSON.stringify(payload);
 return {payload,canonical,packageSha256:crypto.createHash('sha256').update(canonical,'utf8').digest('hex')};
}
function verifySourcePackage(canonical,expectedSha256){
 if(typeof canonical!=='string'||typeof expectedSha256!=='string')throw Error('INVALID_PACKAGE_INPUT');
 if(crypto.createHash('sha256').update(canonical,'utf8').digest('hex')!==expectedSha256)
  throw Error('PACKAGE_HASH_MISMATCH');
 const payload=JSON.parse(canonical);
 if(payload.kind!=='MASTER_WOK_SOURCE_PACKAGE_NOT_DEPLOYABLE'||payload.schemaVersion!==1||!Array.isArray(payload.files))
  throw Error('INVALID_PACKAGE_FORMAT');
 if(JSON.stringify(payload)!==canonical)throw Error('NON_CANONICAL_PACKAGE');
 const seen=new Set();
 for(const file of payload.files){
  if(!/^[a-zA-Z0-9_./-]+\.(?:js|json|cjs)$/.test(file.path)||file.path.split('/').includes('..')||seen.has(file.path))
   throw Error('INVALID_PACKAGE_PATH');
  seen.add(file.path);
  if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.base64))
   throw Error('INVALID_BASE64');
  const bytes=Buffer.from(file.base64,'base64');
  if(bytes.toString('base64')!==file.base64||crypto.createHash('sha256').update(bytes).digest('hex')!==file.sha256)
   throw Error('FILE_HASH_MISMATCH');
 }
 if(!seen.has(payload.entry))throw Error('PACKAGE_ENTRY_MISSING');
 return {fileCount:seen.size,packageSha256:expectedSha256};
}
if(require.main===module){
 const entry=process.argv[2];
 if(!entry)throw Error('USAGE: node scripts/package-staging-sources.cjs <entry.js>');
 const result=createSourcePackage(entry);
 verifySourcePackage(result.canonical,result.packageSha256);
 // Print only digest/count; do not emit source or embedded credentials to logs.
 console.log(JSON.stringify({kind:result.payload.kind,fileCount:result.payload.files.length,packageSha256:result.packageSha256}));
}
module.exports={createSourcePackage,verifySourcePackage};
