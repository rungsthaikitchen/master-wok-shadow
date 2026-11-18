'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {reviewWorkload}=require('./master-wok-workload-review');
const job=(itemId,vessel,start=0,finish=5)=>({itemId,vessel,start,finish});
test('salad and hot work are assigned to the same chef and flagged for review',()=>{
 const p={wok:{jobs:[job('beef-salad','cold-prep-1'),job('stir-basil','small-1')]}};const before=JSON.stringify(p);
 const r=reviewWorkload(p);assert.equal(r.intervals[0].chef,'Rung');assert.ok(r.intervals[0].reviewReasons.includes('SALAD_AND_HOT_WORK_SHARE_CHEF'));
 assert.equal(r.bookingApprovalAllowed,false);assert.equal(JSON.stringify(p),before);
});
test('curry estimate applies to the complete cook without inventing exclusive effort',()=>{
 const r=reviewWorkload({wok:{jobs:[job('green-curry','pan-1'),job('red-curry','pan-2'),job('beef-salad','cold-prep-1',2,4)]}});
 const interval=r.intervals.find(i=>i.start===2);assert.equal(interval.finish,4);
 assert.deepEqual(interval.curryEstimates[0].handsOnMinutes,{minimum:3,maximum:4});
 assert.equal(interval.curryEstimates[0].estimateScope,'WHOLE_COOK');assert.equal(r.exclusiveLabourCapacityAssumed,false);
 assert.equal(interval.curries,2);assert.ok(interval.reviewReasons.includes('CONCURRENT_CURRY_ATTENTION_UNCALIBRATED'));
});
test('does not extrapolate a five-minute estimate or count touching intervals as overlap',()=>{
 const r=reviewWorkload({wok:{jobs:[job('green-curry','pan-1',0,6),job('stir-basil','small-1',6,11)]}});
 assert.equal(r.intervals.length,1);assert.equal(r.intervals[0].woks,0);assert.equal(r.intervals[0].curryEstimates[0].handsOnMinutes,null);
});
test('missing and invalid plans are rejected',()=>{
 assert.throws(()=>reviewWorkload({}),/MISSING/);assert.throws(()=>reviewWorkload({wok:{jobs:[job('x','pan-1',5,0)]}}),/INVALID/);
});
