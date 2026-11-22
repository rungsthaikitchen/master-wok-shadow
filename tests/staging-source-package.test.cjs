'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {createSourcePackage,verifySourcePackage}=require('../scripts/package-staging-sources.cjs');
function fixture(fn){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mw-package-'));
 try{return fn(root);}finally{fs.rmSync(root,{recursive:true,force:true});}
}
test('produces reproducible canonical package and verifies exact source bytes',()=>fixture(root=>{
 fs.writeFileSync(path.join(root,'entry.js'),"module.exports=require('./data.json');");
 fs.writeFileSync(path.join(root,'data.json'),'{"value":1}\n');
 const first=createSourcePackage('entry.js',{root});
 const second=createSourcePackage('entry.js',{root});
 assert.equal(first.canonical,second.canonical);
 assert.equal(first.packageSha256,second.packageSha256);
 assert.equal(verifySourcePackage(first.canonical,first.packageSha256).fileCount,2);
 assert.equal(Buffer.from(first.payload.files[0].base64,'base64').toString(),'{"value":1}\n');
}));
test('rejects tampered package bytes and incorrect hashes',()=>fixture(root=>{
 fs.writeFileSync(path.join(root,'entry.js'),'module.exports=1');
 const result=createSourcePackage('entry.js',{root});
 assert.throws(()=>verifySourcePackage(result.canonical,'0'.repeat(64)),/PACKAGE_HASH_MISMATCH/);
 const changed=result.canonical.replace('MASTER_WOK_SOURCE_PACKAGE_NOT_DEPLOYABLE','TAMPERED_SOURCE_PACKAGE');
 assert.throws(()=>verifySourcePackage(changed,result.packageSha256),/PACKAGE_HASH_MISMATCH/);
 const payload=JSON.parse(result.canonical);
 payload.files[0].base64=Buffer.from('tampered').toString('base64');
 const tampered=JSON.stringify(payload);
 const tamperedHash=crypto.createHash('sha256').update(tampered).digest('hex');
 assert.throws(()=>verifySourcePackage(tampered,tamperedHash),/FILE_HASH_MISMATCH/);
}));
test('packages real deployment source graph without generating executable output',()=>{
 const result=createSourcePackage('master-wok-deployment.js',{root:path.resolve(__dirname,'..')});
 assert.ok(result.payload.files.length>15);
 assert.equal(result.payload.kind,'MASTER_WOK_SOURCE_PACKAGE_NOT_DEPLOYABLE');
 assert.equal(verifySourcePackage(result.canonical,result.packageSha256).fileCount,result.payload.files.length);
});
