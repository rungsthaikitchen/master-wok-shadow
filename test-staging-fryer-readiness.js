'use strict';
const assert=require('node:assert/strict');
const {assess}=require('./staging-fryer-readiness');
const base={placedMinute:1035,orderId:'offline-candidate'};
assert.equal(assess({...base,cycles:[{start:1035,finish:1040,basket:'large',orderIds:['offline-candidate']}]}).status,'COLD_FRYER_NOT_READY_IN_TIME');
assert.equal(assess({...base,cycles:[{start:1040,finish:1045,basket:'large',orderIds:['offline-candidate']}]}).status,'COLD_FRYER_READY_IN_TIME');
assert.equal(assess({...base,cycles:[{start:1040,finish:1045,basket:'large'}]}).status,'UNVERIFIED');
assert.equal(assess({...base,cycles:[]}).status,'NO_CANDIDATE_FRY_CYCLES');
assert.equal(assess({...base,cycles:[{start:1030,finish:1035,basket:'large',orderIds:['other']}]}).status,'NO_CANDIDATE_FRY_CYCLES');
console.log('PASS: cold fryer readiness diagnostic remains offline and non-authoritative');

