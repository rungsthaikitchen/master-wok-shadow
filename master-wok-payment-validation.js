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
  if (bill > 9999999999 || tip > 9999999999) throw new Error('Payment amount exceeds storage limit');
  const hasExpected=Object.hasOwn(input,'expectedTotal');
  if(hasExpected&&pennies(input.expectedTotal,'Expected order total')!==due)throw new Error('Order total changed; refresh payment details');
  if(bill!==due&&!hasExpected)throw new Error('Bill amount does not match final order total; review expected total first');
  const reason=typeof input.differenceReason==='string'?input.differenceReason.trim():'';
  if(bill!==due&&(!reason||reason.length>500))throw new Error('Reason required for an underpayment or overpayment');
  if(input.differenceReason!=null&&typeof input.differenceReason!=='string'||reason.length>500)throw new Error('Invalid payment difference reason');
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
    idempotencyKey: input.idempotencyKey,
    ...(hasExpected?{expectedTotal:(due/100).toFixed(2),differenceReason:reason||null}:{})
  });
}
function paymentBalance(storedOrderTotal,actualBillAmount){
 const due=pennies(String(storedOrderTotal),'Stored order total'),received=pennies(String(actualBillAmount),'Bill amount');
 return {orderTotal:(due/100).toFixed(2),billReceived:(received/100).toFixed(2),
  underpayment:(Math.max(0,due-received)/100).toFixed(2),overpayment:(Math.max(0,received-due)/100).toFixed(2),
  paid:received>=due,paymentStatus:received<due?'underpaid':received>due?'overpaid':'paid'};
}
module.exports = { validatePayment, pennies, paymentBalance };

