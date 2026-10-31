'use strict';
const assert=require('node:assert/strict');
const {extractMenuLoads,audit}=require('./audit-legacy-menu-loads');
const menu=`const MENU_CATEGORIES = [
 { id:'starters', title:'Starter', allowExtras:false, items:[
  { id:'spring-rolls', name:'Rolls' },
  { id:'salt-chicken', kitchenLoad:0 },
 ]},
 { id:'curry', title:'Curry', allowExtras:true, items:[
  { id:'panang-curry', name:'Panang' },
 ]},
 // filler menu entries for completeness threshold
${Array.from({length:20},(_,i)=>`  { id:'test-item-${i}', name:'Test' },`).join('\n')}
 ];\nconst MODIFIERS = [\n { id:'panang-curry', name:'Duplicate modifier' },\n ];`;
const catalog=extractMenuLoads(menu);
assert.equal(catalog.get('spring-rolls').kitchenLoad,0);
assert.equal(catalog.get('salt-chicken').source,'EXPLICIT_MENU_OVERRIDE');
assert.equal(catalog.get('panang-curry').kitchenLoad,1);
const result=audit({orders:[{id:'A',items:[{item_id:'panang-curry',qty:2},{item_id:'spring-rolls',qty:1}]}]},menu);
assert.equal(result.orders[0].estimatedKitchenLoad,2);
assert.equal(result.comparisonVerified,false);
assert.equal(result.bookingApprovalAllowed,false);
assert.equal(audit({orders:[{id:'B',items:[{item_id:'unknown',qty:1}]}]},menu).status,'UNVERIFIED');
console.log('PASS: website menu audit derives loads, preserves overrides and marks estimates unverified');
