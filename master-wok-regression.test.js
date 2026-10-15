const path = require('node:path');
const fs = require('fs');
const vm = require('vm');
const assert = require('node:assert/strict');

function createKitchen() {
  const ctx = { window: {} };
  vm.createContext(ctx);

  vm.runInContext(
    fs.readFileSync(path.join(__dirname, 'master-wok-model-bundle.js'), 'utf8'),
    ctx
  );

  vm.runInContext(
    fs.readFileSync(path.join(__dirname, 'master-wok.js'), 'utf8'),
    ctx
  );

  return ctx;
}

function test(name, source, expectedFeasible) {
  const ctx = createKitchen();
  const result = vm.runInContext(source, ctx);

  assert.equal(result.feasible, expectedFeasible);
  assert.equal(result.exhausted, false);

  if (result.feasible) {
    assert.equal(result.timeline.length, result.jobs.length);

    const timeline = [...result.timeline]
      .sort((a, b) => a.start - b.start);

    for (let i = 0; i < timeline.length; i++) {
      const job = timeline[i];

      assert.ok(job.start < job.finish);
      assert.equal(job.finish - job.start, job.duration);
      assert.ok(job.finish <= job.ready);
      assert.equal(job.holdingMinutes, job.ready - job.finish);
      assert.ok(job.holdingMinutes >= 0);
      assert.ok(job.holdingMinutes <= 10);

      if (i > 0) {
        assert.ok(
          timeline[i - 1].finish <= job.start,
          'Cooking reservations must not overlap'
        );
      }
    }
  }

  console.log('PASS:', name);
}

const setup = `
  const model = window.MasterWokModelV1;

  const classification = model.classifyBasket([
    { itemId: 'pad-thai', qty: 2, mods: {} }
  ]);

  const reservations = ['A', 'B'].map(id => ({
    orderId: id,
    classification,
    placedAt: new Date(2026, 9, 14, 18, 0),
    readyMinute: 1110
  }));
`;

test(
  'Two Pad Thai orders with 10-minute holding',
  setup + `
    window.MasterWokV1.schedule(reservations, {
      asOfMinute: 1080,
      maxHoldingMinutes: 10,
      blockedIntervals: []
    });
  `,
  true
);

test(
  'Two Pad Thai orders without holding',
  setup + `
    window.MasterWokV1.schedule(reservations, {
      asOfMinute: 1080,
      maxHoldingMinutes: 0,
      blockedIntervals: []
    });
  `,
  false
);

test(
  'Three Pad Thai orders at the same ready time',
  setup + `
    reservations.push({
      orderId: 'C',
      classification,
      placedAt: new Date(2026, 9, 14, 18, 0),
      readyMinute: 1110
    });

    window.MasterWokV1.schedule(reservations, {
      asOfMinute: 1080,
      maxHoldingMinutes: 10,
      blockedIntervals: []
    });
  `,
  false
);


const blackoutSetup = `
  const classification =
    window.MasterWokModelV1.classifyBasket([
      { itemId: 'pad-thai', qty: 1, mods: {} }
    ]);

  const reservations = [{
    orderId: 'BLACKOUT-TEST',
    classification,
    placedAt: new Date(2026, 9, 14, 18, 0),
    readyMinute: 1110
  }];
`;

test(
  'Blackout overlapping every cooking slot is rejected',
  blackoutSetup + `
    window.MasterWokV1.schedule(reservations, {
      asOfMinute: 1080,
      maxHoldingMinutes: 10,
      blockedIntervals: [
        { start: 1095, finish: 1105 }
      ]
    });
  `,
  false
);

test(
  'Cooking can finish exactly when blackout begins',
  blackoutSetup + `
    window.MasterWokV1.schedule(reservations, {
      asOfMinute: 1080,
      maxHoldingMinutes: 10,
      blockedIntervals: [
        { start: 1100, finish: 1110 }
      ]
    });
  `,
  true
);


function testExistingPlan(name, scenario, verify) {
  const ctx = createKitchen();
  const result = vm.runInContext(scenario, ctx);
  verify(result);
  console.log('PASS:', name);
}

