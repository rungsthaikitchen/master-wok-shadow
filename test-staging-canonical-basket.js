'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {prepareStagingBasket}=require('./staging-canonical-basket');
const context=vm.createContext({window:{},Date});
vm.runInContext(fs.readFileSync(path.join(__dirname,'master-wok-model-bundle.js'),'utf8'),context);
const model=context.window.MasterWokModelV1;
const base={id:'staging-test-1',createdAt:'2026-10-30T17:15:00Z',serviceDate:'2026-10-30',
 readyMinute:1055,items:[{item_id:'green-curry',qty:2,modifiers:[{id:'chicken'}]},
 {item_id:'pad-thai',qty:1,modifiers:[{id:'chicken'}]},
 {item_id:'stir-crispy',qty:1,modifiers:[]}],model};
const result=prepareStagingBasket(base);
assert.equal(result.status,'PREPARED');
assert.equal(result.bookingApprovalAllowed,false);
assert.equal(result.rawRow.items.length,3);
assert.equal(result.candidate.readyMinute,1055);
assert.ok(result.candidate.classification);
assert.equal(prepareStagingBasket({...base,items:[]}).status,'UNVERIFIED');
assert.equal(prepareStagingBasket({...base,items:[{item_id:'not-on-menu',qty:1,modifiers:[]}]}).status,'UNVERIFIED');
assert.equal(prepareStagingBasket({...base,items:[{item_id:'green-curry',qty:0,modifiers:[]}]}).status,'UNVERIFIED');
assert.equal(prepareStagingBasket({...base,items:[{item_id:'green-curry',qty:1,modifiers:null}]}).status,'UNVERIFIED');
assert.equal(prepareStagingBasket({...base,createdAt:'invalid'}).status,'UNVERIFIED');
console.log('PASS: staging canonical basket preserves real dish lines and fails closed without booking authority');

