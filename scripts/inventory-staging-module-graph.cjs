'use strict';
// Deterministic CommonJS source graph inventory, NOT a deployable Edge Function.
// No secret values, release certificate, source digest, or output bundle is generated.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const BUILTINS=new Set(['node:fs','node:path','node:crypto','node:test','node:assert/strict']);
function inventoryGraph(entry,{root=process.cwd()}={}){
 const base=path.resolve(root);
 const visited=new Map();
 function visit(relative){
  if(!/^[a-zA-Z0-9_./-]+\.(?:js|json|cjs)$/.test(relative)||relative.split('/').includes('..')||relative.startsWith('/'))
   throw Error('UNSAFE_MODULE_PATH');
  const full=path.resolve(base,relative);
  if(!full.startsWith(base+path.sep))throw Error('MODULE_OUTSIDE_ROOT');
  if(visited.has(relative))return;
  // Reject symlinks in every path component, not just the final source file.
  let cursor=base;
  for(const segment of relative.split('/')){
   cursor=path.join(cursor,segment);
   if(fs.lstatSync(cursor).isSymbolicLink())throw Error('MODULE_SYMLINK_FORBIDDEN');
  }
  const stat=fs.lstatSync(full);
  if(!stat.isFile())throw Error('MODULE_NOT_REGULAR_FILE');
  const bytes=fs.readFileSync(full);
  const source=bytes.toString('utf8');
  const dependencies=[];
  if(relative.endsWith('.json'))JSON.parse(source);
  else{
   const calls=[...source.matchAll(/\brequire\s*\(\s*(['"])(.*?)\1\s*\)/g)];
   for(const match of calls){
    const dep=match[2];
    if(dep.startsWith('./')){
     const target=path.posix.normalize(path.posix.join(path.posix.dirname(relative),dep));
     const resolved=/\.(?:js|json|cjs)$/.test(target)?target:target+'.js';
     dependencies.push(resolved);
    }else if(dep.startsWith('../')||!BUILTINS.has(dep)&&dep!=='pg')
     throw Error('UNSUPPORTED_DEPENDENCY: '+dep);
    else dependencies.push(dep);
   }
   // Reject require expressions which cannot be proven to be static literals.
   const all=(source.match(/\brequire\s*\(/g)||[]).length;
   if(all!==calls.length)throw Error('DYNAMIC_REQUIRE_UNSUPPORTED: '+relative);
  }
  visited.set(relative,{path:relative,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),dependencies});
  for(const dep of dependencies)if(dep.startsWith('./')||!dep.includes(':')&&/\.(?:js|json|cjs)$/.test(dep)){
   const normalized=dep.startsWith('./')?dep.slice(2):dep;
   visit(normalized);
  }
 }
 visit(entry);
 return {schemaVersion:1,entry,files:[...visited.values()].sort((a,b)=>a.path.localeCompare(b.path,'en'))};
}
if(require.main===module){
 const entry=process.argv[2];
 if(!entry)throw Error('USAGE: node scripts/inventory-staging-module-graph.cjs <entry.js>');
 const result=inventoryGraph(entry);
 console.log(JSON.stringify(result,null,2));
 console.error('SOURCE INVENTORY ONLY: not a release digest or deployable artifact.');
}
module.exports={inventoryGraph};