const existingPlanSetup = `
  const classification =
    window.MasterWokModelV1.classifyBasket([
      { itemId: 'pad-thai', qty: 1, mods: {} }
    ]);

  const acceptedOrders = [{
    orderId: 'EXISTING-A',
    classification,
    placedAt: new Date(2026, 9, 14, 18, 0),
    readyMinute: 1100
  }];

  const committedTimeline = [{
    id: 'EXISTING-A',
    start: 1090,
    finish: 1100,
    ready: 1100,
    duration: 10,
    holdingMinutes: 0
  }];
`;

testExistingPlan(
  'Already-started cooking remains protected',
  existingPlanSetup + `
    window.MasterWokV1.scheduleFromExistingPlanV1({
      acceptedOrders,
      committedTimeline,
      proposedOrder: {
        orderId: 'NEW-B',
        classification,
        placedAt: new Date(2026, 9, 14, 18, 15),
        readyMinute: 1105
      },
      asOfMinute: 1095
    });
  `,
  result => {
    assert.equal(result.status, 'NO_FIT');
    assert.equal(result.feasible, false);
    assert.equal(result.diagnostics.exhausted, false);
    assert.equal(result.protectedJobs.length, 1);
    assert.equal(result.protectedJobs[0].id, 'EXISTING-A');
    assert.equal(result.protectedJobs[0].start, 1090);
    assert.equal(result.protectedJobs[0].finish, 1100);
  }
);

testExistingPlan(
  'Future cooking rearranged without delaying customers',
  `
    const classification =
      window.MasterWokModelV1.classifyBasket([
        { itemId: 'pad-thai', qty: 1, mods: {} }
      ]);

    window.MasterWokV1.scheduleFromExistingPlanV1({
      acceptedOrders: [{
        orderId: 'EXISTING-A',
        classification,
        placedAt: new Date(2026, 9, 14, 18, 0),
        readyMinute: 1110
      }],
      committedTimeline: [{
        id: 'EXISTING-A',
        start: 1100,
        finish: 1110,
        ready: 1110,
        duration: 10,
        holdingMinutes: 0
      }],
      proposedOrder: {
        orderId: 'NEW-B',
        classification,
        placedAt: new Date(2026, 9, 14, 18, 0),
        readyMinute: 1110
      },
      asOfMinute: 1080
    });
  `,
  result => {
    assert.equal(result.status, 'FEASIBLE');
    assert.equal(result.feasible, true);
    assert.equal(result.diagnostics.exhausted, false);
    assert.equal(result.movableOrders, 1);
    assert.equal(result.timeline.length, 2);

    const jobs = [...result.timeline].sort(
      (a, b) => a.start - b.start
    );

    assert.deepEqual(
      jobs.map(job => job.id),
      ['EXISTING-A', 'NEW-B']
    );

    assert.equal(jobs[0].start, 1090);
    assert.equal(jobs[0].finish, 1100);
    assert.equal(jobs[1].start, 1100);
    assert.equal(jobs[1].finish, 1110);
    assert.ok(jobs.every(job => job.ready === 1110));
  }
);




const validationSetup = `
  const classification =
    window.MasterWokModelV1.classifyBasket([
      { itemId: 'pad-thai', qty: 1, mods: {} }
    ]);

  const makeOrder = id => ({
    orderId: id,
    classification,
    placedAt: new Date(2026, 9, 14, 18, 0),
    readyMinute: 1110
  });
`;

function testInvalidPlan(name, scenario, expectedReason) {
  const ctx = createKitchen();
  const result = vm.runInContext(
    validationSetup + scenario,
    ctx
  );

  assert.equal(result.status, 'UNVERIFIED');
  assert.equal(result.feasible, false);
  assert.equal(result.reason, expectedReason);
  assert.equal(result.timeline.length, 0);

  console.log('PASS:', name);
}

testInvalidPlan(
  'Overlapping existing commitments rejected',
  `
    window.MasterWokV1.scheduleFromExistingPlanV1({
      acceptedOrders: [
        makeOrder('EXISTING-A'),
        makeOrder('EXISTING-B')
      ],
      committedTimeline: [
        {
          id: 'EXISTING-A',
          start: 1090,
          finish: 1100,
          ready: 1110
        },
        {
          id: 'EXISTING-B',
          start: 1095,
          finish: 1105,
          ready: 1110
        }
      ],
      proposedOrder: makeOrder('NEW-C'),
      asOfMinute: 1080
    });
  `,
  'Invalid or conflicting existing allocation'
);

