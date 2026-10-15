
const path = require('node:path');
const fs = require('fs');
const vm = require('vm');
const assert = require('node:assert/strict');

const modelSource = fs.readFileSync(path.join(__dirname, 'master-wok-model-bundle.js'), 'utf8'
);
const shadowSource = fs.readFileSync(path.join(__dirname, 'master-wok-shadow.js'), 'utf8'
);

function createContext(orders, itemCount) {
  let scheduleCalls = 0;

  const sb = {
    from(table) {
      if (table === 'orders') {
        return {
          select() {
            return {
              eq() {
                return {
                  order() {
                    return {
                      async range(start, end) {
                        return {
                          data: orders.slice(start, end + 1),
                          count: orders.length,
                          error: null
                        };
                      }
                    };
                  }
                };
              }
            };
          }
        };
      }

      if (table === 'order_items') {
        return {
          select() {
            return {
              async in() {
                return { count: itemCount, error: null };
              }
            };
          }
        };
      }

      throw new Error('Unexpected table: ' + table);
    }
  };

  const ctx = {
    window: {
      sb,
      MasterWokV1: {
        config: { kitchenStartMinute: 1020 },
        schedule() {
          scheduleCalls++;
          return {
            feasible: true,
            exhausted: false,
            timeline: [],
            nodes: 1
          };
        }
      }
    },
    console
  };

  vm.createContext(ctx);
  vm.runInContext(modelSource, ctx);
  vm.runInContext(shadowSource, ctx);

  return {
    shadow: ctx.window.MasterWokShadowV1,
    getScheduleCalls: () => scheduleCalls
  };
}

async function testSuccessfulLoadReachesScheduler() {
  const { shadow, getScheduleCalls } = createContext([], 0);

  const loaded = await shadow.loadReservationsStrictV1(
    '2026-10-14'
  );

  assert.equal(
    loaded.status,
    'VALIDATED_RETRIEVED_ORDERS'
  );
  assert.equal(loaded.verified, false);

  const assessed = await shadow.assessHypotheticalV1(
    '2026-10-14'
  );

  assert.equal(getScheduleCalls(), 1);
  assert.equal(assessed.status, 'UNVERIFIED');
  assert.equal(assessed.verified, false);
  assert.equal(assessed.hypothetical.feasible, true);

  console.log(
    'PASS: Validated data reaches hypothetical scheduler'
  );
}


async function testPaginationSafeguards() {
  const orders = Array.from({ length: 501 }, (_, i) => ({
    id: 'TEST-' + String(i).padStart(4, '0'),
    created_at: '2026-10-14T16:00:00',
    preferred_time: '2026-10-14T18:30:00',
    proposed_time: null,
    confirmed_time: null,
    status: 'cancelled',
    order_items: [{
      item_id: 'salt-chicken',
      qty: 1,
      modifiers: [],
      spice: 1,
      kitchen_load: 1
    }]
  }));

  async function runScenario(scenario, expectedStatus, expectedReason) {
    let pageCalls = 0;
    let itemBatchCalls = 0;

    const sb = {
      from(table) {
        if (table === 'orders') {
          return {
            select() {
              return {
                eq() {
                  return {
                    order() {
                      return {
                        async range(start, end) {
                          pageCalls++;

                          if (scenario === 'database-error') {
                            return {
                              data: null,
                              count: null,
                              error: { message: 'Simulated failure' }
                            };
                          }

                          if (scenario === 'missing-page' && start > 0) {
                            return { data: [], count: 501, error: null };
                          }

                          let page = orders.slice(start, end + 1);

                          if (scenario === 'duplicate' && start > 0) {
                            page = [{ ...page[0], id: orders[0].id }];
                          }

                          return {
                            data: page,
                            count:
                              scenario === 'changing-count' && start > 0
                                ? 502
                                : 501,
                            error: null
                          };
                        }
                      };
                    }
                  };
                }
              };
            }
          };
        }

        if (table === 'order_items') {
          return {
            select() {
              return {
                async in(field, ids) {
                  assert.equal(field, 'order_id');
                  assert.ok(ids.length <= 100);
                  itemBatchCalls++;
                  return { count: ids.length, error: null };
                }
              };
            }
          };
        }

        throw new Error('Unexpected table: ' + table);
      }
    };

    const ctx = { window: { sb }, console };
    vm.createContext(ctx);
    vm.runInContext(modelSource, ctx);
    vm.runInContext(shadowSource, ctx);

    const result =
      await ctx.window.MasterWokShadowV1.loadReservationsStrictV1(
        '2026-10-14'
      );

    assert.equal(result.status, expectedStatus, result.reason);

    if (expectedReason) {
      assert.equal(result.reason, expectedReason);
    }

    if (scenario === 'complete') {
      assert.equal(pageCalls, 2);
      assert.equal(itemBatchCalls, 6);
      assert.equal(result.queriedOrders, 501);
      assert.equal(result.excludedOrders.cancelled, 501);
      assert.equal(result.orderCount, 0);
      assert.equal(result.verified, false);
    }
  }

  await runScenario('complete', 'VALIDATED_RETRIEVED_ORDERS');
  console.log('PASS: Complete two-page retrieval');

  await runScenario(
    'duplicate', 'UNVERIFIED', 'Missing or duplicate order ID'
  );
  console.log('PASS: Duplicate order ID rejected');

  await runScenario(
    'changing-count', 'UNVERIFIED',
    'Order count changed during loading'
  );
  console.log('PASS: Changing database count rejected');

  await runScenario(
    'missing-page', 'UNVERIFIED', 'Missing order page'
  );
  console.log('PASS: Missing page rejected');

  await runScenario(
    'database-error', 'UNVERIFIED',
    'Database error: Simulated failure'
  );
  console.log('PASS: Database error rejected');
}


