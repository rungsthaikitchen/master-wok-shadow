const {test}=require('node:test');
const assert=require('node:assert/strict');
const {analyze}=require('./audit.cjs');
test('HTML comments, JavaScript comments, inert templates and data scripts cannot become writer evidence',()=>{
 const hidden="sb.from('orders').insert({});";
 const src=`<!--<script>${hidden}</script>--><template><script>${hidden}</script></template><script type="application/json">{"example":"${hidden}"}</script><script>/* ${hidden} */ // ${hidden}\nwindow.sb.from('orders').upsert({});</script>`;
 assert.deepEqual(analyze(src).mutations.map(x=>[x.table,x.method]),[['orders','upsert']]);
});
test('strings that resemble writes are not calls; chained real item and status writes are inventoried',()=>{
 const a=analyze(`<script>const example="sb.from('orders').delete()";async function updateOrderStatus(id,status){await sb.from('orders').update({status}).eq('id',id);}window.sb.from('order_items').insert([]);</script>`);
 assert.deepEqual(a.mutations.map(x=>[x.table,x.method]),[['orders','update'],['order_items','insert']]);
 assert.ok(a.functions.updateOrderStatus);assert.equal(a.calls.includes('updateOrderStatus'),false);
});
test('computed and aliased calls are not silently described as a complete inventory',()=>{
 const a=analyze(`<script>const t=sb.from('orders'); t.update({}); sb['from']('orders')['update']({});</script>`);
 assert.deepEqual(a.mutations,[]);assert.equal(a.unresolvedMutationCalls.length,2);
});
test('external scripts are excluded from inline claims and malformed JavaScript fails review',()=>{
 assert.equal(analyze('<script src="remote.js"></script>').inlineScripts,0);
 assert.throws(()=>analyze('<script>function {</script>'));
 assert.equal(analyze("export function change(){sb.from('orders').update({});}",{html:false}).mutations.length,1);
});