testInvalidPlan(
  'Incomplete existing plan rejected',
  `
    window.MasterWokV1.scheduleFromExistingPlanV1({
      acceptedOrders: [
        makeOrder('EXISTING-A'),
        makeOrder('EXISTING-B')
      ],
      committedTimeline: [{
        id: 'EXISTING-A',
        start: 1090,
        finish: 1100,
        ready: 1110
      }],
      proposedOrder: makeOrder('NEW-C'),
      asOfMinute: 1080
    });
  `,
  'Existing plan does not match accepted orders'
);

testInvalidPlan(
  'Excessive food holding rejected',
  `
    window.MasterWokV1.scheduleFromExistingPlanV1({
      acceptedOrders: [makeOrder('EXISTING-A')],
      committedTimeline: [{
        id: 'EXISTING-A',
        start: 1085,
        finish: 1095,
        ready: 1110
      }],
      proposedOrder: makeOrder('NEW-B'),
      asOfMinute: 1080
    });
  `,
  'Existing plan exceeds maximum holding time'
);


const mixedSetup = `
  const mixedClassification =
    window.MasterWokModelV1.classifyBasket([
      { itemId: 'green-curry', qty: 1, mods: {} },
      { itemId: 'pad-thai', qty: 1, mods: {} },
      { itemId: 'beef-salad', qty: 1, mods: {} }
    ]);

  const mixedReservations = ['A', 'B', 'C'].map(id => ({
    orderId: id,
    classification: mixedClassification,
    placedAt: new Date(2026, 9, 14, 18, 0),
    readyMinute: 1110
  }));
`;

test(
  'Three simultaneous mixed orders rejected',
  mixedSetup + `
    window.MasterWokV1.schedule(mixedReservations, {
      asOfMinute: 1080,
      maxHoldingMinutes: 10
    });
  `,
  false
);

test(
  'Staggered mixed orders accommodated',
  mixedSetup + `
    mixedReservations[2].readyMinute = 1120;
    window.MasterWokV1.schedule(mixedReservations, {
      asOfMinute: 1080,
      maxHoldingMinutes: 10
    });
  `,
  true
);

console.log('All Master Wok regression tests passed.');


// MASTER WOK SERVICE DATE REGRESSION TESTS

test(
  'Previous-day preorder can be cooked on service date',
  `
    const classification =
      window.MasterWokModelV1.classifyBasket([
        { itemId: 'pad-thai', qty: 1, mods: {} }
      ]);

    window.MasterWokV1.schedule([{
      orderId: 'ADVANCE',
      classification,
      placedAt: new Date(2026, 8, 17, 18, 41),
      readyMinute: 1050
    }], {
      serviceDate: '2026-09-18'
    });
  `,
  true
);

test(
  'Same-day late order cannot bypass placement time',
  `
    const classification =
      window.MasterWokModelV1.classifyBasket([
        { itemId: 'pad-thai', qty: 1, mods: {} }
      ]);

    window.MasterWokV1.schedule([{
      orderId: 'TOO-LATE',
      classification,
      placedAt: new Date(2026, 8, 18, 17, 25),
      readyMinute: 1050
    }], {
      serviceDate: '2026-09-18'
    });
  `,
  false
);

{
  const ctx = createKitchen();

  assert.throws(
    () => vm.runInContext(`
      const classification =
        window.MasterWokModelV1.classifyBasket([
          { itemId: 'pad-thai', qty: 1, mods: {} }
        ]);

      window.MasterWokV1.schedule([{
        orderId: 'FUTURE',
        classification,
        placedAt: new Date(2026, 8, 19, 12, 0),
        readyMinute: 1050
      }], {
        serviceDate: '2026-09-18'
      });
    `, ctx),
    /order placed after service date/
  );

  console.log('PASS: Order placed after service date rejected');
}
