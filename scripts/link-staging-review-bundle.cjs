'use strict';
// Review-only CommonJS module linker. Output is NOT an Edge Function entrypoint.
// External dependencies (e.g. pg) are explicitly forbidden at this stage.
const {createSourcePackage,verifySourcePackage}=require('./package-staging-sources.cjs');
function linkReviewBundle(entry,{root=process.cwd()}={}){
 const pack=createSourcePackage(entry,{root});
 verifySourcePackage(pack.canonical,pack.packageSha256);
 const modules=pack.payload.files;
 for(const module of modules){
  for(const dep of module.dependencies){
   if(!dep.startsWith('./')&&!/\.(?:js|json|cjs)$/.test(dep))
    throw Error('EXTERNAL_DEPENDENCY_REQUIRES_EDGE_ADAPTER: '+dep);
  }
 }
 const registry=modules.map(m=>JSON.stringify(m.path)+':function(module,exports,require){\n'+
  (m.path.endsWith('.json')?'module.exports='+JSON.stringify(JSON.parse(Buffer.from(m.base64,'base64').toString('utf8')))+';':
   Buffer.from(m.base64,'base64').toString('utf8'))+'\n}').join(',\n');
 const source=`// REVIEW ONLY - NOT DEPLOYABLE; no Deno.serve, certificate, secrets or database adapter.
(function(){
'use strict';
const factories={${registry}};
const cache=Object.create(null);
function load(id){
 if(Object.prototype.hasOwnProperty.call(cache,id))return cache[id].exports;
 if(!Object.prototype.hasOwnProperty.call(factories,id))throw Error('MODULE_NOT_PACKAGED');
 const module={exports:{}};cache[id]=module;
 const localRequire=spec=>{
  if(!spec.startsWith('./'))throw Error('EXTERNAL_DEPENDENCY_REQUIRES_EDGE_ADAPTER');
  const path=id.split('/').slice(0,-1);
  for(const segment of spec.split('/')){if(segment==='.')continue;if(segment==='..')path.pop();else path.push(segment);}
  const target=path.join('/');
  return load(/\\.(?:js|json|cjs)$/.test(target)?target:target+'.js');
 };
 factories[id](module,module.exports,localRequire);
 return module.exports;
}
return load(${JSON.stringify(entry)});
})();`;
 return {source,packageSha256:pack.packageSha256,fileCount:modules.length};
}
if(require.main===module){
 const entry=process.argv[2];
 if(!entry)throw Error('USAGE: node scripts/link-staging-review-bundle.cjs <entry.js>');
 const result=linkReviewBundle(entry);
 // Never print bundle contents: source may include configuration or proprietary code.
 console.log(JSON.stringify({status:'REVIEW_ONLY_NOT_DEPLOYABLE',fileCount:result.fileCount,packageSha256:result.packageSha256}));
}
module.exports={linkReviewBundle};
