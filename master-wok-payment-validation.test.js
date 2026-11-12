'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePayment, pennies } = require('./master-wok-payment-validation');
const key = '3f97db2a-c6a5-4e9d-b5ab-a3b9f28c63af';
const base = { billMethod: 'card', billAmount: '32.00', tipAmount: '0.00', tipMethod: null, idempotencyKey: key };
test('card bill with no tip', () => {
  assert.deepEqual(validatePayment(base, '32.00'), base);
});
test('card bill with separate cash tip', () => {
  const r = validatePayment({ ...base, tipAmount: '3.00', tipMethod: 'cash' }, '32.00');
  assert.equal(r.tipAmount, '3.00'); assert.equal(r.tipMethod, 'cash'); assert.equal(r.billAmount, '32.00');
});
test('discounted final order total is authoritative', () => {
  assert.equal(validatePayment({ ...base, billAmount: '14.70', billMethod: 'cash' }, '14.70').billAmount, '14.70');
});
test('positive tip without method rejected', () => {
  assert.throws(() => validatePayment({ ...base, tipAmount: '3.00' }, '32.00'), /Tip method required/);
});
test('negative tip and excess decimals rejected', () => {
  for (const amount of ['-1.00', '0.001', 'NaN', '1e3', ' 1.00']) {
    assert.throws(() => validatePayment({ ...base, tipAmount: amount }, '32.00'));
  }
});
test('bill mismatch rejected', () => {
  assert.throws(() => validatePayment({ ...base, billAmount: '31.00' }, '32.00'), /does not match/);
});
test('method on zero tip rejected', () => {
  assert.throws(() => validatePayment({ ...base, tipMethod: 'cash' }, '32.00'), /must be empty/);
});
test('invalid bill or tip method rejected', () => {
  assert.throws(() => validatePayment({ ...base, billMethod: 'cheque' }, '32.00'), /Invalid bill/);
  assert.throws(() => validatePayment({ ...base, tipAmount: '1.00', tipMethod: 'cheque' }, '32.00'), /Tip method/);
});
test('missing idempotency key rejected', () => {
  assert.throws(() => validatePayment({ ...base, idempotencyKey: '' }, '32.00'), /idempotency/);
});
test('exact integer pennies without float rounding', () => {
  assert.equal(pennies('0.10'), 10); assert.equal(pennies('0.20'), 20); assert.equal(pennies('0.30'), 30);
});
test('non-string money rejected', () => {
  assert.throws(() => validatePayment({ ...base, billAmount: 32 }, '32.00'), /decimal string/);
});

test('zero tip accepts absent tip method and normalises it to null', () => {
  const { tipMethod, tipAmount } = validatePayment({ ...base, tipMethod: undefined, tipAmount: '0' }, '32.00');
  assert.equal(tipMethod, null); assert.equal(tipAmount, '0.00');
});
test('all supported bill methods accepted', () => {
  for (const billMethod of ['cash', 'card', 'bank_transfer']) {
    assert.equal(validatePayment({ ...base, billMethod }, '32.00').billMethod, billMethod);
  }
});
test('all supported tip methods accepted independently of bill method', () => {
  for (const tipMethod of ['cash', 'card', 'bank_transfer']) {
    const result = validatePayment({ ...base, tipAmount: '2.00', tipMethod }, '32.00');
    assert.equal(result.tipMethod, tipMethod);
  }
});
test('zero-value bill is valid if authoritative stored total is zero', () => {
  assert.equal(validatePayment({ ...base, billAmount: '0.00' }, '0.00').billAmount, '0.00');
});
test('malformed or unsafe monetary values rejected', () => {
  for (const amount of ['', '01.00', '.50', '1.', '+1.00', '1,000.00', 'Infinity', '90071992547410.00']) {
    assert.throws(() => validatePayment({ ...base, tipAmount: amount }, '32.00'), /decimal string|too large/);
  }
});
test('missing or malformed stored order total rejected', () => {
  for (const amount of [null, undefined, 'NaN', '-1.00']) {
    assert.throws(() => validatePayment(base, amount));
  }
});
test('idempotency key must be valid UUID', () => {
  for (const idempotencyKey of ['', 'not-a-uuid', '00000000-0000-0000-0000-000000000000']) {
    assert.throws(() => validatePayment({ ...base, idempotencyKey }, '32.00'), /idempotency/);
  }
});
test('validator does not mutate submitted payment payload', () => {
  const input = { ...base, tipAmount: '2', tipMethod: 'cash' };
  const snapshot = { ...input };
  const output = validatePayment(input, '32.00');
  assert.deepEqual(input, snapshot);
  assert.equal(output.tipAmount, '2.00');
  assert.equal(Object.isFrozen(output), true);
});
test('invalid payment payload shape rejected', () => {
  for (const payload of [null, undefined, [], 'payment', 12]) {
    assert.throws(() => validatePayment(payload, '32.00'), /Payment payload required/);
  }
});

