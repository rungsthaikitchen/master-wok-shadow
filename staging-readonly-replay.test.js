'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {replay}=require('./staging-readonly-replay');
test('empty commitments replay without database writes',()=>{
 const result=replay({serviceDate:'2026-10-17',orders:[]});
 assert.equal(result.committed,0);
 assert.equal(result.excluded,0);
 assert.equal(typeof result.feasible,'boolean');
});
test('pending order excluded from commitments',()=>{
 const result=replay({serviceDate:'2026-10-17',orders:[{status:'pending'}]});
 assert.equal(result.committed,0);
 assert.equal(result.excluded,1);
});
test('unrecognised confirmed item fails closed',()=>{
 assert.throws(()=>replay({serviceDate:'2026-10-17',orders:[{
 id:'x',status:'confirmed',created_at:'2026-10-17T16:30:00Z',
 preferred_time:'2026-10-17T18:00:00Z',local_ready_minute:1140,
 local_service_date:'2026-10-17',items:[{item_id:'not-a-dish',qty:1,modifiers:[]}]
 }]}),/INVALID_ITEM/);
});

test('rice-only confirmed order is counted but needs no wok reservation',()=>{
 const result=replay({serviceDate:'2026-10-17',orders:[{
 id:'rice',status:'confirmed',created_at:'2026-10-17T16:30:00Z',
 preferred_time:'2026-10-17T18:00:00Z',local_ready_minute:1140,
 local_service_date:'2026-10-17',items:[{item_id:'jasmine-rice',qty:1,modifiers:[]}]
 }]});
 assert.equal(result.committed,1);
 assert.equal(result.noWokReservation,1);
 assert.equal(result.scheduled,0);
});
