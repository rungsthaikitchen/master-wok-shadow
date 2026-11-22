'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {inventoryGraph}=require('../scripts/inventory-staging-module-graph.cjs');
function fixture(fn){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mw-graph-'));
 try{return fn(root);}finally{fs.rmSync(root,{recursive:true,force:true});}
}
test('inventory is deterministic and follows local dependencies once',()=>fixture(root=>{
 fs.writeFileSync(path.join(root,'entry.js'),"require('./child');require('./child');");
 fs.writeFileSync(path.join(root,'child.js'),"module.exports=1;");
 const a=inventoryGraph('entry.js',{root});
 const b=inventoryGraph('entry.js',{root});
 assert.deepEqual(a,b);
 assert.deepEqual(a.files.map(x=>x.path),['child.js','entry.js']);
 assert.match(a.files[0].sha256,/^[a-f0-9]{64}$/);
}));
test('rejects dynamic requires, parent traversal, and missing modules',()=>fixture(root=>{
 fs.writeFileSync(path.join(root,'entry.js'),"require(name)");
 assert.throws(()=>inventoryGraph('entry.js',{root}),/DYNAMIC_REQUIRE_UNSUPPORTED/);
 fs.writeFileSync(path.join(root,'entry.js'),"require('../outside')");
 assert.throws(()=>inventoryGraph('entry.js',{root}),/UNSUPPORTED_DEPENDENCY/);
 fs.writeFileSync(path.join(root,'entry.js'),"require('./missing')");
 assert.throws(()=>inventoryGraph('entry.js',{root}),/ENOENT/);
}));
test('rejects symlink source and unsupported external dependencies',()=>fixture(root=>{
 fs.writeFileSync(path.join(root,'entry.js'),"require('some-package')");
 assert.throws(()=>inventoryGraph('entry.js',{root}),/UNSUPPORTED_DEPENDENCY/);
 fs.writeFileSync(path.join(root,'child.js'),'module.exports=1');
 fs.symlinkSync(path.join(root,'child.js'),path.join(root,'linked.js'));
 assert.throws(()=>inventoryGraph('linked.js',{root}),/MODULE_NOT_REGULAR_FILE/);
}));

test('inventories the real staging deployment module graph',()=>{
 const root=path.resolve(__dirname,'..');
 const graph=inventoryGraph('master-wok-deployment.js',{root});
 const files=new Set(graph.files.map(x=>x.path));
 for(const required of ['master-wok-deployment.js','master-wok-runtime.js','master-wok-availability.js','master-wok-release-assessors.js'])
  assert.equal(files.has(required),true,required+' missing from graph');
 assert.ok(files.size>15,'expected transitive deployment dependencies');
 assert.equal(files.size,graph.files.length,'inventory must not duplicate files');
});
