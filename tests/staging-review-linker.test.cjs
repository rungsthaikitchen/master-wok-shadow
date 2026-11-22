'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const {linkReviewBundle}=require('../scripts/link-staging-review-bundle.cjs');
function fixture(fn){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mw-link-'));
 try{return fn(root);}finally{fs.rmSync(root,{recursive:true,force:true});}
}
test('links deterministic relative modules and JSON into review-only runnable source',()=>fixture(root=>{
 fs.writeFileSync(path.join(root,'entry.js'),"module.exports=require('./nested/child')+require('./value.json').number");
 fs.mkdirSync(path.join(root,'nested'));
 fs.writeFileSync(path.join(root,'nested','child.js'),'module.exports=41');
 fs.writeFileSync(path.join(root,'value.json'),'{"number":1}');
 const first=linkReviewBundle('entry.js',{root});
 const second=linkReviewBundle('entry.js',{root});
 assert.equal(first.source,second.source);
 assert.equal(vm.runInNewContext(first.source),42);
 assert.match(first.source,/REVIEW ONLY - NOT DEPLOYABLE/);
}));
test('refuses external dependencies until a reviewed Edge adapter exists',()=>fixture(root=>{
 fs.writeFileSync(path.join(root,'entry.js'),"module.exports=require('pg')");
 assert.throws(()=>linkReviewBundle('entry.js',{root}),/EXTERNAL_DEPENDENCY_REQUIRES_EDGE_ADAPTER/);
}));
