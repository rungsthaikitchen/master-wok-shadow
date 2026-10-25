// Offline source inventory. Syntax reachability is not proof of production traffic.
const fs=require('node:fs');
const crypto=require('node:crypto');
const acorn=require('acorn');
const parse5=require('parse5');
function walk(node,visit){
 if(!node||typeof node!=='object')return;
 if(typeof node.type==='string')visit(node);
 for(const [key,value] of Object.entries(node)){
  if(key==='loc')continue;
  if(Array.isArray(value))for(const item of value)walk(item,visit);
  else if(value&&typeof value==='object')walk(value,visit);
 }
}
function scripts(source){
 const out=[];const doc=parse5.parse(source,{sourceCodeLocationInfo:true});
 function visit(n){
  if(n.tagName==='script'){
   const a=Object.fromEntries(n.attrs.map(x=>[x.name,x.value]));
   const type=(a.type||'').trim().toLowerCase();
   if(!a.src&&['','module','text/javascript','application/javascript'].includes(type))out.push({source:n.childNodes.map(x=>x.value||'').join(''),line:n.sourceCodeLocation.startLine,type});
  }
  // template.content deliberately excluded: inert script markup is not execution.
  for(const c of n.childNodes||[])visit(c);
 }
 visit(doc);return out;
}
function tableOf(node){
 if(node?.type==='CallExpression'&&node.callee.type==='MemberExpression'){
  if(node.callee.property.name==='from'&&typeof node.arguments[0]?.value==='string')return node.arguments[0].value;
  return tableOf(node.callee.object);
 }
 if(node?.type==='MemberExpression')return tableOf(node.object);
 return null;
}
function analyze(source,{html=true}={}){
 const units=html?scripts(source):[{source,line:1,type:'module'}];const mutations=[],unresolvedMutationCalls=[],functions={},calls=[],markers=new Set();
 for(const u of units){
  const ast=acorn.parse(u.source,{ecmaVersion:'latest',sourceType:u.type==='module'?'module':'script',locations:true});
  walk(ast,n=>{
   if(n.type==='FunctionDeclaration'&&n.id)functions[n.id.name]=u.source.slice(n.start,n.end);
   if(n.type==='CallExpression'){
    const c=n.callee;
    if(c.type==='Identifier')calls.push(c.name);
    const method=c.type==='MemberExpression'?(c.computed?c.property.value:c.property.name):null;
    if(['insert','upsert','update','delete'].includes(method)){
     const table=tableOf(c.object);
     if(['orders','order_items','customers'].includes(table))mutations.push({table,method,line:u.line+n.loc.start.line-1});
     else unresolvedMutationCalls.push({method,line:u.line+n.loc.start.line-1,reason:'REQUIRES_MANUAL_CLASSIFICATION'});
    }
   }
   if(n.type==='Literal'&&typeof n.value==='string'){
    for(const key of ['order-confirm','review-order','/admin-api/order-action','/admin-order-action','.status-select'])if(n.value.includes(key))markers.add(key);
   }
  });
 }
 return {inlineScripts:units.length,mutations,unresolvedMutationCalls,markers:[...markers].sort(),calls,functions};
}
function inventory(files){
 return files.map(path=>{
  const bytes=fs.readFileSync(path);const a=analyze(bytes.toString('utf8'),{html:path.endsWith('.html')});
  return {path,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),gitBlob:crypto.createHash('sha1').update(Buffer.concat([Buffer.from('blob '+bytes.length+'\0'),bytes])).digest('hex'),parsedScriptUnits:a.inlineScripts,mutations:a.mutations,unresolvedMutationCalls:a.unresolvedMutationCalls,markers:a.markers};
 });
}
module.exports={scripts,analyze,inventory};
if(require.main===module){
 try{process.stdout.write(JSON.stringify(inventory(process.argv.slice(2)),null,2)+'\n');}
 catch{process.stderr.write('SOURCE_REVIEW_FAILED\n');process.exitCode=1;}
}
