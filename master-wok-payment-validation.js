// Pure payment validation. No Railway/Supabase dependencies.
// CommonJS so Node's built-in test runner can execute without installing packages.
'use strict';
const METHODS = new Set(['cash', 'card', 'bank_transfer']);
function pennies(value, label) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value)) {
    throw new Error(label + ' must be a non-negative decimal string with at most two decimal places');
  }
  const [whole, fraction = ''] = value.split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(result)) throw new Error(label + ' is too large');
  return result;
}
function validatePayment(input, storedOrderTotal) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Payment payload required');
  if (!METHODS.has(input.billMethod)) throw new Error('Invalid bill payment method');
  const due = pennies(storedOrderTotal, 'Stored order total');
  const bill = pennies(input.billAmount, 'Bill amount');
  const tip = pennies(input.tipAmount ?? '0.00', 'Tip amount');
  if (bill !== due) throw new Error('Bill amount does not match final order total');
  if (tip > 0 && !METHODS.has(input.tipMethod)) throw new Error('Tip method required for positive tip');
  if (tip === 0 && input.tipMethod != null && input.tipMethod !== '') throw new Error('Tip method must be empty when tip is zero');
  if (typeof input.idempotencyKey !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.idempotencyKey)) {
    throw new Error('Valid UUID idempotency key required');
  }
  return Object.freeze({
    billAmount: (bill / 100).toFixed(2),
    billMethod: input.billMethod,
    tipAmount: (tip / 100).toFixed(2),
    tipMethod: tip ? input.tipMethod : null,
    idempotencyKey: input.idempotencyKey
  });
}
module.exports = { validatePayment, pennies };

