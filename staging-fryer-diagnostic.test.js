'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {diagnoseFryer}=require('./staging-fryer-diagnostic');
const orders=[{orderId:'a',readyMinute:1140}];
function run(items){return diagnoseFryer(orders,[{id:'a',items}]);}
test('crispy chicken requires fryer work',()=>{
 const r=run([{item_id:'stir-crispy',qty:2,modifiers:[]}]);
 assert.equal(r.status,'UNVERIFIED');
 assert.deepEqual(r.dependencies[0].counts,{crispyChicken:2});
 assert.equal(r.bookingApprovalAllowed,false);
});
test('chicken and chips pairing records both dependencies',()=>{
 const r=run([{item_id:'salt-chickenchips',qty:1,modifiers:[]}]);
 assert.deepEqual(r.dependencies[0].counts,{crispyChicken:1,chips:1});
});
test('tofu and battered chicken modifiers introduce fryer dependencies',()=>{
 const r=run([{item_id:'stir-basil',qty:2,modifiers:[{id:'tofu'},{id:'extra-bchicken'}]}]);
 assert.deepEqual(r.dependencies[0].counts,{tofu:2,batteredChicken:2});
});
test('fryer-only starters are not silently ignored',()=>{
 const r=run([{item_id:'veg-spring-rolls',qty:1,modifiers:[]}]);
 assert.equal(r.status,'UNVERIFIED');
 assert.equal(r.unmodelled[0].reason,'FRY_ONLY_TIMING_UNKNOWN');
});
test('plain curry has no recognised fryer dependency',()=>{
 const r=run([{item_id:'panang-curry',qty:1,modifiers:[]}]);
 assert.equal(r.status,'NO_RECOGNISED_FRY_DEPENDENCIES');
 assert.equal(r.bookingApprovalAllowed,false);
});
