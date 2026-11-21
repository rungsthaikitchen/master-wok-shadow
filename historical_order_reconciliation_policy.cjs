'use strict';

/**
 * Pure validation for a historical, already-fulfilled order correction.
 * This is NOT a database writer. The authorised Master Wok writer must
 * perform these checks again under a row lock in the same transaction.
 */
function validateHistoricalCorrection({order, existingPayment, now, agreedTime, amount, method, reason, actor, fulfilled, idempotencyKey}) {
  const fail = code => ({ok:false, code});
  if (!order || order.is_test || order.status !== 'customer_declined_time') return fail('NOT_ELIGIBLE');
  if (existingPayment || order.paid || order.payment_status === 'paid') return fail('ALREADY_PAID');
  if (order.confirmed_time) return fail('ALREADY_CONFIRMED');
  if (!fulfilled || !order.proposed_time || !agreedTime) return fail('FULFILMENT_EVIDENCE_REQUIRED');
  const proposed = Date.parse(order.proposed_time), agreed = Date.parse(agreedTime), current = Date.parse(now);
  if (![proposed,agreed,current].every(Number.isFinite) || proposed !== agreed || agreed >= current) return fail('NOT_HISTORICAL_PROPOSED_TIME');
  if (method !== 'card' || !Number.isSafeInteger(amount) || amount < 0 ||
      !Number.isSafeInteger(Math.round(Number(order.total)*100)) ||
      amount !== Math.round(Number(order.total)*100)) return fail('PAYMENT_MISMATCH');
  if (typeof actor !== 'string' || !/^\S+@\S+\.\S+$/.test(actor)) return fail('STAFF_REQUIRED');
  if (typeof reason !== 'string' || reason.trim().length < 10 || reason.length > 500) return fail('REASON_REQUIRED');
  if (typeof idempotencyKey !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) return fail('IDEMPOTENCY_REQUIRED');
  return {ok:true, status:'confirmed', confirmedTime:order.proposed_time, paymentPence:amount, paymentMethod:method, notifyCustomer:false, reschedule:false};
}
module.exports = {validateHistoricalCorrection};
