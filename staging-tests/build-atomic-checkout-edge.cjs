'use strict';
// Emits a deployable staging runner to stdout. Supply a temporary random token
// through MASTER_WOK_CERTIFICATION_TOKEN; never commit the emitted bundle.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),seen=new Map();
const runner=fs.readFileSync(path.join(__dirname,process.argv[2]||'atomic-checkout-edge.js'),'utf8');
const token=process.env.MASTER_WOK_CERTIFICATION_TOKEN;
if(!/^[a-f0-9]{64}$/.test(token||''))throw Error('TEMPORARY_64_HEX_TOKEN_REQUIRED');
function add(name){
 if(seen.has(name))return;
 const filename=name.endsWith('.json')?name.slice(2):name.slice(2)+'.js';
 const raw=fs.readFileSync(path.join(root,filename),'utf8').replace(/^\uFEFF/,'');
 const source=name.endsWith('.json')?'module.exports='+JSON.stringify(JSON.parse(raw))+';':raw;
 seen.set(name,source);
 for(const match of source.matchAll(/require\(['"](\.\/[^'"]+)['"]\)/g))add(match[1]);
}
for(const match of runner.matchAll(/require\(['"](\.\/[^'"]+)['"]\)/g))add(match[1]);
const factories=[...seen].map(([name,source])=>JSON.stringify(name)+':function(module,exports,require){\n'+source+'\n}');
process.stdout.write('const factories={\n'+factories.join(',\n')+'\n};\n'+
 'const cache={};\nfunction require(id){if(cache[id])return cache[id].exports;const module={exports:{}};cache[id]=module;factories[id](module,module.exports,require);return module.exports;}\n'+
 runner.replace('__CERTIFICATION_TOKEN__',token));
