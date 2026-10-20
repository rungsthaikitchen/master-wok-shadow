const test=require('node:test');
const assert=require('node:assert/strict');
const original=require('../fixtures/booking-store-staging-capture.json');
const {replay,validateEventBatch}=require('../master-wok-chronological-replay.js');
function batch(events){return {...structuredClone(original),events,coverage:{...original.coverage,eventCount:events.length,lastSequence:events.length}};}
function close(status){const events=structuredClone(original.events.slice(0,6));events.push({eventId:'terminal',sequence:7,at:original.events[6].at,kind:'ORDER_STATE_CHANGED',orderId:events[0].order.orderId,status});return batch(events);}
for(const status of ['CANCELLED','COMPLETED']) test(`rejected proposal then ${status} records status without capacity`,()=>{
 const input=close(status);assert.equal(validateEventBatch(input).length,7);
 const result=replay(input,{enabled:true});assert.equal(result.status,'REPLAYED');assert.equal(result.remainingCommitments,0);assert.equal(result.decisionCount,3);assert.equal(result.verified,false);
});
test('status-only closure refuses unknown order and active reservation',()=>{
 const unknown=close('CANCELLED');unknown.events[6].orderId='unknown';assert.throws(()=>validateEventBatch(unknown),/ORDER_STATE_CHANGE_REQUIRED/);
 const active=close('CANCELLED');active.events[5].response='ACCEPTED';assert.throws(()=>validateEventBatch(active),/ORDER_STATE_CHANGE_REQUIRED/);
});
test('missing reservation release remains an error',()=>{
 const input=close('CANCELLED');const e=input.events[6];e.kind='RESERVATION_RELEASED';e.reason=e.status;delete e.status;
 assert.throws(()=>validateEventBatch(input),/UNKNOWN_RESERVATION_RELEASE/);
});
test('closed order cannot be reserved again',()=>{
 const input=close('CANCELLED');const e=structuredClone(original.events[6]);e.sequence=8;e.eventId='reopen';input.events.push(e);input.coverage.eventCount=8;input.coverage.lastSequence=8;
 assert.throws(()=>validateEventBatch(input),/ORDER_ALREADY_CLOSED/);
});
test('actual rolled-back staging capture replays both terminal status changes',()=>{
 const input=require('../fixtures/order-state-change-staging-capture.json');
 assert.equal(validateEventBatch(input).length,8);
 const result=replay(input,{enabled:true});assert.equal(result.status,'REPLAYED');assert.equal(result.decisionCount,2);assert.equal(result.remainingCommitments,0);assert.equal(result.verified,false);
});
