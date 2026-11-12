'use strict';
const fs=require('fs'),path=require('path');const root=path.resolve(__dirname,'..'),seen=new Map();
function add(name){if(seen.has(name))return;const raw=fs.readFileSync(path.join(root,name.slice(2)+(name.endsWith('.json')?'':'.js')),'utf8');const source=name.endsWith('.json')?'module.exports='+raw+';':raw;seen.set(name,source);for(const m of source.matchAll(/require\(['"](\.\/[^'"]+)['"]\)/g))add(m[1]);}
let runner=fs.readFileSync(path.join(__dirname,'amendment-transaction-edge.js'),'utf8');for(const m of runner.matchAll(/require\(['"](\.\/[^'"]+)['"]\)/g))add(m[1]);
if(!/^[a-f0-9]{64}$/.test(process.env.AMENDMENT_CERTIFICATION_TOKEN||''))throw Error('TOKEN_REQUIRED');
runner=runner.replace('__TOKEN__',process.env.AMENDMENT_CERTIFICATION_TOKEN).replace('__EXPIRES__',String(Date.now()+30*60*1000));
process.stdout.write('const factories={'+[...seen].map(([name,s])=>JSON.stringify(name)+':function(module,exports,require){\n'+s+'\n}').join(',')+'};const cache={};function require(id){if(cache[id])return cache[id].exports;const m={exports:{}};cache[id]=m;factories[id](m,m.exports,require);return m.exports;}\n'+runner);

