'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
require('./master-wok-model-bundle');
const {prepareStagingBasket}=require('./staging-canonical-basket');
const model=globalThis.MasterWokModelV1;
const items=[['veg-spring-rolls',3,null,0],['tom-yum',2,'prawn',2],['salt-chickenchips',2,null,1],['salt-chickenchips',4,null,1],['beef-salad',2,null,2]].map(([item_id,qty,p,spice])=>({item_id,qty,modifiers:p?[{id:p}]:[],spice}));
function permutations(a){return a.length?a.flatMap((x,i)=>permutations(a.filter((_,j)=>j!==i)).map(rest=>[x,...rest])):[[]];}
test('all 120 add-to-basket orders produce identical scheduling input without merging lines or changing customer data',()=>{
 const prepare=items=>prepareStagingBasket({id:'candidate',createdAt:'2026-11-17T12:00:00Z',serviceDate:'2026-11-21',readyMinute:1100,items,model});
 const original=JSON.stringify(items),expected=prepare(items);
 assert.equal(expected.status,'PREPARED');assert.equal(expected.rawRow.items.length,5);
 assert.equal(expected.rawRow.items.reduce((n,l)=>n+l.qty,0),13);
 for(const permutation of permutations(items)){
  const before=JSON.stringify(permutation),r=prepare(permutation);
  assert.deepEqual(r.rawRow,expected.rawRow);assert.deepEqual(r.candidate.classification,expected.candidate.classification);
  assert.equal(JSON.stringify(permutation),before);
 }
 assert.equal(JSON.stringify(items),original);
 assert.deepEqual(expected.rawRow.items.filter(l=>l.item_id==='salt-chickenchips').map(l=>l.qty),[2,4]);
});
test('spice, notes and modifier distinctions survive stable scheduling order',()=>{
 const lines=[{item_id:'tom-yum',qty:1,modifiers:[{id:'prawn'}],spice:2,item_note:'first'},
  {item_id:'tom-yum',qty:1,modifiers:[{id:'chicken'}],spice:1,item_note:'second'}];
 const r=prepareStagingBasket({id:'candidate',createdAt:'2026-11-17T12:00:00Z',serviceDate:'2026-11-21',readyMinute:1100,items:lines,model});
 assert.equal(r.status,'PREPARED');assert.equal(r.rawRow.items.length,2);
 assert.deepEqual(r.rawRow.items.find(l=>l.modifiers[0].id==='prawn'),lines[0]);
});
