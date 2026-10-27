// Reproduces source behaviour only. No real network/database/customer calls.
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),vm=require('node:vm');
const fixture=require('../fixtures/authorization-source-characterization-27-oct.json');
function source(file){const f=fixture.files[file];assert.equal(crypto.createHash('sha256').update(f.source).digest('hex'),f.sha256);return f.source;}
test('inspected proxy forwards unverified request with server secret; external Access policy is unknown',async()=>{
 const seen=[];const context=vm.createContext({Response,fetch:async(url,options)=>{seen.push({url,options});return new Response('{}',{status:200});},console:{error(){}}});
 vm.runInContext('const RAILWAY_ADMIN_ORDER_ACTION_URL="https://synthetic.invalid/backend";\n'+source('functions/admin-api/order-action.js'),context);
 let bodyReads=0;const r=await context.onRequestPost({env:{RTK_PROXY_SECRET:'SYNTHETIC_SHARED_SECRET'},request:{json:async()=>{bodyReads++;return {order_id:'synthetic-order',action:'accept'};}}});
 assert.equal(r.status,200);assert.equal(bodyReads,1);assert.equal(seen.length,1);assert.equal(seen[0].options.headers['x-rtk-proxy-secret'],'SYNTHETIC_SHARED_SECRET');
 assert.equal(seen[0].options.headers.Authorization,undefined);
});
test('guest helper can select/update customer by supplied email without proving account ownership',async()=>{
 const writes=[];const sb={from(table){return {select(){return {eq(field,value){assert.equal(table,'customers');assert.equal(field,'email');assert.equal(value,'synthetic@example.invalid');return {maybeSingle:async()=>({data:{id:'synthetic-existing',phone:'synthetic-phone'},error:null})};}};},update(payload){return {eq(field,id){writes.push({table,payload,field,id});return {select(){return {single:async()=>({data:{id},error:null})};}};}};}};}};
 const context=vm.createContext({window:{sb}});vm.runInContext(source('index.html'),context);
 const r=await context.getOrCreateCustomer({name:'Synthetic changed name',email:'SYNTHETIC@EXAMPLE.INVALID',phone:'synthetic-phone',address:'Synthetic new address'});
 assert.equal(r.id,'synthetic-existing');assert.deepEqual(JSON.parse(JSON.stringify(writes)),[{table:'customers',payload:{full_name:'Synthetic changed name',address:'Synthetic new address'},field:'id',id:'synthetic-existing'}]);
});
test('inspected admin caller sends JSON without a bearer token',async()=>{
 const seen=[];const context=vm.createContext({console:{log(){},error(){}},alert(){throw Error('unexpected alert');},fetch:async(url,options)=>{seen.push({url,options});return {ok:true,status:200,json:async()=>({ok:true})};}});
 vm.runInContext('const ORDER_ACTION_API_URL="/admin-api/order-action";\n'+source('admin.html'),context);await context.callOrderAction({order_id:'synthetic',action:'accept'});
 assert.equal(seen.length,1);assert.deepEqual(JSON.parse(JSON.stringify(seen[0].options.headers)),{'Content-Type':'application/json'});
});
