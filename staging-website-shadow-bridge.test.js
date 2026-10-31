'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {compareWebsiteShadow,normalize}=require('./staging-website-shadow-bridge');
const date='2026-10-17';
function row(id,minute=1140,mods=[]){const hh=String(Math.floor(minute/60)).padStart(2,'0');const mm=String(minute%60).padStart(2,'0');return {id,status:'confirmed',created_at:date+'T17:30:00+01:00',preferred_time:date+'T'+hh+':'+mm+':00+01:00',order_items:[{item_id:'panang-curry',qty:1,modifiers:mods}]};}
test('converts website order into local clock and item details',()=>{const x=normalize(row('a'));assert.equal(x.order.readyMinute,1140);assert.equal(x.row.items[0].item_id,'panang-curry');});
test('shadow result never approves booking or changes legacy availability',()=>{const x=compareWebsiteShadow({committedRows:[],candidateRow:row('a'),legacyDecision:true});assert.equal(x.bookingApprovalAllowed,false);assert.equal(x.legacyAvailabilityUnchanged,true);assert.equal(x.legacyDecision,true);});
test('missing dish detail fails closed',()=>{const c=row('a');delete c.order_items[0].modifiers;const x=compareWebsiteShadow({committedRows:[],candidateRow:c});assert.equal(x.status,'UNVERIFIED');assert.equal(x.reason,'MISSING_DISH_DETAIL');});
test('cancelled committed orders are excluded',()=>{const c=row('old');c.status='cancelled';c.order_items=[];const x=compareWebsiteShadow({committedRows:[c],candidateRow:row('new')});assert.equal(x.committedOrders,0);});
test('duplicate candidate fails closed',()=>{const x=compareWebsiteShadow({committedRows:[row('a')],candidateRow:row('a')});assert.equal(x.status,'UNVERIFIED');});
