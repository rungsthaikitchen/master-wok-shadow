// These reproduce source behaviour; a pass does not mean production is corrected.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const vm=require('node:vm');
const parse5=require('parse5');
const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'../../fixtures/website-writer-characterization-25-oct.json')));
const inventory=JSON.parse(fs.readFileSync(path.join(__dirname,'../website-writer-inventory-25-oct.json')));
function source(file,name){
 const x=fixture.files[file].functions[name];
 assert.equal(crypto.createHash('sha256').update(x.source).digest('hex'),x.sha256);
 return x.source;
}
test('current main checkout has one active order writer; both alternate pages have their own writers',()=>{
 for(const page of ['index.html','index_inline_ordering_refactor.html','images/index_inline_ordering_refactor.html']){
  const writers=inventory.files.find(x=>x.path===page).mutations.filter(x=>['orders','order_items'].includes(x.table));
  assert.deepEqual(writers.map(x=>[x.table,x.method]),[['orders','upsert'],['order_items','insert']]);
 }
 assert.equal(fixture.websiteCommit,inventory.websiteCommit);
 for(const [file,f]of Object.entries(fixture.files))assert.equal(f.gitBlob,inventory.files.find(x=>x.path===file).gitBlob);
});
test('normal admin Details output does not create the status selector expected by its legacy listener',()=>{
 const context=vm.createContext({fmtMoney:n=>'GBP '+n.toFixed(2)});
 vm.runInContext(source('admin.html','buildDetailsHTML'),context);
 for(const status of ['pending','proposed','confirmed','preparing','completed']){
  const html=context.buildDetailsHTML({id:'synthetic-admin',status,order_type:'collection',subtotal:12,total:12,order_items:[],customers:{full_name:'Synthetic customer'}});
  const doc=parse5.parseFragment(html);let selects=0;
  function visit(n){if(n.tagName==='select'||n.attrs?.some(a=>a.name==='class'&&a.value.split(/\s+/).includes('status-select')))selects++;for(const c of n.childNodes||[])visit(c);}
  visit(doc);assert.equal(selects,0);
 }
});
test('legacy admin helper can still write directly when explicitly invoked; it is not proof of a visible UI path',async()=>{
 const writes=[];const context=vm.createContext({console:{error(){},warn(){},log(){}},alert(){},fetch(){throw Error('unexpected network');},sb:{from(table){return {update(payload){return {eq:async(field,id)=>{writes.push(JSON.parse(JSON.stringify({table,payload,field,id})));return {error:null};}};}};}}});
 vm.runInContext(source('admin.html','updateOrderStatus'),context);
 await context.updateOrderStatus('synthetic-admin','cancelled');
 assert.deepEqual(writes,[{table:'orders',payload:{status:'cancelled'},field:'id',id:'synthetic-admin'}]);
});
test('kitchen drag and drop reaches a direct order PATCH without a shared command or notification',async()=>{
 const writes=[],cards=[],columns=[];let reloads=0;
 function element(){return {listeners:{},dataset:{},classList:{add(){},remove(){}},addEventListener(name,fn){this.listeners[name]=fn;}};}
 for(const status of ['pending','confirmed','preparing','completed']){
  const body=element();body.appendChild=card=>cards.push(card);const col=element();col.dataset.status=status;col.body=body;col.querySelector=()=>body;columns.push(col);
 }
 const context=vm.createContext({console:{error(){},info(){}},loadOrders(){reloads++;},fetch(){throw Error('unexpected network');},document:{querySelectorAll(){return columns;},createElement(){return element();}},supabase:{from(table){return {update(payload){return {eq:async(field,id)=>{writes.push(JSON.parse(JSON.stringify({table,payload,field,id})));return {error:null};}};}};}}});
 vm.runInContext('let draggedOrderId=null;\n'+source('kitchen.html','updateOrderStatus')+'\n'+source('kitchen.html','renderBoard'),context);
 context.renderBoard([{id:'synthetic-kitchen',order_ref:'SYNTHETIC-1',status:'pending',created_at:'2026-10-25T16:00:00Z',customers:{full_name:'Synthetic customer'}}]);
 assert.equal(cards.length,1);cards[0].listeners.dragstart();
 await columns.find(c=>c.dataset.status==='completed').body.listeners.drop({preventDefault(){}});
 assert.deepEqual(writes,[{table:'orders',payload:{status:'completed'},field:'id',id:'synthetic-kitchen'}]);assert.equal(reloads,1);
});
