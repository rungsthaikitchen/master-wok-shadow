const test = require('node:test');
const assert = require('node:assert/strict');
const effective = require('./production-time-precedence.cjs');
const requested = '2026-10-21T17:00:00Z';
const oldConfirmed = '2026-10-21T17:30:00Z';
const offered = '2026-10-21T18:00:00Z';

test('first unconfirmed proposal moves capacity from original request', () => {
  assert.equal(effective({status:'proposed',preferred_time:requested,proposed_time:offered}),offered);
});
test('characterizes discrepancy: previous confirmation masks newer offer', () => {
  const actual=effective({status:'proposed',preferred_time:requested,confirmed_time:oldConfirmed,proposed_time:offered});
  assert.equal(actual,oldConfirmed);
  assert.notEqual(actual,offered); // approved rule requires offered immediately
});
test('characterizes discrepancy: Railway-style rejection can retain proposed capacity', () => {
  const actual=effective({status:'customer_declined_time',preferred_time:requested,proposed_time:offered});
  assert.equal(actual,offered);
  assert.notEqual(actual,null); // approved rule requires release
});
test('pending rejection convention releases only while no confirmation remains', () => {
  assert.equal(effective({status:'pending',preferred_time:requested,proposed_time:offered}),null);
  assert.equal(effective({status:'pending',preferred_time:requested,proposed_time:offered,confirmed_time:oldConfirmed}),oldConfirmed);
});
