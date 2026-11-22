'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {verifySourceManifest}=require('../scripts/verify-staging-source-manifest.cjs');
test('verifies exact file bytes without claiming a release digest',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mw-manifest-'));
 try{
  const content='example-source\n';
  fs.writeFileSync(path.join(dir,'module.js'),content);
  const sha256=crypto.createHash('sha256').update(content).digest('hex');
  assert.deepEqual(verifySourceManifest({schemaVersion:1,files:[{path:'module.js',sha256}]},{root:dir}),['module.js']);
  fs.writeFileSync(path.join(dir,'module.js'),content+'changed');
  assert.throws(()=>verifySourceManifest({schemaVersion:1,files:[{path:'module.js',sha256}]},{root:dir}),/SOURCE_MANIFEST_MISMATCH/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('rejects duplicate, traversal, and invalid hashes',()=>{
 const hash='a'.repeat(64);
 for(const files of [
  [{path:'../private',sha256:hash}],
  [{path:'a',sha256:hash},{path:'a',sha256:hash}],
  [{path:'a',sha256:'not-a-hash'}]
 ])assert.throws(()=>verifySourceManifest({schemaVersion:1,files}),/SOURCE_MANIFEST_ENTRY_INVALID/);
});
