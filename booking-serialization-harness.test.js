'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { SerialBookingHarness } = require('./booking-serialization-harness');
const date = '2026-10-30';
test('two simultaneous customers competing for final capacity: one commits', async () => {
  const harness = new SerialBookingHarness(async ({ acceptedOrders }) => {
    await Promise.resolve();
    return { status: acceptedOrders.length === 0 ? 'GREEN' : 'AMBER' };
  });
  const results = await Promise.all([
    harness.submit({ serviceDate: date, idempotencyKey:'first', candidate:{id:'first'} }),
    harness.submit({ serviceDate: date, idempotencyKey:'second', candidate:{id:'second'} })
  ]);
  assert.equal(results.filter(r=>r.committed).length,1);
  assert.equal(harness.count(date),1);
});
test('concurrent identical retries commit once', async () => {
  const harness = new SerialBookingHarness(async () => ({status:'GREEN'}));
  const request={serviceDate:date,idempotencyKey:'same',candidate:{id:'one'}};
  const results=await Promise.all([harness.submit(request),harness.submit(request)]);
  assert.deepEqual(results[0],results[1]);
  assert.equal(harness.count(date),1);
});
test('reused key with different basket is rejected', async () => {
  const harness=new SerialBookingHarness(async()=>({status:'GREEN'}));
  await harness.submit({serviceDate:date,idempotencyKey:'same',candidate:{id:'one'}});
  const result=await harness.submit({serviceDate:date,idempotencyKey:'same',candidate:{id:'two'}});
  assert.equal(result.reason,'IDEMPOTENCY_CONFLICT');
  assert.equal(harness.count(date),1);
});
test('AMBER, UNVERIFIED and thrown assessment never commit', async () => {
  for(const assess of [async()=>({status:'AMBER'}),async()=>({status:'UNVERIFIED'}),async()=>{throw Error('failure');}]) {
    const harness=new SerialBookingHarness(assess);
    const result=await harness.submit({serviceDate:date,idempotencyKey:'x',candidate:{id:'x'}});
    assert.equal(result.committed,false);
    assert.equal(harness.count(date),0);
  }
});
