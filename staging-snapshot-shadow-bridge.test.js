'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {compareStagingSnapshot,toWebsiteShape}=require('./staging-snapshot-shadow-bridge');
function row(id){return {id,status:'confirmed',created_at:'2026-10-17T17:30:00+01:00',preferred_time:'2026-10-17T19:00:00+01:00',items:[{item_id:'panang-curry',qty:1,modifiers:[]}]};}
test('staging SQL items are mapped without changing dish details',()=>{const r=row('a');const x=toWebsiteShape(r);assert.deepEqual(x.order_items,r.items);assert.equal(r.order_items,undefined);});
test('staging snapshot is assessed read-only without booking approval',()=>{const result=compareStagingSnapshot({committedRows:[],candidateRow:row('new'),legacyDecision:false});assert.equal(result.bookingApprovalAllowed,false);assert.equal(result.legacyAvailabilityUnchanged,true);assert.equal(result.legacyDecision,false);});
test('missing staging items fail closed',()=>{const r=row('new');delete r.items;const result=compareStagingSnapshot({committedRows:[],candidateRow:r});assert.equal(result.status,'UNVERIFIED');assert.equal(result.reason,'INCOMPLETE_STAGING_SNAPSHOT');});
test('incomplete committed staging row fails closed',()=>{const r=row('old');delete r.items;const result=compareStagingSnapshot({committedRows:[r],candidateRow:row('new')});assert.equal(result.status,'UNVERIFIED');});
