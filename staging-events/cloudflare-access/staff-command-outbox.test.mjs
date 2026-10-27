import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createStaffIntentStore} from './staff-command-outbox.mjs';
const input={orderId:'12345678-1234-1234-1234-123456789abc',expectedRevision:2,action:'offer',target:'2026-10-28T19:30:00Z'};
function storage(){const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};}
test('reload resumes exact persisted command; new intent after acknowledgement has a different ID',()=>{
 const s=storage(),first=createStaffIntentStore(s),c=first.begin(input),reloaded=createStaffIntentStore(s);
 assert.deepEqual(reloaded.resume(),c);assert.throws(()=>reloaded.begin(input),/STAFF_INTENT_PENDING/);
 assert.throws(()=>reloaded.acknowledge(c.commandId,{status:'FAILED'}),/STAFF_INTENT_ACK_REFUSED/);assert.deepEqual(reloaded.resume(),c);
 reloaded.acknowledge(c.commandId,{status:'ALREADY_RECORDED',revision:3});assert.equal(first.resume(),null);
 const next=first.begin({...input,expectedRevision:3});assert.notEqual(next.commandId,c.commandId);
});
test('storage failure or corruption refuses before returning a sendable new command',()=>{
 assert.throws(()=>createStaffIntentStore({getItem:()=>null,setItem(){throw Error('QUOTA');}}).begin(input),/QUOTA/);
 assert.throws(()=>createStaffIntentStore({getItem:()=>null,setItem(){}}).begin(input),/STAFF_INTENT_NOT_PERSISTED/);
 assert.throws(()=>createStaffIntentStore({getItem:()=>'{bad'}).resume(),/STAFF_INTENT_STORAGE_REFUSED/);
});
test('caller cannot choose command identity or persist extra identity fields',()=>{
 const s=storage(),store=createStaffIntentStore(s);
 for(const extra of [{commandId:'chosen'},{version:1},{actorId:'a'.repeat(64)}])assert.throws(()=>store.begin({...input,...extra}),/STAFF_COMMAND_REQUIRED/);assert.equal(store.resume(),null);
});
