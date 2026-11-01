'use strict';
// Transactional orchestration seam. Caller supplies a DEDICATED PostgreSQL
// connection (never a pool.query facade) and trusted classification inputs.
// No database credentials, browser access, or production wiring here.
async function reserveWithMasterWok({ connection, serviceDate, key, candidate, readCommitted, persist, assess, prepareCandidate }) {
  if (!connection || typeof connection.query !== 'function' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(serviceDate || '') ||
      !key || !candidate || !readCommitted || !persist || !assess) {
    return { status: 'UNVERIFIED', committed: false, reason: 'INVALID_REQUEST' };
  }
  let fingerprint;
  try { fingerprint=JSON.stringify(candidate); } catch (_) {
    return {status:'UNVERIFIED',committed:false,reason:'INVALID_REQUEST'};
  }
  try {
    await beginBookingTransaction(connection,{key,serviceDates:[serviceDate]});
    // Both idempotency lookup and capacity assessment MUST be inside the lock.
    const state = await readCommitted(connection, { serviceDate, key });
    if (!state || !Array.isArray(state.acceptedOrders)) throw Error('INCOMPLETE_STATE');
    if (state.existingKey) {
      const same = state.existingKey.fingerprint === fingerprint;
      await connection.query('ROLLBACK');
      return same
        ? { status: 'GREEN', committed: false, reason: 'REPLAY', ...(state.existingKey.response?{response:state.existingKey.response}:{}) }
        : { status: 'UNVERIFIED', committed: false, reason: 'IDEMPOTENCY_CONFLICT' };
    }
    // Canonicalization and trusted server validation happen inside the lock.
    const canonical=prepareCandidate?await prepareCandidate(candidate,connection,state):candidate;
    if(!canonical)throw Error('INVALID_CANONICAL_CANDIDATE');
    const assessment = await assess({ acceptedOrders: state.acceptedOrders, proposedOrder: canonical, rawRows: state.rawRows, state });
    if (assessment?.status !== 'GREEN' || assessment.bookingApprovalAllowed === false) {
      await connection.query('ROLLBACK');
      return { status: assessment?.status === 'AMBER' ? 'AMBER' : 'UNVERIFIED', committed: false, reason: 'REVIEW_REQUIRED' };
    }
    // persist MUST atomically insert the complete order, its items, and
    // reservation/idempotency record on this same connection.
    const response=await persist(connection, { serviceDate, key, candidate:canonical, fingerprint });
    await connection.query('COMMIT');
    return { status: 'GREEN', committed: true, reason: 'RESERVED', ...(response?{response}:{}) };
  } catch (error) {
    try { await connection.query('ROLLBACK'); } catch (_) {}
    const publicReasons=new Set(['CHECKOUT_PRICE_CHANGED','CUSTOMER_CANNOT_SET_TEST_OR_ASAP',
      'INVALID_CUSTOMER_DETAILS','INVALID_BASKET','INVALID_BASKET_LINE','MODIFIER_NOT_ALLOWED',
      'INVALID_MODIFIER','SPICE_NOT_ALLOWED','DISCOUNT_NOT_AVAILABLE','DISCOUNT_WRONG_SERVICE_DAY',
      'DELIVERY_ADDRESS_NOT_ELIGIBLE','TRUSTED_DELIVERY_QUOTE_REQUIRED','INVALID_ITEM_NOTE',
      'INVALID_ORDER_NOTES','BASKET_SIZE_LIMIT']);
    return { status: 'UNVERIFIED', committed: false,
      reason:publicReasons.has(error?.message)?error.message:'TRANSACTION_FAILED' };
  }
}
async function lockServiceDates(connection,serviceDates){
  for(const date of [...new Set(serviceDates)].sort()){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||
      new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date)throw Error('INVALID_SERVICE_DATE');
    await connection.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 47822))',[date]);
  }
}
async function beginBookingTransaction(connection,{key,serviceDates=[]}={}){
  await connection.query('BEGIN');
  await connection.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
  await connection.query("SET LOCAL lock_timeout = '10s'");
  await connection.query("SET LOCAL statement_timeout = '15s'");
  // One kitchen has very low booking-write volume. Serializing authoritative
  // writers also covers global service controls and arbitrary-date blackouts,
  // without introducing a second lock hierarchy or racing flag changes.
  await connection.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 47824))',['rtk-authoritative-booking']);
  if(key)await connection.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 47823))',[key]);
  await lockServiceDates(connection,serviceDates);
}
module.exports = { reserveWithMasterWok, beginBookingTransaction, lockServiceDates };

