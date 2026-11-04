'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { interpretCapacityAssessment, assessCandidate } = require('./go-live-capacity-adapter');
test('GREEN is a candidate, never an automatic booking commit', () => {
  assert.deepEqual(interpretCapacityAssessment({status:'GREEN'}), {status:'GREEN',action:'CANDIDATE',reason:'CAPACITY_FITS',canAutoCommit:false});
});
test('AMBER and UNVERIFIED require review', () => {
  for (const status of ['AMBER','UNVERIFIED']) {
    const result = interpretCapacityAssessment({status});
    assert.equal(result.action,'REVIEW');
    assert.equal(result.canAutoCommit,false);
  }
});
test('missing inputs and engine exceptions fail closed', () => {
  assert.equal(assessCandidate(null,{}).status,'UNVERIFIED');
  assert.equal(assessCandidate({assessCapacityV1(){throw Error('private');}},{acceptedOrders:[],proposedOrder:{}}).reason,'ASSESSMENT_FAILED');
});
test('passes candidate and commitments to core assessment', () => {
  const acceptedOrders=[{id:'old'}],proposedOrder={id:'new'};
  const result=assessCandidate({assessCapacityV1(args){assert.equal(args.acceptedOrders,acceptedOrders);assert.equal(args.proposedOrder,proposedOrder);return {status:'GREEN'};}},{acceptedOrders,proposedOrder,asOfMinute:100});
  assert.equal(result.action,'CANDIDATE');
});