async function testItemCountBatching() {
  const orders = Array.from({ length: 205 }, (_, i) => ({
    id: 'TEST-' + String(i).padStart(4, '0'),
    created_at: '2026-10-14T16:00:00',
    preferred_time: '2026-10-14T18:30:00',
    proposed_time: null,
    confirmed_time: null,
    status: 'cancelled',
    order_items: [{
      item_id: 'salt-chicken',
      qty: 1,
      modifiers: [],
      spice: 1,
      kitchen_load: 1
    }]
  }));

  async function runScenario(scenario, expectedStatus, expectedReason) {
    const batchSizes = [];

    const sb = {
      from(table) {
        if (table === 'orders') {
          return {
            select() {
              return {
                eq() {
                  return {
                    order() {
                      return {
                        async range(start, end) {
                          return {
                            data: orders.slice(start, end + 1),
                            count: orders.length,
                            error: null
                          };
                        }
                      };
                    }
                  };
                }
              };
            }
          };
        }

        if (table === 'order_items') {
          return {
            select() {
              return {
                async in(field, ids) {
                  assert.equal(field, 'order_id');
                  assert.ok(ids.length <= 100);

                  batchSizes.push(ids.length);
                  const batchNumber = batchSizes.length;

                  if (scenario === 'failure' && batchNumber === 2) {
                    return {
                      count: null,
                      error: { message: 'Simulated failure' }
                    };
                  }

                  return {
                    count:
                      scenario === 'mismatch' && batchNumber === 3
                        ? ids.length - 1
                        : ids.length,
                    error: null
                  };
                }
              };
            }
          };
        }

        throw new Error('Unexpected table: ' + table);
      }
    };

    const ctx = { window: { sb }, console };
    vm.createContext(ctx);
    vm.runInContext(modelSource, ctx);
    vm.runInContext(shadowSource, ctx);

    const result =
      await ctx.window.MasterWokShadowV1.loadReservationsStrictV1(
        '2026-10-14'
      );

    assert.equal(result.status, expectedStatus, result.reason);

    if (expectedReason) {
      assert.equal(result.reason, expectedReason);
    }

    if (scenario === 'complete') {
      assert.deepEqual(batchSizes, [100, 100, 5]);
      assert.equal(result.queriedOrders, 205);
      assert.equal(result.excludedOrders.cancelled, 205);
      assert.equal(result.orderCount, 0);
      assert.equal(result.verified, false);
    }

    if (scenario === 'failure') {
      assert.deepEqual(batchSizes, [100, 100]);
    }
  }

  await runScenario('complete', 'VALIDATED_RETRIEVED_ORDERS');
  console.log('PASS: Three item-count batches verified');

  await runScenario(
    'failure',
    'UNVERIFIED',
    'Order-item count verification failed'
  );
  console.log('PASS: Failed item-count batch rejected');

  await runScenario(
    'mismatch',
    'UNVERIFIED',
    'Incomplete order items'
  );
  console.log('PASS: Incorrect combined item count rejected');
}

(async () => {
  await testSuccessfulLoadReachesScheduler();
  await testPaginationSafeguards();
  await testItemCountBatching();
  console.log('Shadow integration tests passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
